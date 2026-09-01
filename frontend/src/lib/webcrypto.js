import { clearKeyPair, loadKeyPair, saveKeyPair } from './keystore.js';

/**
 * The student device's cryptographic identity.
 *
 * Everything here runs in the browser. The private key is generated locally and
 * never crosses the network in any form — only the public half is registered
 * with the server.
 */

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: { name: 'SHA-256' } };

/**
 * Generate this device's signing keypair.
 *
 * The `false` in the second argument is the single most important character in
 * the frontend: it marks the private key non-extractable. With it set,
 * crypto.subtle.exportKey() on the private key throws, structured clone stores
 * only an opaque handle, and no JavaScript — ours, an injected script's, or an
 * attacker's — can read the key material out of the browser.
 *
 * That is what makes credential sharing (threat T2) impossible: there is no
 * artefact to screenshot, copy, or send to a friend.
 */
export async function generateDeviceKey() {
  if (!window.isSecureContext) {
    throw new Error(
      'WebCrypto requires a secure context. Use http://localhost or enable HTTPS.',
    );
  }

  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);

  // Only the public key is extractable, and exporting it is exactly what we
  // want — it has to reach the server to be useful.
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    // Trimmed to the members that define the key; the server canonicalises to
    // the same four, so the derived key id matches on both sides.
    publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
  };
}

/**
 * Sign the server-issued challenge.
 *
 * WebCrypto's ECDSA output is the raw 64-byte r‖s form (IEEE P1363), not DER.
 * The server must verify with `dsaEncoding: 'ieee-p1363'` to match. If that
 * option is ever dropped server-side, every signature here starts failing and
 * looks exactly like a tampering attack.
 */
export async function signChallenge(privateKey, message) {
  const signature = await crypto.subtle.sign(
    SIGN_PARAMS,
    privateKey,
    new TextEncoder().encode(message),
  );
  return base64url(signature);
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The exact string the QR carries. Compact keys keep the QR small. */
export function buildQrPayload({ studentId, nonce, issuedAt, signature }) {
  return JSON.stringify({ v: 1, sid: studentId, n: nonce, iat: issuedAt, sig: signature });
}

/**
 * Demonstration helper for the viva: proves the private key genuinely cannot be
 * exported. Returns true when the export attempt fails, which is the desired
 * outcome.
 */
export async function provePrivateKeyIsNonExtractable(privateKey) {
  if (privateKey.extractable) return false;
  try {
    await crypto.subtle.exportKey('jwk', privateKey);
    return false; // Should be unreachable.
  } catch {
    return true;
  }
}

export { loadKeyPair, saveKeyPair, clearKeyPair };
