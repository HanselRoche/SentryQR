import { config } from '../config.js';
import { resolveSession } from '../services/session.js';
import { ApiError } from './errors.js';

/**
 * Minimal cookie parser — the only cookie this app reads is its own session id,
 * so pulling in `cookie-parser` for one value is not worth the dependency.
 */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/**
 * Attach `req.user` when a valid session cookie is present. Does not reject —
 * routes declare their own requirements with requireAuth / requireRole, so
 * public and optional-auth routes can share this middleware.
 */
export function attachUser(req, res, next) {
  const sessionId = readCookie(req, config.cookieName);
  req.user = sessionId ? resolveSession(sessionId) : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(ApiError.unauthenticated());
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthenticated());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

export const clientIp = (req) =>
  req.ip ?? req.socket?.remoteAddress ?? null;
