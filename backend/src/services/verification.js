import { config } from '../config.js';
import { getDb, now, plain, plainAll } from '../db/index.js';
import { isValidNonceFormat } from '../crypto/nonce.js';
import { canonicalMessage, verifySignature } from '../crypto/verify.js';
import { consumeNonce, findNonce } from './challenge.js';
import { getActiveKey } from './keys.js';
import { AuditEvent, log } from './audit.js';

export const Reason = {
  OK: 'OK',
  MALFORMED_PAYLOAD: 'MALFORMED_PAYLOAD',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNKNOWN_NONCE: 'UNKNOWN_NONCE',
  NONCE_REUSED: 'NONCE_REUSED',
  CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  STUDENT_INACTIVE: 'STUDENT_INACTIVE',
  UNREGISTERED_STUDENT: 'UNREGISTERED_STUDENT',
  KEY_REVOKED: 'KEY_REVOKED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
};

/**
 * Parse the raw QR string.
 *
 * Returns { ok: false, reason } rather than throwing, so a malformed payload is
 * an ordinary DENY that gets logged like any other, not a 500.
 */
export function parsePayload(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }
  if (typeof payload.v !== 'number') {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }
  if (payload.v !== config.payloadVersion) {
    return { ok: false, reason: Reason.UNSUPPORTED_VERSION };
  }
  if (!Number.isInteger(payload.sid) || payload.sid <= 0) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }
  if (!isValidNonceFormat(payload.n)) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }
  if (!Number.isInteger(payload.iat) || payload.iat <= 0) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }
  if (typeof payload.sig !== 'string' || !/^[A-Za-z0-9_-]{86,88}$/.test(payload.sig)) {
    return { ok: false, reason: Reason.MALFORMED_PAYLOAD };
  }

  return { ok: true, payload: { v: payload.v, sid: payload.sid, n: payload.n, iat: payload.iat, sig: payload.sig } };
}

/**
 * The authoritative decision. Checks run cheapest-first, so a malformed or
 * replayed payload never reaches the signature verification.
 *
 * @returns {{decision: 'GRANT'|'DENY', reasonCode: string, student: object|null}}
 */
export function verifyEntry({ rawPayload, guardUserId, ip = null }) {
  const parsed = parsePayload(rawPayload);
  if (!parsed.ok) {
    return record({ decision: 'DENY', reasonCode: parsed.reason, guardUserId, ip });
  }
  const payload = parsed.payload;

  // 3 — the nonce is a lookup key, nothing more.
  const challenge = findNonce(payload.n);
  if (!challenge) {
    return record({
      decision: 'DENY',
      reasonCode: Reason.UNKNOWN_NONCE,
      guardUserId,
      nonce: payload.n,
      ip,
    });
  }

  const deny = (reasonCode) =>
    record({
      decision: 'DENY',
      reasonCode,
      guardUserId,
      studentId: challenge.userId,
      nonce: challenge.nonce,
      ip,
    });

  // 4 — sequential replay.
  if (challenge.status !== 'issued') return deny(Reason.NONCE_REUSED);

  // 5 — the screenshot case.
  if (now() >= challenge.expiresAt) return deny(Reason.CHALLENGE_EXPIRED);

  // 6 — the claimed identity must match what the server recorded at issuance.
  if (challenge.userId !== payload.sid) return deny(Reason.IDENTITY_MISMATCH);

  const student = plain(
    getDb()
      .prepare(
        `SELECT u.id, u.full_name, u.active, s.roll_no, s.room_no, s.hostel_block
           FROM users u LEFT JOIN students s ON s.user_id = u.id
          WHERE u.id = ? AND u.role = 'student'`,
      )
      .get(challenge.userId),
  );

  if (!student) return deny(Reason.UNREGISTERED_STUDENT);
  if (student.active !== 1) return deny(Reason.STUDENT_INACTIVE);

  const key = getActiveKey(challenge.userId);
  // No active key means either never enrolled or revoked. The two are
  // distinguished by whether any key row exists at all.
  if (!key) {
    const everHadKey = getDb()
      .prepare('SELECT 1 FROM public_keys WHERE user_id = ? LIMIT 1')
      .get(challenge.userId);
    return deny(everHadKey ? Reason.KEY_REVOKED : Reason.UNREGISTERED_STUDENT);
  }

  // 10 — rebuild the signed message from STORED values. payload.sid and
  // payload.iat are attacker-controlled and deliberately unused here, so
  // editing them in the QR changes nothing about what is verified.
  const message = canonicalMessage({
    studentId: challenge.userId,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
  });

  if (!verifySignature(key.jwk, message, payload.sig)) {
    return deny(Reason.INVALID_SIGNATURE);
  }

  // 11 — atomic consume. The loser of a concurrent race lands here.
  if (!consumeNonce(challenge.nonce)) return deny(Reason.NONCE_REUSED);

  return record({
    decision: 'GRANT',
    reasonCode: Reason.OK,
    guardUserId,
    studentId: challenge.userId,
    nonce: challenge.nonce,
    ip,
    student: {
      fullName: student.full_name,
      rollNo: student.roll_no,
      roomNo: student.room_no,
      hostelBlock: student.hostel_block,
    },
    keyId: key.id,
  });
}

