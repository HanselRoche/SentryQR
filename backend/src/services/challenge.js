import { config } from '../config.js';
import { getDb, now, plain } from '../db/index.js';
import { generateNonce } from '../crypto/nonce.js';
import { canonicalMessage } from '../crypto/verify.js';

/**
 * Issue a fresh single-use challenge bound to one student.
 *
 * The binding is the important part: `user_id` recorded here is what the
 * verifier trusts later. The `sid` field in the QR payload is a client claim
 * and is only ever compared against this row, never substituted for it.
 */
export function issueChallenge(studentId) {
  const nonce = generateNonce();
  const issuedAt = now();
  const expiresAt = issuedAt + config.challengeTtlMs;

  getDb()
    .prepare('INSERT INTO nonces (nonce, user_id, issued_at, expires_at, status) VALUES (?, ?, ?, ?, ?)')
    .run(nonce, studentId, issuedAt, expiresAt, 'issued');

  return {
    studentId,
    nonce,
    issuedAt,
    expiresAt,
    ttlMs: config.challengeTtlMs,
    // Returned so the client signs byte-identical input rather than rebuilding
    // the format itself and risking drift. Safe because the server reconstructs
    // this same string from its own row at verification time and never trusts
    // a client-supplied version.
    message: canonicalMessage({ studentId, nonce, issuedAt }),
  };
}

export function findNonce(nonce) {
  const row = plain(getDb().prepare('SELECT * FROM nonces WHERE nonce = ?').get(nonce));
  return (
    row && {
      nonce: row.nonce,
      userId: row.user_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      status: row.status,
      consumedAt: row.consumed_at,
    }
  );
}

/**
 * Atomically consume a nonce. Returns true only for the caller that won.
 *
 * The `AND status = 'issued'` in the WHERE clause is the anti-replay lock. Two
 * concurrent verifications of the same QR both pass the earlier read-only
 * checks, but only one UPDATE can match a row — the second affects zero rows
 * and its caller is denied.
 *
 * A SELECT-then-UPDATE would leave a window between the read and the write in
 * which both callers see 'issued'. That is a real TOCTOU bug and exactly what a
 * parallel-request attacker aims at.
 */
export function consumeNonce(nonce, db = getDb()) {
  const result = db
    .prepare("UPDATE nonces SET status = 'consumed', consumed_at = ? WHERE nonce = ? AND status = 'issued'")
    .run(now(), nonce);
  return result.changes === 1;
}

/** Housekeeping only — correctness never depends on this running. */
export function purgeExpiredNonces(olderThanMs = 60 * 60 * 1000) {
  return getDb().prepare('DELETE FROM nonces WHERE expires_at < ?').run(now() - olderThanMs).changes;
}
