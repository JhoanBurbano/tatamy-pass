-- Datos para la credencial impresa (plantilla "Nacional 2026"): delegación en el anverso;
-- contacto de emergencia y EPS en el reverso. El teléfono de emergencia se cifra (JSON con enc:v1:).
ALTER TABLE persons ADD COLUMN delegation TEXT;
ALTER TABLE persons ADD COLUMN emergency_json TEXT;
ALTER TABLE persons ADD COLUMN eps_json TEXT;
