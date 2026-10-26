-- Tatami Pass · nube (apps/registration) · esquema inicial · SQLite
-- Mismo esquema que migrations/postgres/001_init.sql (solo cambia la sintaxis).
-- Todas las fechas son texto ISO 8601 (UTC). Los JSON van como TEXT.

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  document_number TEXT,
  club TEXT,
  delegation_id TEXT,
  email TEXT,
  role_code TEXT NOT NULL,
  category_code TEXT,
  guardian_json TEXT,
  photo_url TEXT,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  companion_of TEXT,
  relationship TEXT,
  consent_at TEXT,
  -- lista de espera: oferta de cupo con enlace de confirmación (48 h)
  offer_token TEXT,
  offer_expires_at TEXT,
  offered_at TEXT,
  -- credencial (lo que reporta el host + revocación desde la nube)
  credential_id TEXT,
  credential_status TEXT,
  credential_updated_at TEXT,
  exported_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registrations_updated ON registrations(updated_at);
CREATE INDEX IF NOT EXISTS idx_registrations_companion ON registrations(companion_of);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_document ON registrations(document_number);
CREATE INDEX IF NOT EXISTS idx_registrations_offer ON registrations(offer_token);

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  city TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                 -- admin | coord | club
  password_hash TEXT,                 -- NULL mientras la invitación no se acepta
  delegation_id TEXT,
  invite_token TEXT,
  invite_expires_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_token);

CREATE TABLE IF NOT EXISTS event_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT,
  rows INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  unchanged INTEGER NOT NULL,
  duplicates_in_file INTEGER NOT NULL,
  errors_json TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  by_user TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS host_reports (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  host_id TEXT,
  summary_json TEXT NOT NULL,
  credentials_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS duplicate_decisions (
  pair_key TEXT PRIMARY KEY,          -- "idMenor|idMayor"
  decision TEXT NOT NULL,             -- distinct | merged
  by_user TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload_json TEXT
);
