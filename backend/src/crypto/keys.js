import crypto from 'node:crypto';

export const ALGORITHM = 'ECDSA-P256';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class InvalidKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

/**
 * Validate a public JWK arriving from a student's browser.
 *
 * The check that matters most is the last one: a JWK carrying a `d` member is
 * an EC *private* key. A private key must never reach the server — accepting
 * one would destroy the non-repudiation property the whole system rests on, so
 * it is rejected loudly rather than silently stripped.
 */
export function validatePublicJwk(jwk) {
  if (jwk === null || typeof jwk !== 'object' || Array.isArray(jwk)) {
    throw new InvalidKeyError('JWK must be an object');
  }
  if (jwk.kty !== 'EC') {
    throw new InvalidKeyError(`Unsupported key type: expected EC, got ${jwk.kty}`);
  }
  if (jwk.crv !== 'P-256') {
    throw new InvalidKeyError(`Unsupported curve: expected P-256, got ${jwk.crv}`);
  }
  for (const coord of ['x', 'y']) {
    const value = jwk[coord];
    if (typeof value !== 'string' || !BASE64URL.test(value)) {
      throw new InvalidKeyError(`JWK coordinate "${coord}" must be a base64url string`);
    }
    // P-256 coordinates are 32 bytes => 43 base64url chars unpadded.
    if (Buffer.from(value, 'base64url').length !== 32) {
      throw new InvalidKeyError(`JWK coordinate "${coord}" must decode to 32 bytes`);
    }
  }
  if ('d' in jwk) {
    throw new InvalidKeyError('JWK contains a private component (d) — refusing to store');
  }

  // Only the members that define the key. Dropping `ext`, `key_ops` and friends
  // keeps the stored form canonical, so the same key always yields the same kid.
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/**
 * Turn a validated JWK into a Node KeyObject usable by crypto.verify().
 * Throws if the coordinates are not actually a point on the P-256 curve —
 * structural validation above does not catch that, but importKey does.
 */
export function importPublicKey(jwk) {
  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (cause) {
    throw new InvalidKeyError(`Not a valid P-256 public key: ${cause.message}`);
  }
}

/** Short, stable identifier for a key — for display and log correlation only. */
export function keyId(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = crypto.createHash('sha256').update(canonical).digest('base64url');
  return `k_${digest.slice(0, 16)}`;
}

/** Convenience: validate, import, and derive the kid in one step. */
export function prepareKeyForStorage(rawJwk) {
  const jwk = validatePublicJwk(rawJwk);
  importPublicKey(jwk); // throws for an off-curve point; result discarded
  return { jwk, kid: keyId(jwk), algorithm: ALGORITHM };
}
