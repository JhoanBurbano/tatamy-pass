-- Datos para la credencial impresa: delegación (departamento/región), contacto de emergencia y EPS.
ALTER TABLE registrations ADD COLUMN delegation TEXT;
ALTER TABLE registrations ADD COLUMN emergency_json TEXT;
ALTER TABLE registrations ADD COLUMN eps_json TEXT;
