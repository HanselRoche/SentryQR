# SentryQR — Threat Model

**Phase 1 deliverable.** Cryptography & Network Security (22CSE71).

---

## 1. What we are protecting

| Asset | Why it matters | Loss if compromised |
|---|---|---|
| Hostel entry authorisation | The whole point of the gate | Unauthorised person enters the building |
| Student private keys | The sole proof of identity | Permanent, undetectable impersonation |
| Entry audit trail | Accountability after an incident | No way to establish who entered and when |
| Registered public keys | Basis of every verification | Attacker registers their own key against a victim's ID |
| Login credentials | Access to the apps | Account takeover, then key re-enrolment |

---

## 2. Actors

| Actor | Trust level | Capabilities |
|---|---|---|
| Student | Authenticated, semi-trusted | Request challenges, sign with own device key, view own history |
| Security guard | Authenticated, semi-trusted | Scan QRs, submit for verification, request manual override |
| Hostel admin | Authenticated, trusted | Enrol students, revoke keys, approve overrides, read audit logs |
| Server | Fully trusted | Sole authority on grant/deny |
| **Outsider** | Untrusted | Can photograph any displayed QR, observe the gate, attempt network requests |
| **Malicious insider** | Authenticated student | Everything a student can do, plus the motive to lend their access to a friend |

The malicious insider is the realistic adversary here, and the survey data says so directly.

---

## 3. Motivating evidence

The project's own field survey found **3 of 16 respondents (18.75%) admitted to sharing their hostel entry credential with another person**. This is not a hypothetical attack — it is the observed baseline behaviour of the user population, and it is the single strongest justification for the entire design.

The implication is precise: a credential that *can* be shared *will* be shared, at a rate near one in five. Defence cannot rely on students choosing not to share. It has to make the shared artefact worthless. That is exactly what a 45-second, single-use, key-bound QR does.

---

## 4. Attacks and defences

### T1 — Replay of a captured QR

**Attack.** The adversary photographs a valid QR at the gate — over a shoulder, from a group chat, from a screen recording — and presents the image later.

**Defence.** Two independent mechanisms, either of which alone stops it:

1. *Single use.* On the first successful verification the nonce is consumed by a conditional update (`UPDATE nonces SET status='consumed' WHERE nonce=? AND status='issued'`). Any later submission of the same nonce finds status `consumed` and is denied `NONCE_REUSED`.
2. *Expiry.* The nonce carries `expires_at = issued_at + 45s`. Past that, `CHALLENGE_EXPIRED`.

**Residual risk.** A ~45-second window exists in which a captured-but-unused QR is still live. An attacker who photographs a QR the student then does *not* use, and who reaches a second gate within 45 seconds, would be granted entry. Shortening the window trades against scan reliability; 45 seconds with a 30-second refresh was chosen as the practical balance. Binding the nonce to a specific gate/reader ID would close this and is a natural extension.

**Verified by.** `test/attacks.test.js` — replay of a consumed nonce, and submission of an expired nonce.

---

### T2 — Credential sharing (the insider case)

**Attack.** A student wants to let a friend in. With a card, they hand over the card. With a static QR, they send a screenshot.

**Defence.** There is no durable artefact to share. To produce a valid QR the friend would need a signature from the student's private key, which is generated inside the student's browser as a **non-extractable** `CryptoKey`. `crypto.subtle.exportKey()` on it throws; no JavaScript — ours or an attacker's — can serialize it. It cannot be emailed, screenshotted, or copied to another device.

Sharing is therefore reduced from "send a screenshot once, works forever" to "physically hand over your unlocked phone, and stand there for each entry."

**Residual risk.** Explicitly **not defended**: the student physically lending their unlocked device. No software control at this layer can distinguish that from legitimate use. Mitigation belongs to a different layer — device lock screens, or a biometric/PIN gate before signing, which is a natural Phase 6+ extension since WebAuthn provides exactly this.

---

### T3 — Impersonation via payload tampering

**Attack.** The adversary takes their own valid QR payload and edits `sid` to a different student's ID, hoping the server trusts the field.

**Defence.** The server never trusts payload fields for the security decision. It uses `n` (the nonce) purely as a lookup key, then rebuilds the canonical message `v1|<studentUserId>|<nonce>|<issuedAt>` from the **stored** `nonces` row. Two checks fail for the attacker:

- The stored `user_id` for that nonce does not match the claimed `sid` → `IDENTITY_MISMATCH`, before any crypto runs.
- Even if that check were removed, the signature is verified against the victim's registered public key over the server's own values, and the attacker cannot produce that signature without the victim's private key → `INVALID_SIGNATURE`.

**Verified by.** `test/attacks.test.js` — mismatched student ID, and a payload signed by the wrong key.

---

### T4 — Signature or field tampering

**Attack.** Flip bits in `sig`, or alter `iat` to extend validity.

**Defence.** ECDSA verification fails on any change to the signature. Altering `iat` in the payload has no effect at all, because the server takes `issued_at` from its own row — the field is decorative for the client's countdown display.

