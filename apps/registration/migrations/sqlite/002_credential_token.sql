-- Token opaco para la página pública de la credencial digital (/credencial/<token>).
-- Lo reciben por correo el participante (si su rol admite credencial digital) y sus acompañantes.
ALTER TABLE registrations ADD COLUMN credential_token TEXT;
-- Versión de emisión que reporta el host (re-emitir incrementa); el QR digital la lleva en `n`.
ALTER TABLE registrations ADD COLUMN credential_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_registrations_credential_token ON registrations(credential_token);
