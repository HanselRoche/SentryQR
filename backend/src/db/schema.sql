-- SentryQR schema. See docs/db-schema.md for the rationale behind each table.
-- All timestamps are epoch milliseconds stored as INTEGER.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    password_salt TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('student', 'guard', 'admin')),
    full_name     TEXT    NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    INTEGER NOT NULL
);

-- Student-only profile fields, kept separate so guard/admin rows do not carry
-- permanently-null columns. user_id is both PK and FK: at most one per user.
CREATE TABLE IF NOT EXISTS students (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    roll_no      TEXT NOT NULL UNIQUE,
    room_no      TEXT NOT NULL,
    hostel_block TEXT NOT NULL
);

-- The simulated certificate authority. Keys are never deleted, only revoked,
-- because historical entry_events need the key that was current at the time.
CREATE TABLE IF NOT EXISTS public_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kid        TEXT    NOT NULL,
    jwk        TEXT    NOT NULL,
    algorithm  TEXT    NOT NULL DEFAULT 'ECDSA-P256',
    active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS nonces (
    nonce       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed')),
    consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);

-- One immutable row per gate decision, denials included.
-- `nonce` is plain text rather than a FK so a fabricated nonce is still loggable.
CREATE TABLE IF NOT EXISTS entry_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    guard_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nonce         TEXT,
    decision      TEXT    NOT NULL CHECK (decision IN ('GRANT', 'DENY')),
    reason_code   TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);

-- Append-only forensic log, broader than entry_events: also logins, key
-- lifecycle, rate limiting. `detail` is JSON text for event-specific fields.
CREATE TABLE IF NOT EXISTS audit_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              INTEGER NOT NULL,
    event_type      TEXT    NOT NULL,
    actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decision        TEXT,
    reason_code     TEXT,
    detail          TEXT,
    ip              TEXT
);

CREATE TABLE IF NOT EXISTS override_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    guard_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason          TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied')),
    created_at      INTEGER NOT NULL,
    decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at      INTEGER,
    decision_note   TEXT
);

-- Threat T6 at the schema level: a state with two live keys for one student is
-- unrepresentable, not merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_keys_one_active
    ON public_keys(user_id) WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_public_keys_user ON public_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nonces_user      ON nonces(user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_nonces_expiry    ON nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_entry_user       ON entry_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entry_created    ON entry_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts         ON audit_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type       ON audit_logs(event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry  ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_overrides_status ON override_requests(status, created_at DESC);
