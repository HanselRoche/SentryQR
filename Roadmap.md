# SentryQR — Secure Hostel Entry System
### Implementation Roadmap
**Course Level PBL — Cryptography & Network Security (22CSE71)**
St. Joseph Engineering College, Mangaluru

---

## Project Name

**SentryQR**
*(A cryptographically secure, dynamic QR-based hostel access system)*

Other name options, if you'd prefer alternatives for your report/title slide:
- **CryptoGate** — emphasizes the cryptographic core (PKI, digital signatures)
- **GuardQR** — simple, descriptive
- **AuthEntry** — emphasizes authentication over identification
- **VeriGate** — "verify" + "gate," clean and academic-sounding

*SentryQR* is recommended — it's memorable, hints at both security ("Sentry") and the core mechanism (QR), and reads well on a report cover page.

---

## Roadmap Overview

The system has five moving parts that need to work together: a **student app** (generates/displays dynamic QR), a **security guard/scanner app** (scans and verifies), a **backend server** (issues challenges, verifies signatures, manages sessions), a **PKI layer** (key generation and management), and an **audit/logging system**. The roadmap below sequences these so each phase produces a working, testable increment rather than one big-bang integration at the end.

| Phase | Focus | Est. Duration |
|---|---|---|
| 0 | Planning & Requirements Finalization | 3–4 days |
| 1 | System Design & Architecture | 5–6 days |
| 2 | PKI & Cryptographic Core | 6–7 days |
| 3 | Dynamic QR Generation & Challenge–Response | 6–7 days |
| 4 | Backend, Session Management & Digital Signature Verification | 7–8 days |
| 5 | Student & Guard-Facing Applications | 6–7 days |
| 6 | Security Hardening (HTTPS, Replay/Clone Defense, Audit Logs) | 5 days |
| 7 | Testing & Security Validation | 5–6 days |
| 8 | Deployment, Documentation & Demo Prep | 4 days |

**Total estimated timeline: ~6–7 weeks**, suitable for a semester-long PBL with weekly review checkpoints.

---

## Phase 0 — Planning & Requirements Finalization

**Goal:** Lock down exactly what "secure" means for this system before writing code.

- Finalize functional requirements from your problem statement and survey data (dynamic QR, challenge–response, digital signatures, session-based auth, audit logging)
- Define actors: Student, Security Guard/Scanner, Hostel Admin, Server
- Define threat model explicitly — this is critical for a CNS course project:
  - Cloning/replay of static credentials
  - Credential sharing (3/16 respondents admitted this — cite it)
  - Impersonation attacks
  - Man-in-the-middle on the QR exchange
- Choose tech stack (suggested below) and get guide approval
- Set up shared repository, task board, and weekly milestone checkpoints

**Deliverable:** Requirements document + threat model diagram + approved tech stack

**Suggested stack:**
- Backend: Node.js (Express) or Python (FastAPI/Flask)
- Crypto: `node:crypto` / Python `cryptography` library (RSA or ECDSA for signatures)
- Database: PostgreSQL or MongoDB (for sessions, keys, audit logs)
- QR generation: `qrcode` npm package or `python-qrcode`
- QR scanning: browser-based (`html5-qrcode`) or mobile camera API
- Transport: HTTPS via TLS (self-signed cert acceptable for demo)

---

## Phase 1 — System Design & Architecture

**Goal:** Design the full authentication flow before implementation so every team member builds against the same contract.

- Design the **end-to-end challenge–response flow**:
  1. Student requests entry → server issues a time-bound, one-time challenge/nonce
  2. Student's device signs the challenge with their private key
  3. Signed response encoded into a dynamic QR (short validity window, e.g. 30–60 sec)
  4. Guard scans QR → sends signed payload to server
  5. Server verifies signature using student's registered public key + checks nonce/session validity
  6. Server grants/denies entry, logs the event
- Draw sequence diagrams (student ↔ server ↔ guard) and a system architecture diagram
- Design database schema: Students, PublicKeys, Sessions/Nonces, AuditLogs
- Define API contracts (REST endpoints) between components
- Assign module ownership across the 4 team members based on phases below

**Deliverable:** Architecture diagram, sequence diagrams, DB schema, API spec

---

## Phase 2 — PKI & Cryptographic Core

**Goal:** Build the trust foundation — key generation, storage, and signing/verification primitives.

- Implement key pair generation (RSA-2048 or ECDSA P-256) for each student at registration
- Design secure private key storage on the student's device (never transmitted to server)
- Implement public key registration and storage on the server (simulated PKI/certificate authority)
- Build core signing function (student side) and verification function (server side)
- Implement cryptographic hash function usage (SHA-256) for message integrity on the challenge payload
- Unit test: sign a message, verify correct signature accepted, tampered signature rejected

**Deliverable:** Working sign/verify module with unit tests; key registration flow

---

## Phase 3 — Dynamic QR Generation & Challenge–Response

