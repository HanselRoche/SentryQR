import { config } from './config.js';
import { createApp } from './app.js';
import { getDb, closeDb } from './db/index.js';
import { purgeExpiredNonces } from './services/challenge.js';

getDb(); // open and apply schema before accepting traffic

const app = createApp();

// Housekeeping only — expiry is enforced by comparing against the clock at
// verification time, so correctness does not depend on this sweep running.
const sweeper = setInterval(() => {
  try {
    const removed = purgeExpiredNonces();
    if (removed > 0) console.log(`[sweep] removed ${removed} expired nonces`);
  } catch (error) {
    console.error('[sweep] failed:', error.message);
  }
}, 10 * 60 * 1000);
sweeper.unref();

const server = app.listen(config.port, () => {
  console.log(`SentryQR API listening on http://localhost:${config.port}`);
  console.log(`  database:      ${config.dbPath}`);
  console.log(`  challenge TTL: ${config.challengeTtlMs}ms`);
  console.log(`  secure cookie: ${config.cookieSecure}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
