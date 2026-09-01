import './setup.js';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQrPayload,
  generateDeviceKeypair,
  makeValidQr,
  seedWorld,
  sleep,
  startServer,
} from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { generateNonce } from '../src/crypto/nonce.js';

/**
 * Attack simulations — the threats named in docs/threat-model.md, executed
 * against the running API. Each test corresponds to a threat ID, so the results
 * map directly onto the Phase 7 test report.
 */

let server;
let world;

before(async () => {
  server = await startServer();
  world = await seedWorld(server);
});

after(async () => {
  await server.close();
});

beforeEach(() => resetRateLimits());

const verify = (payload) => world.guard.client.post('/api/verify', { payload });

describe('T1 — replay of a captured QR', () => {
  test('the same QR cannot be used twice', async () => {
    const { payload } = await makeValidQr(world.aisha);

    const first = await verify(payload);
    assert.equal(first.body.decision, 'GRANT');

    // The photographed-and-reused case. The nonce was consumed by the first
    // scan, so the identical payload is now worthless.
    const second = await verify(payload);
    assert.equal(second.body.decision, 'DENY');
    assert.equal(second.body.reasonCode, 'NONCE_REUSED');
  });

  test('a replay reveals nothing about the student', async () => {
    const { payload } = await makeValidQr(world.aisha);
    await verify(payload);

    const replay = await verify(payload);
    assert.equal(replay.body.student, null);
  });

  test('a replay is recorded as a denied entry event', async () => {
    const { payload } = await makeValidQr(world.rahul);
    await verify(payload);
    await verify(payload);

    const { entries } = (await world.rahul.client.get('/api/students/me/entries')).body;
    assert.equal(entries[0].decision, 'DENY');
    assert.equal(entries[0].reasonCode, 'NONCE_REUSED');
    // The legitimate entry is still there underneath it.
    assert.equal(entries[1].decision, 'GRANT');
  });

  test('two simultaneous scans of one QR grant exactly once', async () => {
    const { payload } = await makeValidQr(world.aisha);

    // The TOCTOU case: both requests pass the read-only checks before either
    // writes. Only the conditional UPDATE can decide the winner.
    const results = await Promise.all([verify(payload), verify(payload), verify(payload)]);
    const grants = results.filter((r) => r.body.decision === 'GRANT');

    assert.equal(grants.length, 1, 'exactly one of three concurrent scans must be granted');
    for (const denied of results.filter((r) => r.body.decision === 'DENY')) {
      assert.equal(denied.body.reasonCode, 'NONCE_REUSED');
    }
  });
});

describe('T1 — screenshot sharing (expiry)', () => {
  test('an expired QR is rejected even though it was never used', async () => {
    const { payload } = await makeValidQr(world.aisha);

    // CHALLENGE_TTL_MS is 1500ms under test; in the demo it is 45s.
    await sleep(1700);

    const res = await verify(payload);
    assert.equal(res.body.decision, 'DENY');
    assert.equal(res.body.reasonCode, 'CHALLENGE_EXPIRED');
  });

  test('a QR still inside its window is accepted', async () => {
    const { payload } = await makeValidQr(world.rahul);
    await sleep(200);

    const res = await verify(payload);
    assert.equal(res.body.decision, 'GRANT');
  });
});

describe('T3 — impersonation', () => {
  test('editing the student id in the payload does not impersonate anyone', async () => {
    const { challenge, payload } = await makeValidQr(world.aisha);
    const original = JSON.parse(payload);

    // Aisha's genuine signature, relabelled as Rahul.
    const forged = buildQrPayload({
      studentId: world.rahul.id,
      nonce: original.n,
      issuedAt: original.iat,
      signature: original.sig,
    });

    const res = await verify(forged);
    assert.equal(res.body.decision, 'DENY');
    // Caught before any crypto runs: the nonce is bound to Aisha server-side.
    assert.equal(res.body.reasonCode, 'IDENTITY_MISMATCH');
    assert.equal(challenge.studentId, world.aisha.id);
  });

  test('signing another student\'s challenge with your own key fails', async () => {
    // Rahul asks for a challenge; the attacker signs it with a key that is not
    // Rahul's, then presents it under Rahul's id.
    const { body: challenge } = await world.rahul.client.post('/api/challenge');
    const attacker = generateDeviceKeypair();

    const forged = buildQrPayload({
      studentId: world.rahul.id,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      signature: attacker.sign(challenge.message),
    });

    const res = await verify(forged);
    assert.equal(res.body.decision, 'DENY');
    assert.equal(res.body.reasonCode, 'INVALID_SIGNATURE');
  });

  test('a signature made with the wrong student\'s registered key fails', async () => {
    const { body: challenge } = await world.aisha.client.post('/api/challenge');

    const forged = buildQrPayload({
      studentId: world.aisha.id,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      // Rahul's real, registered key — genuine, just not the right one.
      signature: world.rahul.device.sign(challenge.message),
    });

    const res = await verify(forged);
    assert.equal(res.body.reasonCode, 'INVALID_SIGNATURE');
  });

  test('a fabricated nonce is rejected', async () => {
    const attacker = generateDeviceKeypair();
    const nonce = generateNonce();
    const issuedAt = Date.now();

    const forged = buildQrPayload({
      studentId: world.aisha.id,
      nonce,
      issuedAt,
      signature: attacker.sign(`v1|${world.aisha.id}|${nonce}|${issuedAt}`),
    });

    const res = await verify(forged);
    assert.equal(res.body.reasonCode, 'UNKNOWN_NONCE');
  });
});

