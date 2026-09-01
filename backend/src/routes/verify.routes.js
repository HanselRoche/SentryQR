import express from 'express';
import { clientIp, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import { verifyEntry } from '../services/verification.js';

export const verifyRoutes = express.Router();

/**
 * The authoritative decision endpoint.
 *
 * A denied entry is a *successful* API call and returns 200 with
 * decision: "DENY". HTTP error codes are reserved for protocol failures — a
 * rejected credential is a normal, expected outcome that the guard app needs to
 * display, not an exception.
 */
verifyRoutes.post('/', requireRole('guard'), rateLimit('verify'), (req, res) => {
  const raw = req.body?.payload;
  if (typeof raw !== 'string') {
    throw ApiError.badRequest('"payload" must be the raw string decoded from the QR');
  }

  const result = verifyEntry({
    rawPayload: raw,
    guardUserId: req.user.id,
    ip: clientIp(req),
  });

  res.json(result);
});
