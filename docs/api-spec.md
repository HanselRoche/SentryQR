# SentryQR — API Specification

**Phase 1 deliverable.** Base URL `http://localhost:3000` in development. All bodies are `application/json`.

---

## Conventions

**Authentication** is a session cookie named `sentryqr_sid`, set at login, flagged `HttpOnly` and `SameSite=Lax`. `Secure` is added when `COOKIE_SECURE=true` (Phase 6). Clients must send credentials (`fetch(..., { credentials: 'include' })`).

**Errors** use a single shape:

```json
{ "error": { "code": "FORBIDDEN", "message": "Requires role: admin" } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT` | Failed schema validation |
| 401 | `UNAUTHENTICATED` | Missing or expired session |
| 403 | `FORBIDDEN` | Authenticated but wrong role |
| 404 | `NOT_FOUND` | No such resource |
| 409 | `CONFLICT` | Duplicate username or roll number |
| 429 | `RATE_LIMITED` | Token bucket empty; includes `Retry-After` |
| 500 | `INTERNAL` | Unexpected — details logged, never returned |

Note that `POST /api/verify` is different: a rejected entry is a **successful** API call. It returns `200` with `decision: "DENY"`. Reserve HTTP errors for protocol failures, not authorisation outcomes.

**Rate limits**

| Route | Limit | Keyed on |
|---|---|---|
| `POST /api/auth/login` | 5 / min | IP |
| `POST /api/challenge` | 20 / min | user id |
| `POST /api/verify` | 60 / min | user id |
| everything else | 120 / min | user id or IP |

---

## Authentication

### `POST /api/auth/login`
Public.

```json
{ "username": "s.aisha", "password": "..." }
```
→ `200`, sets cookie:
```json
{ "user": { "id": 2, "username": "s.aisha", "role": "student", "fullName": "Aisha Rahman" } }
```
`401 UNAUTHENTICATED` on bad credentials — the message does not distinguish unknown user from wrong password. Both outcomes are audit-logged (`LOGIN_SUCCESS` / `LOGIN_FAILURE`).

### `POST /api/auth/logout`
Any role. Revokes the session, clears the cookie. → `204`

### `GET /api/auth/me`
Any role. → `200 { "user": { ... } }`, or `401` if no valid session.

---

## Student

### `GET /api/students/me`
Student.
```json
{
  "user":    { "id": 2, "username": "s.aisha", "fullName": "Aisha Rahman", "role": "student" },
  "student": { "rollNo": "4SO22CS001", "roomNo": "B-204", "hostelBlock": "B" },
  "activeKey": { "id": 7, "kid": "k_9f3a...", "algorithm": "ECDSA-P256", "createdAt": 1735689600000 }
}
```
`activeKey` is `null` before enrolment — the app uses this to decide whether to show the enrolment screen.

### `POST /api/students/keys`
Student. Enrols this device's public key.

```json
{ "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "...", "ext": false, "key_ops": ["verify"] } }
```

Validation rejects the request if `kty !== "EC"`, `crv !== "P-256"`, `x` or `y` is missing or not base64url, or — importantly — if a `d` member is present, since `d` is the *private* scalar and must never reach the server.

Registration **deactivates any previously active key** for that student in the same transaction. A student has at most one active key, so a silently added second key is impossible (threat T6). Audit-logged as `KEY_REGISTERED`.

→ `201 { "key": { "id": 8, "kid": "k_...", "algorithm": "ECDSA-P256", "createdAt": ... } }`

### `GET /api/students/me/entries?limit=50`
Student. Own entry history, newest first.
```json
{ "entries": [ { "id": 41, "decision": "GRANT", "reasonCode": "OK",
                 "guardName": "Ramesh K", "createdAt": 1735689600000 } ] }
```

---

## Challenge

### `POST /api/challenge`
Student. No body. Issues a fresh single-use nonce bound to the calling student.

→ `201`
```json
{
  "studentId": 2,
  "nonce":     "8Kx2...base64url, 32 bytes...",
  "issuedAt":  1735689600000,
  "expiresAt": 1735689645000,
  "ttlMs":     45000,
  "message":   "v1|2|8Kx2...|1735689600000"
}
```

`message` is the exact canonical string to sign. It is returned as a convenience so the client cannot drift from the server's formatting — the client signs `new TextEncoder().encode(message)`. This is safe because the server independently reconstructs the same string from its stored row at verification time and never trusts a client-supplied version of it.

`409 CONFLICT` if the student has no active key — there would be nothing to sign with.

---

## Verification

### `POST /api/verify`
Guard. The authoritative decision endpoint.

```json
{ "payload": "{\"v\":1,\"sid\":2,\"n\":\"8Kx2...\",\"iat\":1735689600000,\"sig\":\"MEUC...\"}" }
```

`payload` is the **raw string decoded from the QR**. The guard app passes it through verbatim without parsing, so nothing is lost or normalised in transit.

→ `200` grant:
```json
{
  "decision": "GRANT",
  "reasonCode": "OK",
  "student": { "fullName": "Aisha Rahman", "rollNo": "4SO22CS001", "roomNo": "B-204", "hostelBlock": "B" },
  "entryEventId": 42,
  "verifiedAt": 1735689612000
}
```

→ `200` deny:
```json
{ "decision": "DENY", "reasonCode": "NONCE_REUSED", "student": null, "entryEventId": 43, "verifiedAt": ... }
```

Student details are returned **only on grant**. A denial reveals nothing about whether the referenced student exists.

