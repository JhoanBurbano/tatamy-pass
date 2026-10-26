-- Datos para la credencial impresa: delegación (departamento/región), contacto de emergencia y EPS.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS delegation TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS emergency_json TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS eps_json TEXT;