**Goal:** Wire the crypto core into the actual QR-based authentication mechanism.

- Server-side: nonce/challenge generator with expiry timestamp (e.g., 30–60 sec validity)
- Client-side: capture challenge, sign it, encode `{studentID, challenge, signature, timestamp}` into QR payload
- QR rendering on student app (auto-refreshing before expiry, so a screenshot goes stale)
- Guard-side scanner that decodes QR and extracts the payload
- Enforce one-time-use: server invalidates a nonce immediately after successful verification (prevents replay)

**Deliverable:** End-to-end demo of QR generation → scan → payload extraction (verification wired in Phase 4)

---

## Phase 4 — Backend, Session Management & Signature Verification

**Goal:** Make the server the authoritative verifier and session tracker.

- Implement session management: each authenticated entry attempt tied to a session with expiry
- Signature verification endpoint: validate signature against stored public key + check nonce freshness/uniqueness + check timestamp window
- Reject and log: expired challenges, reused nonces, invalid signatures, unregistered students
- Return clear grant/deny response to guard app with reason codes (for debugging/demo, not shown to unauthorized users)
- Implement rate-limiting on challenge requests to reduce brute-force/DoS risk

**Deliverable:** Fully functional backend verifying real signed QR payloads end-to-end

---

## Phase 5 — Student & Guard-Facing Applications

**Goal:** Build usable interfaces around the working backend.

- **Student app/web page:** login, view auto-refreshing dynamic QR, entry history
- **Guard app/web page:** camera-based QR scanner, real-time grant/deny display, manual override with admin approval (edge case handling)
- **Admin dashboard:** register students, view/revoke public keys, view audit logs
- Basic UX polish — this is a demo-facing deliverable, so clarity matters more than visual design

**Deliverable:** Three working interfaces connected to the live backend

---

## Phase 6 — Security Hardening

**Goal:** Close the gaps a security-focused evaluator will specifically probe.

- Enforce HTTPS/TLS for all client–server communication; disable plain HTTP
- Implement secure session cookie/token handling (HttpOnly, Secure flags, short expiry)
- Add audit logging: every entry attempt (success/failure/reason) with timestamp, student ID, guard ID
- Add anti-clone/anti-replay checks explicitly in a security review pass (re-verify nonce single-use, QR expiry enforcement, signature binding to session)
- Input validation and sanitization on all endpoints (basic injection/tampering defense)

**Deliverable:** Security checklist completed; audit log viewer functional

---

## Phase 7 — Testing & Security Validation

**Goal:** Prove the system resists the attacks named in your problem statement — this is what will most impress evaluators.

- Functional testing: normal entry flow works end-to-end
- **Attack simulation tests** (document these explicitly for your report):
  - Replay attack: reuse an old QR → should be rejected
  - Screenshot sharing: use an expired QR → should be rejected
  - Signature tampering: modify payload → should be rejected
  - Impersonation: attempt entry with mismatched key/ID → should be rejected
- Load/edge-case testing: expired sessions, network drop mid-verification, concurrent scans
- Have a non-team member attempt to "break" the system (informal penetration test) and document results

**Deliverable:** Test report with attack scenarios, results, and screenshots — this becomes strong evidence in your final report

---

## Phase 8 — Deployment, Documentation & Demo Prep

**Goal:** Package the project for submission and live demonstration.

- Deploy backend + apps (local server or free-tier cloud host such as Render/Railway for demo purposes)
- Finalize documentation: architecture diagrams, API docs, setup instructions, threat model, test report
- Prepare a **live demo script**: registration → normal entry → at least one attack attempt being blocked live
- Prepare final presentation slides mapping back to your original problem statement and research gap
- Rehearse Q&A: be ready to explain why digital signatures (non-repudiation) vs. just hashing, and why dynamic QR vs. static

**Deliverable:** Deployed working system + final report + demo-ready presentation

---

## Suggested Weekly Checkpoint Mapping

| Week | Phases |
|---|---|
| 1 | Phase 0 + start Phase 1 |
| 2 | Finish Phase 1 + Phase 2 |
| 3 | Phase 3 |
| 4 | Phase 4 |
| 5 | Phase 5 |
| 6 | Phase 6 + start Phase 7 |
| 7 | Finish Phase 7 + Phase 8 |

---

## Team Role Suggestions (4 members)

Given the phases above naturally split into 4 tracks, one reasonable split:

- **Member A:** PKI & Cryptographic Core (Phase 2) → Security Hardening (Phase 6)
- **Member B:** QR Generation & Challenge–Response (Phase 3) → Guard App (Phase 5)
- **Member C:** Backend, Sessions & Verification (Phase 4) — the integration-heavy role
- **Member D:** Student App & Admin Dashboard (Phase 5) → Testing & Documentation (Phase 7–8)

Design (Phase 1) and testing (Phase 7) work best as whole-team collaborative sessions rather than solo work.