import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(here, 'schema.sql');

let db = null;

/**
 * Open (or create) the database and apply the schema.
 *
 * The pragmas are set per connection, not stored in the file:
 *  - foreign_keys is OFF by default in SQLite, so the FK constraints in
 *    schema.sql would be silently unenforced without this.
 *  - WAL lets an admin's audit query read while a guard's verification writes.
 *  - busy_timeout makes a concurrent writer wait rather than fail immediately.
 */
export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const connection = new DatabaseSync(dbPath);
  connection.exec('PRAGMA foreign_keys = ON');
  connection.exec('PRAGMA busy_timeout = 5000');
  if (dbPath !== ':memory:') {
    connection.exec('PRAGMA journal_mode = WAL');
  }
  connection.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  return connection;
}

/** Process-wide connection, opened on first use. */
export function getDb() {
  if (db === null) db = openDatabase();
  return db;
}

/** Point the module at a specific connection — used by tests. */
export function setDb(connection) {
  db = connection;
  return db;
}

export function closeDb() {
  if (db !== null) {
    db.close();
    db = null;
  }
}

export const now = () => Date.now();

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * IMMEDIATE takes the write lock up front rather than on the first write, so
 * two concurrent transactions cannot both start optimistically and then have
 * one fail on upgrade.
 */
export function transaction(fn) {
  const connection = getDb();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(connection);
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      connection.exec('ROLLBACK');
    } catch {
      // Already rolled back by SQLite; the original error is what matters.
    }
    throw error;
  }
}

// node:sqlite returns null-prototype row objects. They serialize fine, but
// spreading them into a normal object avoids surprises with `in`, inherited
// helpers, and anything that expects Object.prototype.
//
// "No row" normalises to null rather than undefined: undefined disappears
// entirely from JSON.stringify, so a missing field would reach the client as an
// absent key instead of an explicit null.
export const plain = (row) => (row ? { ...row } : null);
export const plainAll = (rows) => rows.map((row) => ({ ...row }));
