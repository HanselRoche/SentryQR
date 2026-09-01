import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  env: process.env.NODE_ENV ?? 'development',

  dbPath: process.env.DB_PATH ?? path.join(backendRoot, 'data', 'sentryqr.db'),
  staticDir: path.resolve(backendRoot, '..', 'frontend', 'dist'),

  // Challenge lifetime. The student app refreshes at 30s against this 45s
  // window, leaving 15s of slack for the guard to line up a scan. Shortening
  // this shrinks the replay window (threat T1) at the cost of scan reliability.
  challengeTtlMs: int(process.env.CHALLENGE_TTL_MS, 45_000),

  sessionTtlMs: int(process.env.SESSION_TTL_MS, 8 * 60 * 60 * 1000),
  cookieName: 'sentryqr_sid',
  // Phase 6 flips this on once TLS terminates in front of the app.
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  rateLimits: {
    login: { limit: 5, windowMs: 60_000 },
    challenge: { limit: 20, windowMs: 60_000 },
    verify: { limit: 60, windowMs: 60_000 },
    general: { limit: 120, windowMs: 60_000 },
  },

  // Signed-message format version. Bump when the canonical layout changes so
  // an old payload can never be verified under new rules.
  payloadVersion: 1,
};
