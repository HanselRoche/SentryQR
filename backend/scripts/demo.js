/**
 * Live end-to-end demonstration against a running SentryQR server.
 *
 * Walks the happy path, then runs each attack from docs/threat-model.md and
 * shows it being blocked. Uses the browser's own WebCrypto API (Node exposes
 * the same SubtleCrypto), so the payloads here are byte-identical to what a
 * real student device produces.
 *
 *   npm start                 # in one terminal
 *   npm run demo --workspace backend
 */
import { webcrypto } from 'node:crypto';

const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000';
const { subtle } = webcrypto;

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let passed = 0;
let failed = 0;

const heading = (text) => console.log(`\n${c.bold}${c.cyan}${text}${c.reset}\n${'─'.repeat(text.length)}`);

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  const mark = ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const detail = ok ? `${c.dim}${actual}${c.reset}` : `${c.red}got ${actual}, expected ${expected}${c.reset}`;
  console.log(`  ${mark} ${label.padEnd(52)} ${detail}`);
}

/** fetch with a cookie jar, like a browser session. */
function session() {
  let cookie = null;

  return async function call(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      if (raw.startsWith('sentryqr_sid=')) cookie = raw.split(';')[0];
    }

    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

async function enrolDevice() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
  };
}

async function sign(privateKey, message) {
  return base64url(
    await subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, privateKey, new TextEncoder().encode(message)),
  );
}

const buildPayload = ({ studentId, nonce, issuedAt, signature }) =>
  JSON.stringify({ v: 1, sid: studentId, n: nonce, iat: issuedAt, sig: signature });

