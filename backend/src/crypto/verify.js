import crypto from 'node:crypto';
import { config } from '../config.js';
import { importPublicKey } from './keys.js';

/**
 * The canonical message that gets signed.
 *
 * A fixed-order delimited string rather than JSON, because JSON member ordering
 * is not guaranteed to be identical across engines and any difference — even
 * one byte of whitespace — makes a valid signature fail to verify.
 *
 * The leading version tag means the format can change later without a stale
 * payload being verified under the new rules.
 *
 *     v1|<studentUserId>|<nonce>|<issuedAtEpochMs>
 *
 * `frontend/src/lib/webcrypto.js` builds the same string. If one side changes,
 * both must.
 */
export function canonicalMessage({ studentId, nonce, issuedAt }) {
  return `v${config.payloadVersion}|${studentId}|${nonce}|${issuedAt}`;
}

/**
 * Verify an ECDSA P-256 / SHA-256 signature.
 *
 * `dsaEncoding: 'ieee-p1363'` is not optional. WebCrypto's ECDSA emits a raw
 * 64-byte r‖s signature, while node:crypto defaults to expecting DER. Omit this
 * option and every genuine signature is rejected — and the failure is
 * indistinguishable from a real tampering attempt, which makes it a
 * nasty bug to chase. Covered by a dedicated test.
 *
 * @param {object}  publicJwk       stored public key
 * @param {string}  message         canonical string (NOT client-supplied)
 * @param {string}  signatureB64url base64url r‖s from the QR payload
 * @returns {boolean}
 */
export function verifySignature(publicJwk, message, signatureB64url) {
  let signature;
  try {
    signature = Buffer.from(signatureB64url, 'base64url');
  } catch {
    return false;
  }

  // P-256 r‖s is exactly 64 bytes. Anything else is malformed, and rejecting it
  // early keeps malformed input away from the crypto layer.
  if (signature.length !== 64) return false;

  let keyObject;
  try {
    keyObject = importPublicKey(publicJwk);
  } catch {
    return false;
  }

  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    // crypto.verify throws on some malformed inputs rather than returning
    // false. Either way the answer is "not verified".
    return false;
  }
}

/**
 * Sign with a P-256 private key, producing the same raw r‖s encoding WebCrypto
 * produces. Server-side signing has no place in the production flow — this
 * exists so tests can generate genuine student payloads without a browser.
 */
export function signForTest(privateKeyObject, message) {
  return crypto
    .sign('sha256', Buffer.from(message, 'utf8'), {
      key: privateKeyObject,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');
}

/** SHA-256 hex digest — message integrity helper used in audit detail. */
export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}
