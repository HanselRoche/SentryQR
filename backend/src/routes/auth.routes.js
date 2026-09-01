import express from 'express';
import { config } from '../config.js';
import { clientIp, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import { requireString, USERNAME_PATTERN } from '../middleware/validate.js';
import { AuditEvent, log } from '../services/audit.js';
import { authenticate } from '../services/users.js';
import { cookieOptions, createSession, revokeSession } from '../services/session.js';

export const authRoutes = express.Router();

authRoutes.post('/login', rateLimit('login', { keyBy: 'ip' }), (req, res) => {
  const username = requireString(req.body, 'username', { pattern: USERNAME_PATTERN });
  const password = requireString(req.body, 'password', { min: 1, max: 200 });

  const user = authenticate(username, password);

  if (!user) {
    log({
      eventType: AuditEvent.LOGIN_FAILURE,
      ip: clientIp(req),
      detail: { username },
    });
    // Deliberately identical for unknown user, wrong password, and suspended
    // account — otherwise this endpoint enumerates valid usernames.
    throw ApiError.unauthenticated('Invalid username or password');
  }

  const session = createSession(user.id);
  res.cookie(config.cookieName, session.id, cookieOptions(session.expiresAt));

  log({ eventType: AuditEvent.LOGIN_SUCCESS, actorUserId: user.id, ip: clientIp(req) });

  res.json({ user: { id: user.id, username: user.username, role: user.role, fullName: user.fullName } });
});

authRoutes.post('/logout', requireAuth, (req, res) => {
  revokeSession(req.user.sessionId);
  res.clearCookie(config.cookieName, { path: '/' });
  log({ eventType: AuditEvent.LOGOUT, actorUserId: req.user.id, ip: clientIp(req) });
  res.status(204).end();
});

authRoutes.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      fullName: req.user.fullName,
    },
  });
});
