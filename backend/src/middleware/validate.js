import { ApiError } from './errors.js';

/**
 * Small hand-rolled validators. A schema library would be more expressive, but
 * the API surface here is a dozen endpoints and every rule is visible at the
 * call site, which is easier to audit in a security review.
 */

export function requireString(body, field, { min = 1, max = 255, pattern } = {}) {
  const value = body?.[field];
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`"${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw ApiError.badRequest(`"${field}" must be between ${min} and ${max} characters`);
  }
  if (pattern && !pattern.test(trimmed)) {
    throw ApiError.badRequest(`"${field}" has an invalid format`);
  }
  return trimmed;
}

export function requireBoolean(body, field) {
  const value = body?.[field];
  if (typeof value !== 'boolean') {
    throw ApiError.badRequest(`"${field}" must be a boolean`);
  }
  return value;
}

export function optionalString(body, field, options = {}) {
  if (body?.[field] === undefined || body?.[field] === null) return null;
  return requireString(body, field, options);
}

export function requireEnum(body, field, allowed) {
  const value = requireString(body, field);
  if (!allowed.includes(value)) {
    throw ApiError.badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function positiveIntParam(value, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw ApiError.badRequest(`"${field}" must be a positive integer`);
  }
  return parsed;
}

/** Clamped so a client cannot request an unbounded page and stall the process. */
export function paginationFrom(query, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit ?? defaultLimit, 10) || defaultLimit, 1), maxLimit);
  const offset = Math.max(Number.parseInt(query.offset ?? 0, 10) || 0, 0);
  return { limit, offset };
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
export const ROLL_NO_PATTERN = /^[A-Za-z0-9-]{3,32}$/;
