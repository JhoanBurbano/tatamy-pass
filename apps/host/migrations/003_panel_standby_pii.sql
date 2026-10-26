-- Panel de administración, standby, cifrado en reposo y purga.

-- Personas: documento/fecha de nacimiento cifrados en las mismas columnas (prefijo enc:v1:) + HMAC indexable del documento.
ALTER TABLE persons ADD COLUMN document_hash TEXT;
ALTER TABLE persons ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE persons ADD COLUMN purged_at TEXT;
CREATE INDEX IF NOT EXISTS idx_persons_document_hash ON persons(document_hash);
CREATE INDEX IF NOT EXISTS idx_persons_updated ON persons(updated_at);

-- Usuarios: desactivación y versión para replicar.
ALTER TABLE users ADD COLUMN disabled_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

-- Dispositivos: pendientes reportados por el scanner, desactivación y versión para replicar.
ALTER TABLE devices ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN disabled_at TEXT;
ALTER TABLE devices ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

-- Credenciales: entrega.
ALTER TABLE credentials ADD COLUMN delivered_at TEXT;
ALTER TABLE credentials ADD COLUMN printed_at TEXT;

-- Alertas del panel (duplicados, ingresos manuales, dispositivos sin conexión).
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- DUPLICATE | MANUAL | OFFLINE
  at TEXT NOT NULL,
  credential_id TEXT,
  device_id TEXT,
  detail_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED
  resolved_at TEXT,
  resolved_by TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, at);

-- Lotes de impresión.
CREATE TABLE IF NOT EXISTS print_batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  credential_ids_json TEXT NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PRINTED
  printed_at TEXT,
  printed_by TEXT,
  updated_at TEXT NOT NULL
);
