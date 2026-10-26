-- Acompañantes por participante: la persona/credencial acompañante apunta al participante.
ALTER TABLE persons ADD COLUMN companion_of TEXT;
ALTER TABLE persons ADD COLUMN relationship TEXT;
ALTER TABLE credentials ADD COLUMN companion_of TEXT;
CREATE INDEX IF NOT EXISTS idx_credentials_companion_of ON credentials(companion_of);
