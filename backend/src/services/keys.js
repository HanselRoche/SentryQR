import { getDb, now, plain, plainAll, transaction } from '../db/index.js';
import { prepareKeyForStorage } from '../crypto/keys.js';

const shape = (row) =>
  row && {
    id: row.id,
    userId: row.user_id,
    kid: row.kid,
    jwk: JSON.parse(row.jwk),
    algorithm: row.algorithm,
    active: row.active === 1,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };

export function getActiveKey(userId) {
  return shape(
    plain(getDb().prepare('SELECT * FROM public_keys WHERE user_id = ? AND active = 1').get(userId)),
  );
}

/**
 * Enrol a device's public key.
 *
 * Registration supersedes any existing key in the same transaction rather than
 * adding a second one. A student always has exactly one active key, so an
 * attacker who registers their own key against a victim's account cannot do so
 * silently — the victim's own device stops working immediately, and the
 * partial unique index makes two live keys impossible at the schema level.
 */
export function registerKey(userId, rawJwk) {
  const { jwk, kid, algorithm } = prepareKeyForStorage(rawJwk);
  const timestamp = now();

  return transaction((db) => {
    const superseded = db
      .prepare('UPDATE public_keys SET active = 0, revoked_at = ? WHERE user_id = ? AND active = 1')
      .run(timestamp, userId).changes;

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO public_keys (user_id, kid, jwk, algorithm, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run(userId, kid, JSON.stringify(jwk), algorithm, timestamp);

    return {
      key: { id: Number(lastInsertRowid), kid, algorithm, createdAt: timestamp },
      supersededCount: superseded,
    };
  });
}

export function revokeKey(keyId) {
  const result = getDb()
    .prepare('UPDATE public_keys SET active = 0, revoked_at = ? WHERE id = ? AND active = 1')
    .run(now(), keyId);
  return result.changes === 1;
}

export function getKeyById(keyId) {
  return shape(plain(getDb().prepare('SELECT * FROM public_keys WHERE id = ?').get(keyId)));
}

export function listKeys({ userId, includeRevoked = false } = {}) {
  const where = [];
  const params = [];
  if (userId) {
    where.push('k.user_id = ?');
    params.push(userId);
  }
  if (!includeRevoked) where.push('k.active = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT k.id, k.user_id, k.kid, k.jwk, k.algorithm, k.active, k.created_at, k.revoked_at,
              u.full_name, u.username, s.roll_no
         FROM public_keys k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN students s ON s.user_id = k.user_id
         ${clause}
         ORDER BY k.created_at DESC`,
    )
    .all(...params);

  return plainAll(rows).map((row) => {
    const jwk = JSON.parse(row.jwk);
    return {
      id: row.id,
      userId: row.user_id,
      ownerName: row.full_name,
      ownerUsername: row.username,
      rollNo: row.roll_no,
      kid: row.kid,
      algorithm: row.algorithm,
      active: row.active === 1,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      // Truncated for display. Public coordinates are not secret, but there is
      // no reason for the dashboard to carry full key material around.
      publicPreview: `${jwk.x.slice(0, 12)}…${jwk.y.slice(-8)}`,
    };
  });
}
