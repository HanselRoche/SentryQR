import { getDb, now, plainAll } from '../db/index.js';

export const AuditEvent = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  KEY_REGISTERED: 'KEY_REGISTERED',
  KEY_REVOKED: 'KEY_REVOKED',
  CHALLENGE_ISSUED: 'CHALLENGE_ISSUED',
  VERIFY: 'VERIFY',
  OVERRIDE_REQUESTED: 'OVERRIDE_REQUESTED',
  OVERRIDE_DECIDED: 'OVERRIDE_DECIDED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  RATE_LIMITED: 'RATE_LIMITED',
};

/**
 * Append one row to the security log.
 *
 * Never throws: a failure to log must not turn a successful entry into a 500 at
 * the gate. The failure is written to stderr instead.
 */
export function log({
  eventType,
  actorUserId = null,
  subjectUserId = null,
  decision = null,
  reasonCode = null,
  detail = null,
  ip = null,
}) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (ts, event_type, actor_user_id, subject_user_id, decision, reason_code, detail, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now(),
        eventType,
        actorUserId,
        subjectUserId,
        decision,
        reasonCode,
        detail === null ? null : JSON.stringify(detail),
        ip,
      );
  } catch (error) {
    console.error('[audit] failed to write log entry:', error.message);
  }
}

export function query({ limit = 100, offset = 0, eventType, decision, userId } = {}) {
  const where = [];
  const params = [];

  if (eventType) {
    where.push('a.event_type = ?');
    params.push(eventType);
  }
  if (decision) {
    where.push('a.decision = ?');
    params.push(decision);
  }
  if (userId) {
    where.push('(a.actor_user_id = ? OR a.subject_user_id = ?)');
    params.push(userId, userId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const db = getDb();
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_logs a ${clause}`).get(...params);

  const rows = db
    .prepare(
      `SELECT a.id, a.ts, a.event_type, a.actor_user_id, a.subject_user_id,
              a.decision, a.reason_code, a.detail, a.ip,
              actor.full_name   AS actor_name,
              subject.full_name AS subject_name
         FROM audit_logs a
         LEFT JOIN users actor   ON actor.id = a.actor_user_id
         LEFT JOIN users subject ON subject.id = a.subject_user_id
         ${clause}
         ORDER BY a.ts DESC, a.id DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return {
    total,
    logs: plainAll(rows).map((row) => ({
      id: row.id,
      ts: row.ts,
      eventType: row.event_type,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      subjectUserId: row.subject_user_id,
      subjectName: row.subject_name,
      decision: row.decision,
      reasonCode: row.reason_code,
      ip: row.ip,
      detail: row.detail ? JSON.parse(row.detail) : null,
    })),
  };
}
