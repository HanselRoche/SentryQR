import './setup.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { canonicalMessage, verifySignature } from '../src/crypto/verify.js';
import { validatePublicJwk } from '../src/crypto/keys.js';
import { generateNonce } from '../src/crypto/nonce.js';

/**
 * Interoperability between the browser's WebCrypto and the server's node:crypto.
 *
 * Node exposes the same standard SubtleCrypto the browser does, so this
 * exercises the literal client code path from frontend/src/lib/webcrypto.js
 * rather than a Node-side approximation of it. If this suite passes, a real
 * browser's signature verifies server-side.
 */

const { subtle } = webcrypto;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: { name: 'SHA-256' } };

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

/** Mirrors generateDeviceKey() in the frontend, including extractable=false. */
async function browserEnrol() {
  const pair = await subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
  const exported = await subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y },
  };
}

/** Mirrors signChallenge() in the frontend. */
async function browserSign(privateKey, message) {
  return base64url(await subtle.sign(SIGN_PARAMS, privateKey, new TextEncoder().encode(message)));
}

describe('WebCrypto ↔ node:crypto interoperability', () => {
  test('a signature produced by SubtleCrypto verifies server-side', async () => {
    const device = await browserEnrol();
    const message = canonicalMessage({ studentId: 2, nonce: generateNonce(), issuedAt: Date.now() });

    const signature = await browserSign(device.privateKey, message);

    // The whole system hinges on this line. It fails if the server drops
    // dsaEncoding: 'ieee-p1363', because WebCrypto emits raw r‖s and node:crypto
    // defaults to expecting DER.
    assert.equal(verifySignature(device.publicJwk, message, signature), true);
  });

  test('WebCrypto emits raw 64-byte r‖s, not DER', async () => {
    const device = await browserEnrol();
    const signature = await browserSign(device.privateKey, 'v1|1|abc|123');
    const bytes = Buffer.from(signature, 'base64url');

    assert.equal(bytes.length, 64);
    // DER signatures start with the SEQUENCE tag 0x30. A raw one almost never
    // will, and never with a length byte that matches.
    assert.notEqual(bytes[0], 0x30);
  });

  test('the exported public JWK is exactly what the server accepts', async () => {
    const device = await browserEnrol();
    const validated = validatePublicJwk(device.publicJwk);

    assert.deepEqual(validated, device.publicJwk);
    assert.equal(validated.crv, 'P-256');
    // No private component ever appears in what the browser sends.
    assert.equal('d' in device.publicJwk, false);
  });

  test('the private key is genuinely non-extractable', async () => {
    const pair = await subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);

    assert.equal(pair.privateKey.extractable, false);
    // This is the property threat T2 rests on: no code, ours or an attacker's,
    // can serialize the private key out of the browser.
    await assert.rejects(() => subtle.exportKey('jwk', pair.privateKey));
    await assert.rejects(() => subtle.exportKey('pkcs8', pair.privateKey));
  });

  test('a signature over a tampered message fails, end to end', async () => {
    const device = await browserEnrol();
    const message = canonicalMessage({ studentId: 2, nonce: generateNonce(), issuedAt: Date.now() });
    const signature = await browserSign(device.privateKey, message);

    const tampered = canonicalMessage({
      studentId: 3, // an attacker relabelling the payload
      nonce: message.split('|')[2],
      issuedAt: Number(message.split('|')[3]),
    });

    assert.equal(verifySignature(device.publicJwk, tampered, signature), false);
  });

  test('ECDSA is randomised — the same message signs differently each time', async () => {
    const device = await browserEnrol();
    const message = 'v1|1|abc|123';

    const first = await browserSign(device.privateKey, message);
    const second = await browserSign(device.privateKey, message);

    // ECDSA includes a per-signature random k, so identical payloads do not
    // produce identical signatures. Both must still verify.
    assert.notEqual(first, second);
    assert.equal(verifySignature(device.publicJwk, message, first), true);
    assert.equal(verifySignature(device.publicJwk, message, second), true);
  });
});
