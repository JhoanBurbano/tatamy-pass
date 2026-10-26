-- Tatami Pass · esquema del host (SQLite, WAL)
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL, -- ADMIN | COORDINATOR | PRINTER | REGISTRAR | CONTROL | SUPERVISOR | AUDITOR
  club TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  document_number TEXT,
  club TEXT,
  photo_url TEXT,
  guardian_json TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES persons(id),
  display_name TEXT NOT NULL,
  club TEXT,
  role_code TEXT NOT NULL,
  zones_json TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  kid TEXT NOT NULL,
  category_code TEXT,
  photo_url TEXT,
  token TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_updated ON credentials(updated_at);
CREATE INDEX IF NOT EXISTS idx_credentials_person ON credentials(person_id);

CREATE TABLE IF NOT EXISTS revocations (
  credential_id TEXT NOT NULL,
  version INTEGER, -- NULL = todas
  reason TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  PRIMARY KEY (credential_id, at)
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  enrolled_at TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS enroll_tokens (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY, -- device_id:seq
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  credential_id TEXT,
  zone TEXT NOT NULL,
  direction TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  at TEXT NOT NULL,
  token_version INTEGER,
  manual_json TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (device_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_scan_events_received ON scan_events(received_at);
CREATE INDEX IF NOT EXISTS idx_scan_events_credential ON scan_events(credential_id, at);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