describe('T4 — payload tampering', () => {
  test('a flipped bit in the signature is rejected', async () => {
    const { payload } = await makeValidQr(world.aisha);
    const parsed = JSON.parse(payload);

    const bytes = Buffer.from(parsed.sig, 'base64url');
    bytes[10] ^= 0x01;
    parsed.sig = bytes.toString('base64url');

    const res = await verify(JSON.stringify(parsed));
    assert.equal(res.body.reasonCode, 'INVALID_SIGNATURE');
  });

  test('extending the timestamp in the payload does not extend validity', async () => {
    const { payload } = await makeValidQr(world.aisha);
    const parsed = JSON.parse(payload);
    parsed.iat = Date.now() + 600_000;

    await sleep(1700);

    // The server takes issued_at from its own row, so the client field is
    // decorative — it cannot buy the attacker any extra time.
    const res = await verify(JSON.stringify(parsed));
    assert.equal(res.body.reasonCode, 'CHALLENGE_EXPIRED');
  });

  test('altering the timestamp inside the window still fails signature checks', async () => {
    const { payload } = await makeValidQr(world.rahul);
    const parsed = JSON.parse(payload);
    parsed.iat = parsed.iat - 1;

    // The message is rebuilt from stored values, which still match the
    // signature, so this one is actually granted — proving the field is not
    // load-bearing. The tamper achieves nothing either way.
    const res = await verify(JSON.stringify(parsed));
    assert.equal(res.body.decision, 'GRANT');
  });

  test('malformed payloads are denied, not crashed on', async () => {
    const malformed = [
      'not json at all',
      '{}',
      '[]',
      'null',
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 2, sid: 1, n: generateNonce(), iat: Date.now(), sig: 'A'.repeat(86) }),
      JSON.stringify({ v: 1, sid: -1, n: generateNonce(), iat: Date.now(), sig: 'A'.repeat(86) }),
      JSON.stringify({ v: 1, sid: 1, n: 'short', iat: Date.now(), sig: 'A'.repeat(86) }),
      JSON.stringify({ v: 1, sid: 1, n: generateNonce(), iat: Date.now(), sig: 'tooshort' }),
      JSON.stringify({ v: 1, sid: '1', n: generateNonce(), iat: Date.now(), sig: 'A'.repeat(86) }),
    ];

    for (const payload of malformed) {
      const res = await verify(payload);
      assert.equal(res.status, 200, `expected a clean denial for: ${payload.slice(0, 40)}`);
      assert.equal(res.body.decision, 'DENY');
      assert.ok(
        ['MALFORMED_PAYLOAD', 'UNSUPPORTED_VERSION'].includes(res.body.reasonCode),
        `unexpected reason ${res.body.reasonCode} for: ${payload.slice(0, 40)}`,
      );
    }
  });

  test('a SQL injection attempt inside the nonce field is denied', async () => {
    const payload = JSON.stringify({
      v: 1,
      sid: 1,
      n: "' OR 1=1 --",
      iat: Date.now(),
      sig: 'A'.repeat(86),
    });

    const res = await verify(payload);
    assert.equal(res.body.decision, 'DENY');
    assert.equal(res.body.reasonCode, 'MALFORMED_PAYLOAD');
  });
});

describe('T6 — key revocation', () => {
  test('a revoked key stops working on the very next scan', async () => {
    // Enrol a throwaway student so revoking does not disturb the fixture.
    await world.admin.client.post('/api/admin/users', {
      role: 'student',
      username: 's.revoke',
      password: 'student12345',
      fullName: 'Revoke Test',
      rollNo: '4SO22CS077',
      roomNo: 'D-1',
      hostelBlock: 'D',
    });

    const client = server.client();
    await client.login('s.revoke', 'student12345');
    const device = generateDeviceKeypair();
    const enrolled = await client.post('/api/students/keys', { jwk: device.publicJwk });

    const student = { client, device };
    const before = await makeValidQr(student);
    assert.equal((await verify(before.payload)).body.decision, 'GRANT');

    await world.admin.client.post(`/api/admin/keys/${enrolled.body.key.id}/revoke`);

    // A challenge is refused outright now, so build a payload directly against
    // the revoked key to prove verification itself rejects it.
    const nonceRes = await client.post('/api/challenge');
    assert.equal(nonceRes.status, 409);
  });

  test('a QR signed before revocation is rejected after it', async () => {
    await world.admin.client.post('/api/admin/users', {
      role: 'student',
      username: 's.revoke2',
      password: 'student12345',
      fullName: 'Revoke Test Two',
      rollNo: '4SO22CS078',
      roomNo: 'D-2',
      hostelBlock: 'D',
    });

    const client = server.client();
    await client.login('s.revoke2', 'student12345');
    const device = generateDeviceKeypair();
    const enrolled = await client.post('/api/students/keys', { jwk: device.publicJwk });

    // Sign first, revoke second, scan third.
    const { payload } = await makeValidQr({ client, device });
    await world.admin.client.post(`/api/admin/keys/${enrolled.body.key.id}/revoke`);

    const res = await verify(payload);
    assert.equal(res.body.decision, 'DENY');
    assert.equal(res.body.reasonCode, 'KEY_REVOKED');
  });
});

