import crypto from 'node:crypto';

/**
 * 32 random bytes, base64url-encoded (43 chars, no padding).
 *
 * base64url matters here: the canonical signed message uses `|` as its field
 * separator, and base64url's alphabet (A-Z a-z 0-9 - _) cannot produce one,
 * so the message can never be ambiguously parsed.
 */
export function generateNonce() {
  return crypto.randomBytes(32).toString('base64url');
}

/** 32 random bytes for a session id — same shape, different purpose. */
export function generateSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

export function isValidNonceFormat(value) {
  return typeof value === 'string' && BASE64URL_43.test(value);
}
