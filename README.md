# SentryQR — Secure Hostel Entry System

A cryptographically secure, dynamic QR-based hostel access system.
Course-level PBL — **Cryptography & Network Security (22CSE71)**, St. Joseph Engineering College, Mangaluru.

---

## The idea in one paragraph

A printed ID card or static QR code is a *bearer credential*: whoever holds a copy is treated as the owner, and a photograph is a perfect clone. SentryQR replaces it with a **proof of possession of a private key**. The QR shown at the gate is not an identity — it is a fresh ECDSA signature over a random challenge the server issued seconds earlier and will accept exactly once. A screenshot is worthless within 45 seconds, and it was never usable by anyone but the student it was issued to.

| Property | Mechanism | Attack defeated |
|---|---|---|
| Freshness | Server-issued nonce, 45 s expiry | Screenshot sharing |
| Single use | Nonce consumed atomically on first verify | Replay |
| Non-repudiation | ECDSA P-256 signature by a non-extractable device key | Impersonation, forgery |

The student's private key is generated in the browser with `extractable: false`. It cannot be exported, copied, or transmitted **by any JavaScript, including this application's own code**. There is no artefact to share.

---

## Implementation status

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning & requirements | Inherited from [Roadmap.md](Roadmap.md) |
| 1 | System design & architecture | ✅ [docs/](docs/) |
| 2 | PKI & cryptographic core | ✅ [backend/src/crypto/](backend/src/crypto/) |
| 3 | Dynamic QR & challenge–response | ✅ |
| 4 | Backend, sessions & signature verification | ✅ |
| 5 | Student, guard & admin applications | ✅ [frontend/](frontend/) |
| 6 | Security hardening (TLS) | Partial — see below |
| 7 | Testing & security validation | Attack suite complete; written report pending |
| 8 | Deployment & demo prep | Not started |

Phases 1–5 are complete and verified: **85 automated tests** plus an **18-check live end-to-end demonstration**, all passing.

---

## Quick start

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`, `node:test`, and `node:crypto`). Verified on Node 26.7.

```bash
npm install
npm run reset          # create the database and seed demo accounts
```

Then in two terminals:

```bash
npm start              # terminal 1 — API on http://localhost:3000
npm run dev:frontend   # terminal 2 — UI  on http://localhost:5173
```

Open **http://localhost:5173** and sign in. The login screen has one-click buttons for the demo accounts.

| Role | Username | Password |
|---|---|---|
| Student | `s.aisha` | `student12345` |
| Student | `s.rahul` | `student12345` |
| Guard | `guard.ramesh` | `guard12345` |
| Admin | `admin` | `admin12345` |

> Use `localhost`, not a LAN IP. Browsers only expose WebCrypto and the camera in a secure context, and `localhost` counts as one. Scanning from a phone over the network needs TLS first — see [Known limitations](#known-limitations).

---

## Verify it works

```bash
npm test               # 85 unit, integration and attack-simulation tests
```

With the server running, the live demonstration walks the happy path and then executes every attack from the threat model:

```bash
npm run demo
```

```
✓ a freshly signed QR is granted                       GRANT
✓ T1 replay — the same QR reused                       NONCE_REUSED
✓ T1 race — 3 simultaneous scans grant exactly once    1
✓ T4 tampering — one flipped bit in the signature      INVALID_SIGNATURE
✓ T3 impersonation — student id relabelled             IDENTITY_MISMATCH
✓ T3 forgery — signed with an unregistered key         INVALID_SIGNATURE
✓ T1 screenshot — an expired QR                        CHALLENGE_EXPIRED
✓ T6 revoked key — a QR signed before revocation       KEY_REVOKED
```

The expiry check is skipped at the default 45-second TTL. To include it, start the server with a shorter window:

```bash
CHALLENGE_TTL_MS=3000 npm start
```

---

## How a single entry works

```
1. Student app  →  POST /api/challenge          server stores nonce, user_id, issued_at, expires_at
2. Browser      →  crypto.subtle.sign(...)      over "v1|<studentId>|<nonce>|<issuedAt>"
3. Student app  →  renders QR                   {"v":1,"sid":…,"n":…,"iat":…,"sig":…}
4. Guard app    →  camera decodes the QR        optical hop — no network path to intercept
5. Guard app    →  POST /api/verify             raw payload, passed through verbatim
6. Server       →  10 checks, then GRANT/DENY   + entry_events + audit_logs
```

Two details carry most of the security weight:

**The server rebuilds the signed message from its own stored row**, never from the payload. The `sid` and `iat` fields in the QR are attacker-controlled; editing them changes nothing about what is actually verified.

**The nonce is consumed with a conditional update**, not a read-then-write:

```sql
UPDATE nonces SET status='consumed' WHERE nonce=? AND status='issued'
```

The handler requires exactly one affected row. Two simultaneous scans of the same QR both pass the read-only checks, but only one `UPDATE` can match — the other is denied `NONCE_REUSED`. A `SELECT` followed by an `UPDATE` would let both through, and that time-of-check-to-time-of-use gap is precisely what a parallel-request attacker aims at. It is covered by a test.

---

## Layout

```
docs/                        Phase 1 deliverables
  architecture.md            component + sequence diagrams, crypto choices
  threat-model.md            T1–T9, defences, and what is explicitly out of scope
  api-spec.md                every endpoint, reason codes, role matrix
  db-schema.md               tables, nonce state machine, concurrency notes