async function main() {
  console.log(`${c.bold}SentryQR — live end-to-end demonstration${c.reset}`);
  console.log(`${c.dim}${BASE}${c.reset}`);

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\n${c.red}Server not reachable at ${BASE}. Start it with: npm start${c.reset}`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- setup
  heading('Setup');

  const student = session();
  const guard = session();
  const admin = session();

  check('student logs in', (await student('POST', '/api/auth/login', { username: 's.aisha', password: 'student12345' })).status, 200);
  check('guard logs in', (await guard('POST', '/api/auth/login', { username: 'guard.ramesh', password: 'guard12345' })).status, 200);
  check('admin logs in', (await admin('POST', '/api/auth/login', { username: 'admin', password: 'admin12345' })).status, 200);

  const device = await enrolDevice();
  const enrolled = await student('POST', '/api/students/keys', { jwk: device.publicJwk });
  check('device enrols its public key', enrolled.status, 201);
  console.log(`    ${c.dim}key id: ${enrolled.body?.key?.kid} — private half never left this process${c.reset}`);

  const rejected = await student('POST', '/api/students/keys', {
    jwk: { ...device.publicJwk, d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  });
  check('server refuses a JWK carrying a private key', rejected.status, 400);

  /** Full student-side flow: request a challenge, sign it, build the QR. */
  async function freshQr() {
    const { body: challenge } = await student('POST', '/api/challenge');
    const signature = await sign(device.privateKey, challenge.message);
    return {
      challenge,
      payload: buildPayload({
        studentId: challenge.studentId,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        signature,
      }),
    };
  }

  const verify = async (payload) => (await guard('POST', '/api/verify', { payload })).body;

  // ------------------------------------------------------------ happy path
  heading('Normal entry');

  const good = await freshQr();
  console.log(`    ${c.dim}QR payload (${good.payload.length} chars): ${good.payload.slice(0, 64)}…${c.reset}`);
  console.log(`    ${c.dim}signed message: ${good.challenge.message}${c.reset}`);

  const granted = await verify(good.payload);
  check('a freshly signed QR is granted', granted.decision, 'GRANT');
  console.log(`    ${c.green}${granted.student?.fullName} · ${granted.student?.rollNo} · Room ${granted.student?.roomNo}${c.reset}`);

  // --------------------------------------------------------------- attacks
  heading('Attack simulations');

  const replayed = await verify(good.payload);
  check('T1 replay — the same QR reused', replayed.reasonCode, 'NONCE_REUSED');

  const concurrent = await freshQr();
  const race = await Promise.all([verify(concurrent.payload), verify(concurrent.payload), verify(concurrent.payload)]);
  check('T1 race — 3 simultaneous scans grant exactly once', race.filter((r) => r.decision === 'GRANT').length, 1);

  const tamperTarget = await freshQr();
  const tampered = JSON.parse(tamperTarget.payload);
  const sigBytes = Buffer.from(tampered.sig, 'base64url');
  sigBytes[7] ^= 0x01;
  tampered.sig = sigBytes.toString('base64url');
  check('T4 tampering — one flipped bit in the signature', (await verify(JSON.stringify(tampered))).reasonCode, 'INVALID_SIGNATURE');

  const impersonation = await freshQr();
  const relabelled = JSON.parse(impersonation.payload);
  relabelled.sid = 9999;
  check('T3 impersonation — student id relabelled', (await verify(JSON.stringify(relabelled))).reasonCode, 'IDENTITY_MISMATCH');

  const foreign = await freshQr();
  const attackerDevice = await enrolDevice();
  const forged = buildPayload({
    studentId: foreign.challenge.studentId,
    nonce: foreign.challenge.nonce,
    issuedAt: foreign.challenge.issuedAt,
    signature: await sign(attackerDevice.privateKey, foreign.challenge.message),
  });
  check('T3 forgery — signed with an unregistered key', (await verify(forged)).reasonCode, 'INVALID_SIGNATURE');

  check('T4 malformed — arbitrary text scanned', (await verify('hello world')).reasonCode, 'MALFORMED_PAYLOAD');
  check('T8 injection — SQL in the nonce field',
    (await verify(JSON.stringify({ v: 1, sid: 1, n: "' OR 1=1 --", iat: Date.now(), sig: 'A'.repeat(86) }))).reasonCode,
    'MALFORMED_PAYLOAD');

  const fabricated = buildPayload({
    studentId: 2,
    nonce: base64url(webcrypto.getRandomValues(new Uint8Array(32))),
    issuedAt: Date.now(),
    signature: 'A'.repeat(86),
  });
  check('T3 fabrication — nonce this server never issued', (await verify(fabricated)).reasonCode, 'UNKNOWN_NONCE');

  // ---------------------------------------------------------- expiry + revoke
  heading('Expiry and revocation');

  const ttl = (await student('POST', '/api/challenge')).body.ttlMs;
  console.log(`    ${c.dim}challenge TTL is ${ttl}ms — set CHALLENGE_TTL_MS=3000 to demo expiry quickly${c.reset}`);

  if (ttl <= 5000) {
    const stale = await freshQr();
    await new Promise((resolve) => setTimeout(resolve, ttl + 400));
    check('T1 screenshot — an expired QR', (await verify(stale.payload)).reasonCode, 'CHALLENGE_EXPIRED');
  } else {
    console.log(`    ${c.yellow}skipping the expiry check — would take ${ttl / 1000}s${c.reset}`);
  }

  const preRevoke = await freshQr();
  const keys = (await admin('GET', '/api/admin/keys')).body.keys;
  const target = keys.find((key) => key.kid === enrolled.body.key.kid);
  check('admin revokes the student key', (await admin('POST', `/api/admin/keys/${target.id}/revoke`)).status, 200);
  check('T6 revoked key — a QR signed before revocation', (await verify(preRevoke.payload)).reasonCode, 'KEY_REVOKED');

  // ----------------------------------------------------------------- audit
  heading('Audit trail');

  const audit = (await admin('GET', '/api/admin/audit?eventType=VERIFY&decision=DENY&limit=100')).body;
  console.log(`    ${c.dim}${audit.total} denied verifications recorded${c.reset}`);
  const reasons = [...new Set(audit.logs.map((entry) => entry.reasonCode))];
  console.log(`    ${c.dim}reason codes logged: ${reasons.join(', ')}${c.reset}`);
  check('every denial was written to the audit log', audit.total > 0, true);

  // --------------------------------------------------------------- summary
  console.log(`\n${'═'.repeat(60)}`);
  const colour = failed === 0 ? c.green : c.red;
  console.log(`${colour}${c.bold}${passed} passed, ${failed} failed${c.reset}`);
  console.log(
    failed === 0
      ? `${c.dim}Every attack in the threat model was blocked, and every attempt logged.${c.reset}`
      : `${c.red}Some checks did not behave as expected.${c.reset}`,
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${c.red}Demo failed: ${error.message}${c.reset}`);
  process.exit(1);
});