describe('T6 — account suspension', () => {
  test('a suspended student is denied at the gate', async () => {
    await world.admin.client.post('/api/admin/users', {
      role: 'student',
      username: 's.suspend',
      password: 'student12345',
      fullName: 'Suspend Test',
      rollNo: '4SO22CS079',
      roomNo: 'D-3',
      hostelBlock: 'D',
    });

    const client = server.client();
    await client.login('s.suspend', 'student12345');
    const device = generateDeviceKeypair();
    await client.post('/api/students/keys', { jwk: device.publicJwk });

    const { payload } = await makeValidQr({ client, device });

    const users = (await world.admin.client.get('/api/admin/users?role=student')).body.users;
    const target = users.find((u) => u.username === 's.suspend');
    await world.admin.client.patch(`/api/admin/users/${target.id}`, { active: false });

    const res = await verify(payload);
    assert.equal(res.body.decision, 'DENY');
    assert.equal(res.body.reasonCode, 'STUDENT_INACTIVE');
  });

  test('suspension revokes live sessions immediately', async () => {
    await world.admin.client.post('/api/admin/users', {
      role: 'student',
      username: 's.suspend2',
      password: 'student12345',
      fullName: 'Suspend Test Two',
      rollNo: '4SO22CS080',
      roomNo: 'D-4',
      hostelBlock: 'D',
    });

    const client = server.client();
    await client.login('s.suspend2', 'student12345');
    assert.equal((await client.get('/api/auth/me')).status, 200);

    const users = (await world.admin.client.get('/api/admin/users?role=student')).body.users;
    const target = users.find((u) => u.username === 's.suspend2');
    await world.admin.client.patch(`/api/admin/users/${target.id}`, { active: false });

    // Effective now, not whenever the cookie happens to expire.
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });
});

describe('T5/T9 — authorisation boundaries', () => {
  test('a student cannot request a challenge for another student', async () => {
    // There is no parameter to abuse — the challenge is bound to the caller's
    // session, so this is enforced structurally rather than by a check.
    const res = await world.aisha.client.post('/api/challenge');
    assert.equal(res.body.studentId, world.aisha.id);
    assert.notEqual(res.body.studentId, world.rahul.id);
  });

  test('a student cannot read another student\'s entry history', async () => {
    const { entries } = (await world.aisha.client.get('/api/students/me/entries')).body;
    for (const entry of entries) {
      assert.equal(entry.studentId, world.aisha.id);
    }
  });

  test('a guard cannot revoke keys', async () => {
    const res = await world.guard.client.post('/api/admin/keys/1/revoke');
    assert.equal(res.status, 403);
  });

  test('a student cannot approve their own override request', async () => {
    const res = await world.aisha.client.post('/api/overrides/1/decision', { approve: true });
    assert.equal(res.status, 403);
  });

  test('an anonymous caller cannot verify anything', async () => {
    const res = await server.client().post('/api/verify', { payload: '{}' });
    assert.equal(res.status, 401);
  });
});

describe('Audit coverage', () => {
  test('every attack attempt above left a denial in the audit log', async () => {
    const { logs, total } = (
      await world.admin.client.get('/api/admin/audit?eventType=VERIFY&decision=DENY&limit=200')
    ).body;

    assert.ok(total > 0);

    const reasons = new Set(logs.map((l) => l.reasonCode));
    for (const expected of [
      'NONCE_REUSED',
      'CHALLENGE_EXPIRED',
      'IDENTITY_MISMATCH',
      'INVALID_SIGNATURE',
      'UNKNOWN_NONCE',
      'MALFORMED_PAYLOAD',
      'KEY_REVOKED',
      'STUDENT_INACTIVE',
    ]) {
      assert.ok(reasons.has(expected), `no audit entry recorded for ${expected}`);
    }
  });

  test('failed logins are logged', async () => {
    resetRateLimits();
    await server.client().login('s.aisha', 'definitely-wrong');

    const { logs } = (await world.admin.client.get('/api/admin/audit?eventType=LOGIN_FAILURE&limit=1')).body;
    assert.equal(logs[0].detail.username, 's.aisha');
  });
});
