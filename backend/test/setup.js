// Imported FIRST by every test file. ESM evaluates modules in import order, so
// setting DB_PATH here lands before config.js is evaluated by any later import.
// node --test runs each file in its own process, so the databases never collide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentryqr-test-'));

process.env.DB_PATH = path.join(dir, 'test.db');
process.env.NODE_ENV = 'test';
// Short enough that an expiry test can wait it out without slowing the suite.
process.env.CHALLENGE_TTL_MS = '1500';

process.on('exit', () => {
  fs.rmSync(dir, { recursive: true, force: true });
});
