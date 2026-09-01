import { getDb, now, plain, plainAll, transaction } from '../db/index.js';
import { hashPassword, verifyPassword } from '../crypto/password.js';

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

const shape = (row) =>
  row && {
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    active: row.active === 1,
    createdAt: row.created_at,
  };

export function findByUsername(username) {
  return plain(getDb().prepare('SELECT * FROM users WHERE username = ?').get(username));
}

export function findById(id) {
  return shape(plain(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)));
}

export function findStudentByUserId(userId) {
  const row = plain(getDb().prepare('SELECT * FROM students WHERE user_id = ?').get(userId));
  return row && { rollNo: row.roll_no, roomNo: row.room_no, hostelBlock: row.hostel_block };
}

export function findStudentByRollNo(rollNo) {
  const row = plain(
    getDb()
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.active, s.roll_no, s.room_no, s.hostel_block
           FROM students s JOIN users u ON u.id = s.user_id
          WHERE s.roll_no = ?`,
      )
      .get(rollNo),
  );
  return (
    row && {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      active: row.active === 1,
      rollNo: row.roll_no,
      roomNo: row.room_no,
      hostelBlock: row.hostel_block,
    }
  );
}

/**
 * Authenticate a username/password pair.
 *
 * Returns null for unknown user, wrong password, and suspended account alike —
 * the caller must not tell them apart in the response, or the endpoint becomes
 * a username enumeration oracle.
 */
export function authenticate(username, password) {
  const row = findByUsername(username);
  if (!row) {
    // Hash anyway so an unknown username does not return measurably faster
    // than a known one with a wrong password.
    hashPassword(password);
    return null;
  }
  if (!verifyPassword(password, row.password_hash, row.password_salt)) return null;
  if (row.active !== 1) return null;
  return shape(row);
}

export function createUser({ username, password, fullName, role, rollNo, roomNo, hostelBlock }) {
  if (findByUsername(username)) {
    throw new ConflictError(`Username "${username}" is already taken`);
  }
  if (role === 'student' && findStudentByRollNo(rollNo)) {
    throw new ConflictError(`Roll number "${rollNo}" is already registered`);
  }

  const { hash, salt } = hashPassword(password);

  return transaction((db) => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (username, password_hash, password_salt, role, full_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(username, hash, salt, role, fullName, now());

    const userId = Number(lastInsertRowid);

    if (role === 'student') {
      db.prepare(
        'INSERT INTO students (user_id, roll_no, room_no, hostel_block) VALUES (?, ?, ?, ?)',
      ).run(userId, rollNo, roomNo, hostelBlock);
    }

    return { id: userId, username, role, fullName, active: true };
  });
}

export function setActive(userId, active) {
  const result = getDb()
    .prepare('UPDATE users SET active = ? WHERE id = ?')
    .run(active ? 1 : 0, userId);
  return result.changes === 1;
}

/** Directory view for the admin dashboard: profile, key status, last entry. */
export function listUsers({ role } = {}) {
  const clause = role ? 'WHERE u.role = ?' : '';
  const params = role ? [role] : [];

  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role, u.full_name, u.active, u.created_at,
              s.roll_no, s.room_no, s.hostel_block,
              k.id AS key_id, k.kid, k.created_at AS key_created_at,
              (SELECT MAX(created_at) FROM entry_events e WHERE e.user_id = u.id) AS last_entry_at
         FROM users u
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN public_keys k ON k.user_id = u.id AND k.active = 1
         ${clause}
         ORDER BY u.role, u.full_name`,
    )
    .all(...params);

  return plainAll(rows).map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    active: row.active === 1,
    createdAt: row.created_at,
    student: row.roll_no
      ? { rollNo: row.roll_no, roomNo: row.room_no, hostelBlock: row.hostel_block }
      : null,
    activeKey: row.key_id ? { id: row.key_id, kid: row.kid, createdAt: row.key_created_at } : null,
    lastEntryAt: row.last_entry_at,
  }));
}