backend/
  src/crypto/                sign/verify, key validation, nonces, passwords
  src/services/              challenge, verification, keys, users, audit, overrides
  src/routes/                REST endpoints
  src/middleware/            auth, rate limiting, validation, errors
  src/db/                    schema.sql, connection, migrate, seed
  test/                      85 tests including attacks.test.js
  scripts/demo.js            live end-to-end demonstration

frontend/
  src/lib/webcrypto.js       key generation and signing — the non-extractable key
  src/lib/keystore.js        IndexedDB CryptoKey storage
  src/routes/student/        enrolment, auto-refreshing QR, entry history
  src/routes/guard/          camera scanner, GRANT/DENY banner, manual override
  src/routes/admin/          registration, key revocation, overrides, audit log
```

---

## Design notes worth defending in a viva

**Why ECDSA P-256 rather than RSA-2048.** A P-256 signature is 64 bytes; RSA-2048 is 256. That keeps the QR near version 9 instead of version 20+, which is the difference between a QR that scans reliably off a phone screen and one that does not.

**Why `dsaEncoding: 'ieee-p1363'`.** WebCrypto emits a raw 64-byte `r‖s` signature; `node:crypto` defaults to expecting DER. Without that option every genuine signature is rejected, and the failure looks exactly like a tampering attack. [`test/webcrypto-interop.test.js`](backend/test/webcrypto-interop.test.js) pins this by driving the real `SubtleCrypto` API.

**Why the signed message is a delimited string, not JSON.** JSON member ordering is not guaranteed across engines, and a single byte of difference breaks verification. `v1|<studentId>|<nonce>|<issuedAt>` is unambiguous, and base64url nonces cannot contain the `|` separator.

**Why signatures rather than hashing.** An HMAC proves integrity but not origin in a way that survives dispute: whoever can verify it can also forge it. A digital signature separates the two — the student signs, everyone verifies, and nobody else can produce one. For an audit log that may be used in a disciplinary proceeding, that non-repudiation is the whole point. Expanded in [docs/threat-model.md](docs/threat-model.md#7--why-digital-signatures-rather-than-hashing).

**Why a denied entry returns HTTP 200.** A rejected credential is a normal, expected outcome the guard app must display, not a protocol failure. HTTP error codes are reserved for actual protocol problems.

---

## Known limitations

Stated plainly, because they are the honest boundary of what has been built:

- **No TLS yet (Phase 6).** Development runs on `http://localhost`, which browsers treat as a secure context. A LAN demo with a phone as the scanner needs a certificate first. The `Secure` cookie flag is already behind `COOKIE_SECURE=true` in [config.js](backend/src/config.js).
- **Rogue key registration (threat T6) reduces to password security.** An attacker with a student's password can enrol their own device. Registration is session-bound, audited, and supersedes the old key so the victim notices immediately — but production would want admin approval for re-enrolment.
- **A student lending an unlocked phone is not defended.** No software control at this layer can distinguish that from legitimate use. WebAuthn or a biometric gate before signing would close it.
- **Rate limiter state is per-process** and resets on restart. Fine for a single-node demo; a multi-node deployment needs shared state.
- **A ~45-second window** exists in which a photographed-but-unused QR is still live. Binding the nonce to a specific gate/reader ID would close it.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | API port |
| `DB_PATH` | `backend/data/sentryqr.db` | SQLite file |
| `CHALLENGE_TTL_MS` | `45000` | QR validity window |
| `SESSION_TTL_MS` | `28800000` | Login session lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind TLS |

---

## Production build

```bash
npm run build          # frontend → frontend/dist
npm start              # Express serves the built SPA and the API on one origin
```
