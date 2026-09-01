import { config } from '../config.js';
import { getDb, now, plain } from '../db/index.js';
import { generateSessionId } from '../crypto/nonce.js';

export function createSession(userId) {
  const id = generateSessionId();
  const createdAt = now();
  const expiresAt = createdAt + config.sessionTtlMs;

  getDb()
    .prepare('INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, createdAt, expiresAt);

  return { id, expiresAt };
}

/**
 * Resolve a session id to its user.
 *
 * Expiry, revocation and account suspension are all checked in the same query,
 * so deactivating a user takes effect on their next request rather than when
 * their session happens to expire.
 */
export function resolveSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;

  const row = getDb()
    .prepare(
      `SELECT s.id AS session_id, s.expires_at,
              u.id, u.username, u.role, u.full_name
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.revoked = 0 AND s.expires_at > ? AND u.active = 1`,
    )
    .get(sessionId, now());

  if (!row) return null;
  const session = plain(row);

  return {
    sessionId: session.session_id,
    id: session.id,
    username: session.username,
    role: session.role,
    fullName: session.full_name,
  };
}

/** Revoke rather than delete, so the log can show when the session ended. */
export function revokeSession(sessionId) {
  getDb().prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?').run(sessionId);
}

export function revokeAllForUser(userId) {
  getDb().prepare('UPDATE auth_sessions SET revoked = 1 WHERE user_id = ?').run(userId);
}

export function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: new Date(expiresAt),
  };
}
