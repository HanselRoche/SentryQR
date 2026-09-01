import './setup.js';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateDeviceKeypair, makeValidQr, seedWorld, startServer } from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

let server;
let world;

before(async () => {
  server = await startServer();
  world = await seedWorld(server);
});

// The limiter is module state keyed partly by IP, and every test here comes
// from 127.0.0.1. Without a reset the login budget from one test throttles the
// next, which would make failures look like auth bugs.
beforeEach(() => resetRateLimits());

after(async () => {
  await server.close();
});

describe('Phase 4 — authentication and roles', () => {
  test('valid credentials return the user and set a session cookie', async () => {
    const client = server.client();
    const res = await client.login('s.aisha', 'student12345');

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'student');
    assert.equal(res.body.user.fullName, 'Aisha Rahman');
    assert.match(res.headers.getSetCookie()[0], /^sentryqr_sid=/);
  });

  test('the session cookie is HttpOnly and SameSite=Lax', async () => {
    const client = server.client();
    const res = await client.login('s.aisha', 'student12345');
    const cookie = res.headers.getSetCookie()[0];

    // HttpOnly keeps the session out of reach of any injected script.
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  test('a wrong password is rejected', async () => {
    resetRateLimits();
    const res = await server.client().login('s.aisha', 'wrong-password');
    assert.equal(res.status, 401);
  });

  test('unknown and known usernames fail identically', async () => {
    resetRateLimits();
    const unknown = await server.client().login('does.not.exist', 'whatever12345');
    resetRateLimits();
    const known = await server.client().login('s.aisha', 'wrong-password');

    // Identical responses, or the endpoint enumerates valid usernames.
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
  });

  test('protected routes reject an anonymous caller', async () => {
    const res = await server.client().post('/api/challenge');
    assert.equal(res.status, 401);
  });

  test('a student cannot call the guard verification endpoint', async () => {
    const res = await world.aisha.client.post('/api/verify', { payload: '{}' });
    assert.equal(res.status, 403);
  });

  test('a guard cannot reach the admin dashboard', async () => {
    const res = await world.guard.client.get('/api/admin/users');
    assert.equal(res.status, 403);
  });

  test('logout invalidates the session', async () => {
    const client = server.client();
    await client.login('s.rahul', 'student12345');
    assert.equal((await client.get('/api/auth/me')).status, 200);

    await client.post('/api/auth/logout');
    assert.equal((await client.get('/api/auth/me')).status, 401);
  });
});

describe('Phase 2/5 — device key enrolment', () => {
  test('a student starts with no active key', async () => {
    const created = await world.admin.client.post('/api/admin/users', {
      role: 'student',
      username: 's.newbie',
      password: 'student12345',
      fullName: 'New Student',
      rollNo: '4SO22CS009',
      roomNo: 'C-301',
      hostelBlock: 'C',
    });
    assert.equal(created.status, 201);

    const newClient = server.client();
    await newClient.login('s.newbie', 'student12345');
    const me = await newClient.get('/api/students/me');

    assert.equal(me.body.activeKey, null);
    assert.equal(me.body.student.rollNo, '4SO22CS009');
  });

  test('a challenge is refused before a key is enrolled', async () => {
    const client = server.client();
    await client.login('s.newbie', 'student12345');
    const res = await client.post('/api/challenge');

    // Issuing a nonce that can never be signed would be pointless.
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  test('enrolment stores the key and makes it active', async () => {
    const client = server.client();
    await client.login('s.newbie', 'student12345');
    const device = generateDeviceKeypair();

    const res = await client.post('/api/students/keys', { jwk: device.publicJwk });
    assert.equal(res.status, 201);
    assert.match(res.body.key.kid, /^k_/);

    const me = await client.get('/api/students/me');
    assert.equal(me.body.activeKey.kid, res.body.key.kid);
  });

  test('the server refuses a JWK containing a private component', async () => {
    const client = server.client();
    await client.login('s.newbie', 'student12345');
    const device = generateDeviceKeypair();

    const res = await client.post('/api/students/keys', {
      jwk: { ...device.publicJwk, d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /private component/);
  });

  test('re-enrolling supersedes the previous key instead of adding a second', async () => {
    const client = server.client();
    await client.login('s.newbie', 'student12345');

    const first = (await client.get('/api/students/me')).body.activeKey;
    const second = generateDeviceKeypair();
    await client.post('/api/students/keys', { jwk: second.publicJwk });

    const active = (await client.get('/api/students/me')).body.activeKey;
    assert.notEqual(active.kid, first.kid);

    // Threat T6: exactly one live key at a time, so a silent parallel key is
    // impossible and a displaced student notices immediately.
    const keys = (await world.admin.client.get('/api/admin/keys?includeRevoked=true')).body.keys;
    const mine = keys.filter((k) => k.id === first.id || k.id === active.id);
    assert.equal(mine.filter((k) => k.active).length, 1);
  });
});

describe('Phase 3 — challenge issuance', () => {
  test('a challenge carries a nonce, a window, and the exact message to sign', async () => {
    const res = await world.aisha.client.post('/api/challenge');

    assert.equal(res.status, 201);
    assert.equal(res.body.studentId, world.aisha.id);
    assert.equal(Buffer.from(res.body.nonce, 'base64url').length, 32);
    assert.equal(res.body.expiresAt - res.body.issuedAt, res.body.ttlMs);
    assert.equal(res.body.message, `v1|${world.aisha.id}|${res.body.nonce}|${res.body.issuedAt}`);
  });

  test('every challenge is unique', async () => {
    const seen = new Set();
    for (let i = 0; i < 10; i += 1) {
      seen.add((await world.aisha.client.post('/api/challenge')).body.nonce);
    }
    assert.equal(seen.size, 10);
  });

  test('the QR payload stays small enough to scan comfortably', async () => {
    const { payload } = await makeValidQr(world.aisha);
    // Roughly QR version 9 at error-correction M — reliable off a phone screen.
    assert.ok(payload.length < 260, `payload was ${payload.length} chars`);
  });
});

describe('Phase 4 — the happy path', () => {
  test('a freshly signed QR is granted, with the student identified', async () => {
    const { payload } = await makeValidQr(world.aisha);
    const res = await world.guard.client.post('/api/verify', { payload });

    assert.equal(res.status, 200);
    assert.equal(res.body.decision, 'GRANT');
    assert.equal(res.body.reasonCode, 'OK');
    assert.equal(res.body.student.fullName, 'Aisha Rahman');
    assert.equal(res.body.student.roomNo, 'B-204');
  });

  test('a granted entry appears in the student history', async () => {
    const { payload } = await makeValidQr(world.rahul);
    await world.guard.client.post('/api/verify', { payload });

    const { entries } = (await world.rahul.client.get('/api/students/me/entries')).body;
    assert.equal(entries[0].decision, 'GRANT');
    assert.equal(entries[0].guardName, 'Ramesh Kamath');
  });

  test('the decision is audit-logged', async () => {
    const { payload } = await makeValidQr(world.aisha);
    await world.guard.client.post('/api/verify', { payload });

    const { logs } = (await world.admin.client.get('/api/admin/audit?eventType=VERIFY&limit=1')).body;
    assert.equal(logs[0].decision, 'GRANT');
    assert.equal(logs[0].actorName, 'Ramesh Kamath');
    assert.equal(logs[0].subjectName, 'Aisha Rahman');
  });
});

describe('Phase 5 — manual override', () => {
  test('a guard request grants nothing until an admin approves it', async () => {
    const res = await world.guard.client.post('/api/overrides', {
      rollNo: '4SO22CS001',
      reason: 'Phone battery dead, student ID card verified visually',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.override.status, 'pending');

    const pending = (await world.admin.client.get('/api/overrides?status=pending')).body.overrides;
    assert.ok(pending.some((o) => o.id === res.body.override.id));
  });

  test('approval writes a real entry event, so an override is never invisible', async () => {
    const created = await world.guard.client.post('/api/overrides', {
      rollNo: '4SO22CS002',
      reason: 'Lost phone, warden confirmed identity by phone',
    });

    const decided = await world.admin.client.post(`/api/overrides/${created.body.override.id}/decision`, {
      approve: true,
      note: 'Confirmed with warden',
    });

    assert.equal(decided.status, 200);
    assert.equal(decided.body.status, 'approved');

    const { entries } = (await world.rahul.client.get('/api/students/me/entries')).body;
    assert.equal(entries[0].reasonCode, 'MANUAL_OVERRIDE');
    assert.equal(entries[0].decision, 'GRANT');
  });

  test('an override cannot be decided twice', async () => {
    const created = await world.guard.client.post('/api/overrides', {
      rollNo: '4SO22CS001',
      reason: 'Testing double decision handling',
    });
    const id = created.body.override.id;

    await world.admin.client.post(`/api/overrides/${id}/decision`, { approve: false });
    const second = await world.admin.client.post(`/api/overrides/${id}/decision`, { approve: true });

    assert.equal(second.status, 409);
  });

  test('an override for an unknown roll number is refused', async () => {
    const res = await world.guard.client.post('/api/overrides', {
      rollNo: 'NOTAROLL',
      reason: 'This student does not exist',
    });
    assert.equal(res.status, 404);
  });
});

describe('Phase 4 — input validation', () => {
  test('a malformed JSON body is a 400, not a crash', async () => {
    const res = await fetch(`${server.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
  });

  test('missing fields are rejected with INVALID_INPUT', async () => {
    resetRateLimits();
    const res = await server.client().post('/api/auth/login', { username: 's.aisha' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('a SQL injection attempt in a username is treated as an ordinary string', async () => {
    resetRateLimits();
    const res = await server.client().login("'; DROP TABLE users; --", 'whatever12345');

    // Rejected by the username pattern, and the parameterised query would have
    // treated it as data regardless.
    assert.ok(res.status === 400 || res.status === 401);

    // The table is still there.
    const users = await world.admin.client.get('/api/admin/users');
    assert.equal(users.status, 200);
    assert.ok(users.body.users.length > 0);
  });

  test('an oversized payload is refused', async () => {
    const res = await world.guard.client.post('/api/verify', { payload: 'x'.repeat(40_000) });
    assert.ok(res.status === 400 || res.status === 413);
  });

  test('an admin cannot suspend their own account', async () => {
    const res = await world.admin.client.patch(`/api/admin/users/${world.admin.id}`, { active: false });
    assert.equal(res.status, 400);
  });
});

describe('Phase 4 — rate limiting', () => {
  test('repeated failed logins are throttled', async () => {
    resetRateLimits();
    const client = server.client();

    const statuses = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await client.login('s.aisha', 'wrong-password')).status);
    }

    assert.ok(statuses.includes(429), 'expected a 429 within 8 attempts at a 5/min limit');
    resetRateLimits();
  });

  test('a throttled response carries Retry-After', async () => {
    resetRateLimits();
    const client = server.client();
    let throttled = null;

    for (let i = 0; i < 8 && !throttled; i += 1) {
      const res = await client.login('s.aisha', 'wrong-password');
      if (res.status === 429) throttled = res;
    }

    assert.ok(throttled);
    assert.ok(Number(throttled.headers.get('Retry-After')) >= 1);
    resetRateLimits();
  });
});
