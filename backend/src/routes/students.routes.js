import express from 'express';
import { clientIp, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import { paginationFrom } from '../middleware/validate.js';
import { AuditEvent, log } from '../services/audit.js';
import { findStudentByUserId } from '../services/users.js';
import { getActiveKey, registerKey } from '../services/keys.js';
import { listEntries } from '../services/verification.js';

export const studentRoutes = express.Router();

studentRoutes.use(requireRole('student'), rateLimit('general'));

studentRoutes.get('/me', (req, res) => {
  const key = getActiveKey(req.user.id);

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      fullName: req.user.fullName,
      role: req.user.role,
    },
    student: findStudentByUserId(req.user.id),
    // Explicitly null, never undefined — the app reads this to decide whether
    // to show the device-enrolment screen, and an absent key would read as
    // "already enrolled".
    activeKey: key ? { id: key.id, kid: key.kid, algorithm: key.algorithm, createdAt: key.createdAt } : null,
  });
});

studentRoutes.post('/keys', (req, res) => {
  const jwk = req.body?.jwk;
  if (jwk === undefined) throw ApiError.badRequest('"jwk" is required');

  // registerKey validates the JWK (including rejecting a private `d` member)
  // and supersedes any existing active key in the same transaction.
  const { key, supersededCount } = registerKey(req.user.id, jwk);

  log({
    eventType: AuditEvent.KEY_REGISTERED,
    actorUserId: req.user.id,
    subjectUserId: req.user.id,
    ip: clientIp(req),
    detail: { kid: key.kid, supersededCount },
  });

  res.status(201).json({ key });
});

studentRoutes.get('/me/entries', (req, res) => {
  const { limit, offset } = paginationFrom(req.query, { defaultLimit: 50 });
  res.json({ entries: listEntries({ userId: req.user.id, limit, offset }) });
});