#### Check order and reason codes

Evaluated in this order; the first failure wins. Cheap lookups precede the expensive signature verification, so malformed and replayed payloads never reach the crypto.

| # | Check | Reason code on failure |
|---|---|---|
| 1 | Parses as JSON with the expected field types | `MALFORMED_PAYLOAD` |
| 2 | `v === 1` | `UNSUPPORTED_VERSION` |
| 3 | Nonce exists in `nonces` | `UNKNOWN_NONCE` |
| 4 | Status is `issued`, not `consumed` | `NONCE_REUSED` |
| 5 | `now < expires_at` | `CHALLENGE_EXPIRED` |
| 6 | Stored `user_id === payload.sid` | `IDENTITY_MISMATCH` |
| 7 | Student account is active | `STUDENT_INACTIVE` |
| 8 | Student has an active public key | `UNREGISTERED_STUDENT` |
| 9 | That key is not revoked | `KEY_REVOKED` |
| 10 | ECDSA verify over the **server-rebuilt** message | `INVALID_SIGNATURE` |
| 11 | Atomic consume affected exactly 1 row | `NONCE_REUSED` |
| — | all passed | `OK` → GRANT |

Steps 4 and 11 both yield `NONCE_REUSED`. Step 4 catches a sequential replay; step 11 catches the concurrent case, where two requests both passed step 4 before either wrote. Only one conditional `UPDATE` can match.

Every call — grant or deny — writes one `entry_events` row and one `audit_logs` row.

---

## Manual override

Covers the edge case in the roadmap: a student with a dead phone battery.

### `POST /api/overrides`
Guard. Raises a request; grants nothing on its own.
```json
{ "rollNo": "4SO22CS001", "reason": "Phone battery dead, student ID verified visually" }
```
→ `201 { "override": { "id": 3, "status": "pending", "createdAt": ... } }`

### `GET /api/overrides?status=pending`
Admin. Pending queue.

### `POST /api/overrides/:id/decision`
Admin.
```json
{ "approve": true, "note": "Confirmed by warden over phone" }
```
Approval writes an `entry_events` row with `decision: "GRANT"` and `reasonCode: "MANUAL_OVERRIDE"`, so overrides appear in the same audit trail as cryptographic entries and are never invisible. → `200`

---

## Admin

### `POST /api/admin/users`
Admin. Creates a student or guard account.
```json
{ "username": "s.rahul", "password": "...", "fullName": "Rahul Nayak", "role": "student",
  "rollNo": "4SO22CS002", "roomNo": "A-101", "hostelBlock": "A" }
```
The three student fields are required when `role === "student"` and ignored otherwise. → `201`, `409 CONFLICT` on a duplicate username or roll number.

### `GET /api/admin/users?role=student`
Admin. Includes each user's active-key status and last entry.

### `PATCH /api/admin/users/:id`
Admin. `{ "active": false }` — suspends the account. Audit-logged.

### `GET /api/admin/keys?userId=2&includeRevoked=true`
Admin. Public key registry. Returns the JWK's `x`/`y` truncated for display; full JWKs are not exposed to the UI.

### `POST /api/admin/keys/:id/revoke`
Admin. Sets `revoked_at`, deactivates the key. Effective on the very next verification. Audit-logged as `KEY_REVOKED`. → `200`

### `GET /api/admin/audit?limit=100&offset=0&eventType=VERIFY&decision=DENY&userId=2`
Admin. Filterable audit log, newest first.
```json
{
  "total": 318,
  "logs": [ { "id": 318, "ts": 1735689612000, "eventType": "VERIFY", "decision": "DENY",
              "reasonCode": "NONCE_REUSED", "actorUserId": 5, "subjectUserId": 2,
              "actorName": "Ramesh K", "subjectName": "Aisha Rahman",
              "ip": "127.0.0.1", "detail": { "nonce": "8Kx2..." } } ]
}
```

### `GET /api/admin/entries?limit=100&decision=DENY`
Admin. Entry events, the operational view of the same data.

---

## Audit event types

| `eventType` | Written when |
|---|---|
| `LOGIN_SUCCESS` / `LOGIN_FAILURE` | Login attempt resolves |
| `LOGOUT` | Session revoked |
| `KEY_REGISTERED` | Device enrols a public key |
| `KEY_REVOKED` | Admin revokes, or a re-enrolment supersedes |
| `CHALLENGE_ISSUED` | Nonce issued |
| `VERIFY` | Any verification, grant or deny — `reasonCode` carries the outcome |
| `OVERRIDE_REQUESTED` / `OVERRIDE_DECIDED` | Manual override lifecycle |
| `USER_CREATED` / `USER_UPDATED` | Admin account management |
| `RATE_LIMITED` | A bucket is exhausted |

---

## Role matrix

| Endpoint | student | guard | admin |
|---|:---:|:---:|:---:|
| `POST /api/auth/login` | public | public | public |
| `GET /api/auth/me`, `POST /api/auth/logout` | ✓ | ✓ | ✓ |
| `GET /api/students/me`, `.../entries` | ✓ | — | — |
| `POST /api/students/keys` | ✓ | — | — |
| `POST /api/challenge` | ✓ | — | — |
| `POST /api/verify` | — | ✓ | — |
| `POST /api/overrides` | — | ✓ | — |
| `GET /api/overrides`, `POST .../decision` | — | — | ✓ |
| `/api/admin/*` | — | — | ✓ |
