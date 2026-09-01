import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errors.js';
import {
  positiveIntParam,
  requireBoolean,
  optionalString,
  requireEnum,
  requireString,
  ROLL_NO_PATTERN,
} from '../middleware/validate.js';
import { findStudentByRollNo } from '../services/users.js';
import { createRequest, decide, listRequests } from '../services/overrides.js';

export const overrideRoutes = express.Router();

/**
 * Guard raises an override request — the dead-phone-battery case.
 * This grants nothing on its own; an admin must approve it.
 */
overrideRoutes.post('/', requireRole('guard'), rateLimit('general'), (req, res) => {
  const rollNo = requireString(req.body, 'rollNo', { pattern: ROLL_NO_PATTERN });
  const reason = requireString(req.body, 'reason', { min: 5, max: 500 });

  const student = findStudentByRollNo(rollNo);
  if (!student) throw ApiError.notFound(`No student with roll number "${rollNo}"`);

  const override = createRequest({
    guardUserId: req.user.id,
    studentUserId: student.id,
    reason,
  });

  res.status(201).json({ override: { ...override, studentName: student.fullName, rollNo } });
});

overrideRoutes.get('/', requireRole('admin'), rateLimit('general'), (req, res) => {
  const status = req.query.status
    ? requireEnum({ status: req.query.status }, 'status', ['pending', 'approved', 'denied'])
    : undefined;
  res.json({ overrides: listRequests({ status }) });
});

overrideRoutes.post('/:id/decision', requireRole('admin'), rateLimit('general'), (req, res) => {
  const id = positiveIntParam(req.params.id, 'id');
  const approve = requireBoolean(req.body, 'approve');
  const note = optionalString(req.body, 'note', { max: 500 });

  const result = decide({ id, adminUserId: req.user.id, approve, note });

  if (!result.ok) {
    if (result.error === 'NOT_FOUND') throw ApiError.notFound('No such override request');
    throw ApiError.conflict('This override request has already been decided');
  }

  res.json({ status: result.status, entryEventId: result.entryEventId });
});
