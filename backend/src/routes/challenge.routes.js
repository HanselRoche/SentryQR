import express from 'express';
import { clientIp, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import { AuditEvent, log } from '../services/audit.js';
import { issueChallenge } from '../services/challenge.js';
import { getActiveKey } from '../services/keys.js';

export const challengeRoutes = express.Router();

challengeRoutes.post('/', requireRole('student'), rateLimit('challenge'), (req, res) => {
  // Without an enrolled key there is nothing to sign the challenge with, so
  // fail here rather than issuing a nonce that can never be used.
  if (!getActiveKey(req.user.id)) {
    throw ApiError.conflict('No active key registered for this account — enrol this device first');
  }

  const challenge = issueChallenge(req.user.id);

  log({
    eventType: AuditEvent.CHALLENGE_ISSUED,
    actorUserId: req.user.id,
    subjectUserId: req.user.id,
    ip: clientIp(req),
    detail: { nonce: challenge.nonce, expiresAt: challenge.expiresAt },
  });

  res.status(201).json(challenge);
});
