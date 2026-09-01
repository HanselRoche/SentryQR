import fs from 'node:fs';
import { config } from '../config.js';
import { openDatabase } from './index.js';

const reset = process.argv.includes('--reset');

if (reset && config.dbPath !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(config.dbPath + suffix, { force: true });
  }
  console.log(`Removed existing database at ${config.dbPath}`);
}

const db = openDatabase();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
db.close();

console.log(`Schema applied to ${config.dbPath}`);
console.log(`Tables: ${tables.join(', ')}`);