**Verified by.** `test/attacks.test.js` — corrupted signature, altered timestamp.

---

### T5 — Man-in-the-middle on the QR exchange

**Attack.** Intercept and modify the signed payload in transit between student and guard.

**Defence.** Structurally impossible for this hop. The payload crosses from student to guard **optically** — a camera reading a screen. There is no network path between the two devices to interpose on. An adversary with a camera can copy the payload, but copying is T1, and single-use plus expiry already handle it.

The two network hops that do exist — student→server and guard→server — are protected by TLS (Phase 6). Even without TLS, a network attacker cannot forge a payload; they can only replay one, which returns us to T1.

---

### T6 — Rogue key registration

**Attack.** The adversary authenticates as a victim (stolen password, or a hijacked session) and registers *their own* public key against the victim's account. All subsequent entries then verify correctly under the attacker's key.

**Defence.**

- Key registration requires an authenticated session for that specific student.
- Every registration writes an `audit_logs` entry of type `KEY_REGISTERED`.
- Registering a new key **deactivates** the previous one rather than adding a second — a student has exactly one active key at a time, so a silent parallel key is not possible. A displaced legitimate student notices immediately, because their own device stops working.
- Admins can revoke any key from the dashboard, taking effect on the very next verification.

**Residual risk.** This is the sharpest remaining attack, and it reduces to password security. A production deployment should require admin approval or an out-of-band code for re-enrolment. Documented as a known limitation rather than solved.

---

### T7 — Brute force and denial of service

**Attack.** Flood `/api/challenge` to exhaust storage, or grind `/api/auth/login` for passwords.

**Defence.** Per-identity token-bucket rate limiting: 20/min on challenge requests per student, 5/min on login per IP, 60/min on verification per guard. Nonces are small and expire. Failed logins are audit-logged, so a grinding attempt is visible in the log rather than silent.

**Residual risk.** In-memory limiter state is per-process and resets on restart. Fine for a single-node demo; a multi-node deployment needs shared state.

---

### T8 — Injection and malformed input

**Attack.** SQL injection through `sid`, or an oversized payload.

**Defence.** Every query uses `node:sqlite` prepared statements with bound parameters — no string concatenation anywhere in the data layer. Payloads are schema-validated (types, lengths, base64url character set) before reaching any handler, and the JSON body parser is capped.

---

### T9 — Compromised guard device

**Attack.** The adversary controls the guard's tablet.

**Defence, partial.** The guard app has no authority. It cannot grant entry; it can only display what the server returned. A compromised device can show a fake GRANT banner to whoever is watching, but the `entry_events` and `audit_logs` tables — the record that matters after an incident — reflect only genuine server decisions. The discrepancy is detectable in review.

**Residual risk.** Physical entry at that gate, at that moment, if the human operator trusts the screen. This is a physical-security problem, not a cryptographic one.

---

## 5. Summary

| ID | Threat | Primary defence | Status |
|---|---|---|---|
| T1 | Replay of captured QR | Single-use nonce + 45 s expiry | Mitigated |
| T2 | Credential sharing | Non-extractable device key | Mitigated (device lending out of scope) |
| T3 | Impersonation via `sid` edit | Server-side message reconstruction | Mitigated |
| T4 | Signature tampering | ECDSA verification | Mitigated |
| T5 | MITM on QR exchange | Optical air gap + TLS on network hops | Mitigated by design |
| T6 | Rogue key registration | Session-bound, single active key, audited | Partial — reduces to password security |
| T7 | Brute force / DoS | Token-bucket rate limiting | Mitigated for single node |
| T8 | Injection | Prepared statements + validation | Mitigated |
| T9 | Compromised guard device | Guard has zero authority | Partial — physical layer |

---

## 6. Explicitly out of scope

Stated plainly, because an evaluator will ask, and claiming to defend against these would be dishonest:

- **A student handing over an unlocked phone.** Requires device-level biometrics.
- **Physical bypass of the gate.** Climbing a wall defeats any authentication system.
- **Compromise of the server itself.** The server is the root of trust; if it falls, everything falls.
- **A malicious admin.** Admins can revoke and enrol keys by design.
- **Traffic analysis.** An observer can tell that a student entered at a given time. Not treated as confidential.

---

## 7. Why digital signatures rather than hashing

Anticipated viva question, answered here for the report.

A hash (or an HMAC) proves *integrity* — the message was not altered. It does not prove *origin* in a way that survives dispute, because verifying an HMAC requires the same secret key used to create it. If the server can verify a student's HMAC, the server can also forge one. There is no way to settle a later dispute about who produced a given entry record.

A digital signature separates the two capabilities. The private key signs, and only the student holds it; the public key verifies, and everyone including the server holds it. The server can confirm a signature is genuine but cannot manufacture one. That asymmetry is **non-repudiation**: the student cannot credibly deny an entry, and the administration cannot credibly fabricate one.

For an access-control system whose audit log may be used in a disciplinary proceeding, that distinction is the whole reason to prefer signatures over hashing.
