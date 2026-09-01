import './setup.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { canonicalMessage, signForTest, verifySignature } from '../src/crypto/verify.js';
import { InvalidKeyError, keyId, prepareKeyForStorage, validatePublicJwk } from '../src/crypto/keys.js';
import { hashPassword, verifyPassword } from '../src/crypto/password.js';
import { generateNonce, isValidNonceFormat } from '../src/crypto/nonce.js';
import { generateDeviceKeypair } from './helpers.js';

describe('Phase 2 — signing and verification', () => {
  const device = generateDeviceKeypair();
  const message = canonicalMessage({ studentId: 7, nonce: generateNonce(), issuedAt: 1735689600000 });

  test('a genuine signature verifies', () => {
    const signature = device.sign(message);
    assert.equal(verifySignature(device.publicJwk, message, signature), true);
  });

  test('a tampered message is rejected', () => {
    const signature = device.sign(message);
    assert.equal(verifySignature(device.publicJwk, `${message}x`, signature), false);
  });

  test('a tampered signature is rejected', () => {
    const signature = device.sign(message);
    const bytes = Buffer.from(signature, 'base64url');
    bytes[0] ^= 0xff;
    assert.equal(verifySignature(device.publicJwk, message, bytes.toString('base64url')), false);
  });

  test('a signature from a different keypair is rejected', () => {
    const impostor = generateDeviceKeypair();
    const signature = impostor.sign(message);
    assert.equal(verifySignature(device.publicJwk, message, signature), false);
  });

  test('a DER-encoded signature is rejected under IEEE P1363', () => {
    // The encoding mismatch that breaks a WebCrypto client against a
    // default-configured Node verifier. DER is the wrong shape here, and it
    // must fail cleanly rather than throw.
    const der = crypto
      .sign('sha256', Buffer.from(message, 'utf8'), { key: device.privateKey })
      .toString('base64url');
    assert.equal(verifySignature(device.publicJwk, message, der), false);
  });

  test('a signature of the wrong length is rejected without throwing', () => {
    assert.equal(verifySignature(device.publicJwk, message, 'AAAA'), false);
    assert.equal(verifySignature(device.publicJwk, message, ''), false);
  });

  test('canonical message is stable and uses the documented layout', () => {
    assert.equal(canonicalMessage({ studentId: 2, nonce: 'abc', issuedAt: 100 }), 'v1|2|abc|100');
  });

  test('signatures are the raw 64-byte r‖s WebCrypto produces', () => {
    assert.equal(Buffer.from(device.sign(message), 'base64url').length, 64);
  });
});

describe('Phase 2 — public key validation', () => {
  const device = generateDeviceKeypair();

  test('accepts a well-formed P-256 public JWK', () => {
    const jwk = validatePublicJwk(device.publicJwk);
    assert.deepEqual(Object.keys(jwk).sort(), ['crv', 'kty', 'x', 'y']);
  });

  test('strips non-defining members so the kid stays stable', () => {
    const withExtras = { ...device.publicJwk, ext: true, key_ops: ['verify'], use: 'sig' };
    assert.equal(keyId(validatePublicJwk(withExtras)), keyId(validatePublicJwk(device.publicJwk)));
  });

  test('rejects a JWK carrying a private component', () => {
    // The critical one: a private key must never be stored server-side, or the
    // non-repudiation property the whole system rests on is gone.
    const withPrivate = { ...device.publicJwk, d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    assert.throws(() => validatePublicJwk(withPrivate), InvalidKeyError);
  });

  test('rejects the wrong curve and the wrong key type', () => {
    assert.throws(() => validatePublicJwk({ ...device.publicJwk, crv: 'P-384' }), InvalidKeyError);
    assert.throws(() => validatePublicJwk({ ...device.publicJwk, kty: 'RSA' }), InvalidKeyError);
  });

  test('rejects malformed and wrong-length coordinates', () => {
    assert.throws(() => validatePublicJwk({ ...device.publicJwk, x: 'not base64!!' }), InvalidKeyError);
    assert.throws(() => validatePublicJwk({ ...device.publicJwk, y: 'AAAA' }), InvalidKeyError);
    assert.throws(() => validatePublicJwk({ ...device.publicJwk, x: undefined }), InvalidKeyError);
  });

  test('rejects a point that is not actually on the curve', () => {
    const offCurve = { ...device.publicJwk, x: Buffer.alloc(32, 1).toString('base64url') };
    assert.throws(() => prepareKeyForStorage(offCurve), InvalidKeyError);
  });

  test('rejects non-object input', () => {
    for (const bad of [null, 'string', 42, []]) {
      assert.throws(() => validatePublicJwk(bad), InvalidKeyError);
    }
  });
});

describe('Phase 2 — password hashing', () => {
  test('a correct password verifies', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('correct horse battery staple', hash, salt), true);
  });

  test('a wrong password is rejected', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    assert.equal(verifyPassword('Correct horse battery staple', hash, salt), false);
  });

  test('the same password hashes differently each time', () => {
    // Distinct random salts, so identical passwords are not identifiable from
    // the stored hashes.
    const a = hashPassword('same');
    const b = hashPassword('same');
    assert.notEqual(a.hash, b.hash);
    assert.notEqual(a.salt, b.salt);
  });

  test('a corrupted stored hash does not throw', () => {
    assert.equal(verifyPassword('anything', 'ab', '00'), false);
  });
});

describe('Phase 2 — nonces', () => {
  test('are 32 bytes of base64url', () => {
    const nonce = generateNonce();
    assert.equal(Buffer.from(nonce, 'base64url').length, 32);
    assert.equal(isValidNonceFormat(nonce), true);
  });

  test('do not repeat', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i += 1) seen.add(generateNonce());
    assert.equal(seen.size, 1000);
  });

  test('contain no field separator, so the canonical message stays unambiguous', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.equal(generateNonce().includes('|'), false);
    }
  });

  test('format check rejects malformed values', () => {
    assert.equal(isValidNonceFormat('short'), false);
    assert.equal(isValidNonceFormat(null), false);
    assert.equal(isValidNonceFormat(`${'a'.repeat(42)}+`), false);
  });
});
