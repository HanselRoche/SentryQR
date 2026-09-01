import { getDb, now, plain, plainAll } from '../db/index.js';
import { AuditEvent, log } from './audit.js';
import { recordOverrideEntry } from './verification.js';

export function createRequest({ guardUserId, studentUserId, reason }) {
  const { lastInsertRowid } = getDb()
    .prepare(
      `INSERT INTO override_requests (guard_user_id, student_user_id, reason, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .run(guardUserId, studentUserId, reason, now());

  log({
    eventType: AuditEvent.OVERRIDE_REQUESTED,
    actorUserId: guardUserId,
    subjectUserId: studentUserId,
    detail: { reason },
  });

  return { id: Number(lastInsertRowid), status: 'pending', createdAt: now() };
}

export function listRequests({ status } = {}) {
  const clause = status ? 'WHERE o.status = ?' : '';
  const params = status ? [status] : [];

  const rows = getDb()
    .prepare(
      `SELECT o.*, guard.full_name AS guard_name, student.full_name AS student_name,
              s.roll_no, s.room_no, decider.full_name AS decided_by_name
         FROM override_requests o
         JOIN users guard   ON guard.id = o.guard_user_id
         JOIN users student ON student.id = o.student_user_id
         LEFT JOIN students s ON s.user_id = o.student_user_id
         LEFT JOIN users decider ON decider.id = o.decided_by
         ${clause}
         ORDER BY o.created_at DESC`,
    )
    .all(...params);

  return plainAll(rows).map((row) => ({
    id: row.id,
    guardName: row.guard_name,
    studentUserId: row.student_user_id,
    studentName: row.student_name,
    rollNo: row.roll_no,
    roomNo: row.room_no,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  }));
}

/**
 * Admin decision on a pending override.
 *
 * Approval writes a real entry_events row with reason MANUAL_OVERRIDE, so a
 * manual entry appears in the same history and audit trail as a cryptographic
 * one rather than being an invisible side channel.
 */
export function decide({ id, adminUserId, approve, note }) {
  const row = plain(getDb().prepare('SELECT * FROM override_requests WHERE id = ?').get(id));
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.status !== 'pending') return { ok: false, error: 'ALREADY_DECIDED' };

  const status = approve ? 'approved' : 'denied';
  getDb()
    .prepare('UPDATE override_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?')
    .run(status, adminUserId, now(), note ?? null, id);

  let entryEventId = null;
  if (approve) {
    entryEventId = recordOverrideEntry({
      studentId: row.student_user_id,
      guardUserId: row.guard_user_id,
      note: note ?? row.reason,
    });
  }

  log({
    eventType: AuditEvent.OVERRIDE_DECIDED,
    actorUserId: adminUserId,
    subjectUserId: row.student_user_id,
    decision: approve ? 'GRANT' : 'DENY',
    detail: { overrideId: id, note },
  });

  return { ok: true, status, entryEventId };
}
