import { config } from '../config.js';
import { AuditEvent, log } from '../services/audit.js';
import { clientIp } from './auth.js';
import { ApiError } from './errors.js';

/**
 * In-memory token bucket.
 *
 * State is per-process and resets on restart, which is fine for a single-node
 * demo. A multi-node deployment would need shared state (Redis) — noted as a
 * known limitation in the threat model under T7.
 */
const buckets = new Map();

function take(key, limit, windowMs) {
  const nowMs = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || nowMs >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: nowMs + windowMs };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

/**
 * Rate limit by authenticated user when there is one, falling back to IP.
 * Keying on the user matters for /api/challenge: several students behind one
 * hostel NAT would otherwise share a single budget.
 */
export function rateLimit(name, { keyBy = 'user' } = {}) {
  const { limit, windowMs } = config.rateLimits[name] ?? config.rateLimits.general;

  return (req, res, next) => {
    const identity = keyBy === 'ip' || !req.user ? `ip:${clientIp(req)}` : `user:${req.user.id}`;
    const result = take(`${name}:${identity}`, limit, windowMs);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', Math.max(retryAfter, 1));
      log({
        eventType: AuditEvent.RATE_LIMITED,
        actorUserId: req.user?.id ?? null,
        ip: clientIp(req),
        detail: { route: name, limit, windowMs },
      });
      return next(new ApiError(429, 'RATE_LIMITED', `Rate limit exceeded for ${name}`));
    }

    next();
  };
}

/** Test helper — buckets are module state that would otherwise leak between runs. */
export function resetRateLimits() {
  buckets.clear();
}
