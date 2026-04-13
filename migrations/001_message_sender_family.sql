-- Ejecutar una vez contra la base xv_mgmt si aún no existen las columnas.
ALTER TABLE message ADD COLUMN IF NOT EXISTS sender_name VARCHAR(150);
ALTER TABLE message ADD COLUMN IF NOT EXISTS family_id INT REFERENCES family(id) ON DELETE SET NULL;