/**
 * Write the entry event and audit row, then build the response.
 * Every verification lands here — grants and denials alike are recorded.
 */
function record({
  decision,
  reasonCode,
  guardUserId,
  studentId = null,
  nonce = null,
  ip = null,
  student = null,
  keyId = null,
}) {
  const timestamp = now();

  const { lastInsertRowid } = getDb()
    .prepare(
      `INSERT INTO entry_events (user_id, guard_user_id, nonce, decision, reason_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(studentId, guardUserId, nonce, decision, reasonCode, timestamp);

  log({
    eventType: AuditEvent.VERIFY,
    actorUserId: guardUserId,
    subjectUserId: studentId,
    decision,
    reasonCode,
    ip,
    detail: { nonce, keyId },
  });

  return {
    decision,
    reasonCode,
    // Student details only on grant: a denial must not confirm whether the
    // referenced student exists.
    student: decision === 'GRANT' ? student : null,
    entryEventId: Number(lastInsertRowid),
    verifiedAt: timestamp,
  };
}

/** Records a manual override as a real entry event so it is never invisible. */
export function recordOverrideEntry({ studentId, guardUserId, note }) {
  const timestamp = now();
  const { lastInsertRowid } = getDb()
    .prepare(
      `INSERT INTO entry_events (user_id, guard_user_id, nonce, decision, reason_code, created_at)
       VALUES (?, ?, NULL, 'GRANT', ?, ?)`,
    )
    .run(studentId, guardUserId, Reason.MANUAL_OVERRIDE, timestamp);

  log({
    eventType: AuditEvent.VERIFY,
    actorUserId: guardUserId,
    subjectUserId: studentId,
    decision: 'GRANT',
    reasonCode: Reason.MANUAL_OVERRIDE,
    detail: { note },
  });

  return Number(lastInsertRowid);
}

export function listEntries({ userId, limit = 100, offset = 0, decision } = {}) {
  const where = [];
  const params = [];
  if (userId) {
    where.push('e.user_id = ?');
    params.push(userId);
  }
  if (decision) {
    where.push('e.decision = ?');
    params.push(decision);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT e.id, e.user_id, e.guard_user_id, e.decision, e.reason_code, e.created_at,
              student.full_name AS student_name, guard.full_name AS guard_name, s.roll_no
         FROM entry_events e
         LEFT JOIN users student ON student.id = e.user_id
         LEFT JOIN users guard   ON guard.id = e.guard_user_id
         LEFT JOIN students s    ON s.user_id = e.user_id
         ${clause}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return plainAll(rows).map((row) => ({
    id: row.id,
    studentId: row.user_id,
    studentName: row.student_name,
    rollNo: row.roll_no,
    guardName: row.guard_name,
    decision: row.decision,
    reasonCode: row.reason_code,
    createdAt: row.created_at,
  }));
}
