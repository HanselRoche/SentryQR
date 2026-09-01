import express from 'express';
import { clientIp, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import {
  paginationFrom,
  positiveIntParam,
  requireBoolean,
  requireEnum,
  requireString,
  ROLL_NO_PATTERN,
  USERNAME_PATTERN,
} from '../middleware/validate.js';
import { AuditEvent, log, query as queryAudit } from '../services/audit.js';
import { createUser, listUsers, setActive } from '../services/users.js';
import { getKeyById, listKeys, revokeKey } from '../services/keys.js';
import { listEntries } from '../services/verification.js';
import { revokeAllForUser } from '../services/session.js';

export const adminRoutes = express.Router();

adminRoutes.use(requireRole('admin'), rateLimit('general'));

adminRoutes.post('/users', (req, res) => {
  const role = requireEnum(req.body, 'role', ['student', 'guard']);
  const username = requireString(req.body, 'username', { pattern: USERNAME_PATTERN });
  const password = requireString(req.body, 'password', { min: 8, max: 200 });
  const fullName = requireString(req.body, 'fullName', { min: 2, max: 120 });

  const profile =
    role === 'student'
      ? {
          rollNo: requireString(req.body, 'rollNo', { pattern: ROLL_NO_PATTERN }),
          roomNo: requireString(req.body, 'roomNo', { max: 20 }),
          hostelBlock: requireString(req.body, 'hostelBlock', { max: 20 }),
        }
      : {};

  const user = createUser({ username, password, fullName, role, ...profile });

  log({
    eventType: AuditEvent.USER_CREATED,
    actorUserId: req.user.id,
    subjectUserId: user.id,
    ip: clientIp(req),
    detail: { role, username },
  });

  res.status(201).json({ user });
});

adminRoutes.get('/users', (req, res) => {
  const role = req.query.role
    ? requireEnum({ role: req.query.role }, 'role', ['student', 'guard', 'admin'])
    : undefined;
  res.json({ users: listUsers({ role }) });
});

adminRoutes.patch('/users/:id', (req, res) => {
  const id = positiveIntParam(req.params.id, 'id');
  const active = requireBoolean(req.body, 'active');

  if (id === req.user.id) {
    throw ApiError.badRequest('You cannot suspend your own account');
  }
  if (!setActive(id, active)) throw ApiError.notFound('No such user');

  // Suspension must take effect immediately, not whenever their cookie happens
  // to expire, so any live session is revoked too.
  if (!active) revokeAllForUser(id);

  log({
    eventType: AuditEvent.USER_UPDATED,
    actorUserId: req.user.id,
    subjectUserId: id,
    ip: clientIp(req),
    detail: { active },
  });

  res.json({ id, active });
});

adminRoutes.get('/keys', (req, res) => {
  const userId = req.query.userId ? positiveIntParam(req.query.userId, 'userId') : undefined;
  res.json({ keys: listKeys({ userId, includeRevoked: req.query.includeRevoked === 'true' }) });
});

adminRoutes.post('/keys/:id/revoke', (req, res) => {
  const id = positiveIntParam(req.params.id, 'id');
  const key = getKeyById(id);
  if (!key) throw ApiError.notFound('No such key');
  if (!key.active) throw ApiError.conflict('Key is already revoked');

  revokeKey(id);

  log({
    eventType: AuditEvent.KEY_REVOKED,
    actorUserId: req.user.id,
    subjectUserId: key.userId,
    ip: clientIp(req),
    detail: { kid: key.kid, keyId: id },
  });

  // Takes effect on the very next verification — the student's next QR is
  // denied with KEY_REVOKED without any further action.
  res.json({ id, revoked: true });
});

adminRoutes.get('/audit', (req, res) => {
  const { limit, offset } = paginationFrom(req.query);
  res.json(
    queryAudit({
      limit,
      offset,
      eventType: req.query.eventType || undefined,
      decision: req.query.decision || undefined,
      userId: req.query.userId ? positiveIntParam(req.query.userId, 'userId') : undefined,
    }),
  );
});

adminRoutes.get('/entries', (req, res) => {
  const { limit, offset } = paginationFrom(req.query);
  res.json({
    entries: listEntries({
      limit,
      offset,
      decision: req.query.decision || undefined,
      userId: req.query.userId ? positiveIntParam(req.query.userId, 'userId') : undefined,
    }),
  });
});
