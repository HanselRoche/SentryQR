import crypto from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
// Node's scrypt default maxmem is 32MB; N=16384 with r=8 needs ~16MB, so this
// fits without raising the limit.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

/**
 * Constant-time password check.
 *
 * timingSafeEqual is the point: a plain `===` on hex strings short-circuits at
 * the first differing character, so response time would leak how many leading
 * bytes an attacker had guessed correctly.
 */
export function verifyPassword(password, storedHashHex, storedSaltHex) {
  const expected = Buffer.from(storedHashHex, 'hex');
  const salt = Buffer.from(storedSaltHex, 'hex');

  if (expected.length !== KEY_BYTES) return false;

  const actual = crypto.scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}
