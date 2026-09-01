import './setup.js';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { createUser } from '../src/services/users.js';
import { hashPassword } from '../src/crypto/password.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { signForTest } from '../src/crypto/verify.js';

/** Boot the real app on an ephemeral port and return a client bound to it. */
export async function startServer() {
  getDb();
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
    client: () => makeClient(base),
  };
}

/**
 * fetch wrapper with a cookie jar, so a logged-in session persists across calls
 * the way a browser's would.
 */
function makeClient(base) {
  let cookie = null;

  async function request(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('sentryqr_sid=')) {
        cookie = pair.endsWith('=') ? null : pair;
      }
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    patch: (url, body) => request('PATCH', url, body),
    login: async (username, password) => request('POST', '/api/auth/login', { username, password }),
  };
}

/**
 * Stand-in for a browser's WebCrypto keypair.
 *
 * The public half is exported as a JWK exactly as SubtleCrypto.exportKey would
 * produce it, and signForTest emits the same raw r‖s encoding WebCrypto emits,
 * so a payload built here is byte-identical to a real student device's.
 */
export function generateDeviceKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });

  return {
    privateKey,
    publicKey,
    // Mirrors what the browser sends: coordinates only, no private `d`.
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    sign: (message) => signForTest(privateKey, message),
  };
}

/** Build the QR payload string a student device would render. */
export function buildQrPayload({ studentId, nonce, issuedAt, signature }) {
  return JSON.stringify({ v: 1, sid: studentId, n: nonce, iat: issuedAt, sig: signature });
}

export function seedUser({ username, password, fullName, role, rollNo, roomNo, hostelBlock }) {
  if (role === 'admin') {
    const { hash, salt } = hashPassword(password);
    const { lastInsertRowid } = getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, password_salt, role, full_name, created_at)
         VALUES (?, ?, ?, 'admin', ?, ?)`,
      )
      .run(username, hash, salt, fullName, Date.now());
    return { id: Number(lastInsertRowid), username, role, fullName };
  }
  return createUser({ username, password, fullName, role, rollNo, roomNo, hostelBlock });
}

/**
 * The standard fixture: one admin, one guard, two students with enrolled
 * device keys, plus logged-in clients for each.
 */
export async function seedWorld(server) {
  resetRateLimits();

  const admin = seedUser({
    username: 'admin',
    password: 'admin12345',
    fullName: 'Warden',
    role: 'admin',
  });
  const guard = seedUser({
    username: 'guard.ramesh',
    password: 'guard12345',
    fullName: 'Ramesh Kamath',
    role: 'guard',
  });
  const aisha = seedUser({
    username: 's.aisha',
    password: 'student12345',
    fullName: 'Aisha Rahman',
    role: 'student',
    rollNo: '4SO22CS001',
    roomNo: 'B-204',
    hostelBlock: 'B',
  });
  const rahul = seedUser({
    username: 's.rahul',
    password: 'student12345',
    fullName: 'Rahul Nayak',
    role: 'student',
    rollNo: '4SO22CS002',
    roomNo: 'A-101',
    hostelBlock: 'A',
  });

  const adminClient = server.client();
  await adminClient.login('admin', 'admin12345');

  const guardClient = server.client();
  await guardClient.login('guard.ramesh', 'guard12345');

  const aishaClient = server.client();
  await aishaClient.login('s.aisha', 'student12345');
  const aishaDevice = generateDeviceKeypair();
  await aishaClient.post('/api/students/keys', { jwk: aishaDevice.publicJwk });

  const rahulClient = server.client();
  await rahulClient.login('s.rahul', 'student12345');
  const rahulDevice = generateDeviceKeypair();
  await rahulClient.post('/api/students/keys', { jwk: rahulDevice.publicJwk });

  return {
    admin: { ...admin, client: adminClient },
    guard: { ...guard, client: guardClient },
    aisha: { ...aisha, client: aishaClient, device: aishaDevice },
    rahul: { ...rahul, client: rahulClient, device: rahulDevice },
  };
}

/** Full student-side flow: request a challenge and sign it. */
export async function makeValidQr(student) {
  const { body: challenge } = await student.client.post('/api/challenge');
  const signature = student.device.sign(challenge.message);
  return {
    challenge,
    payload: buildQrPayload({
      studentId: challenge.studentId,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      signature,
    }),
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
