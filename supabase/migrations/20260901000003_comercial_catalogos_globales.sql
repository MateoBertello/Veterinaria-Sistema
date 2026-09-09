-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C1·T3a: Catálogos globales (unidades_medida, medios_pago)
-- =====================================================================

-- ─── 1. Tabla unidades_medida ─────────────────────────────────────────────

CREATE TABLE unidades_medida (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,
  abreviatura      TEXT NOT NULL,
  admite_decimales BOOLEAN NOT NULL,
  escala_decimal   SMALLINT NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,

  -- RN-PR7: escala entre 0 y 3, y obligatoriamente 0 si no admite decimales
  CONSTRAINT chk_unidades_escala_rango CHECK (escala_decimal BETWEEN 0 AND 3),
  CONSTRAINT chk_unidades_escala_decimales CHECK (admite_decimales OR escala_decimal = 0)
);

-- Seed idempotente de unidades_medida (11 filas)
INSERT INTO unidades_medida (codigo, nombre, abreviatura, admite_decimales, escala_decimal) VALUES
  ('unidad',     'Unidad',      'u',    false, 0),
  ('kg',         'Kilogramo',   'kg',   true,  3),
  ('g',          'Gramo',       'g',    true,  3),
  ('l',          'Litro',       'l',    true,  3),
  ('ml',         'Mililitro',   'ml',   true,  3),
  ('comprimido', 'Comprimido',  'comp', false, 0),
  ('blister',    'Blíster',     'bl',   false, 0),
  ('bolsa',      'Bolsa',       'bol',  false, 0),
  ('caja',       'Caja',        'cj',   false, 0),
  ('dosis',      'Dosis',       'ds',   true,  3),
  ('pipeta',     'Pipeta',      'pip',  false, 0)
ON CONFLICT (codigo) DO NOTHING;

-- RLS unidades_medida
ALTER TABLE unidades_medida ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_unidades_medida_lectura ON unidades_medida FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY p_unidades_medida_escritura ON unidades_medida FOR ALL
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ─── 2. Tabla medios_pago ─────────────────────────────────────────────────

CREATE TABLE medios_pago (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             TEXT NOT NULL UNIQUE,
  nombre             TEXT NOT NULL,
  afecta_arqueo      BOOLEAN NOT NULL DEFAULT false,
  requiere_referencia BOOLEAN NOT NULL DEFAULT false,
  activo             BOOLEAN NOT NULL DEFAULT true
);

-- Seed idempotente de medios_pago (6 filas, solo efectivo afecta arqueo)
INSERT INTO medios_pago (codigo, nombre, afecta_arqueo, requiere_referencia) VALUES
  ('efectivo',         'Efectivo',           true,  false),
  ('transferencia',    'Transferencia',      false, true),
  ('debito',           'Tarjeta de débito',  false, true),
  ('credito',          'Tarjeta de crédito', false, true),
  ('qr',               'Pago con QR',        false, true),
  ('cuenta_corriente', 'Cuenta corriente',    false, false)
ON CONFLICT (codigo) DO NOTHING;

-- RLS medios_pago
ALTER TABLE medios_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_medios_pago_lectura ON medios_pago FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY p_medios_pago_escritura ON medios_pago FOR ALL
  USING (is_super_admin()) WITH CHECK (is_super_admin());

NOTIFY pgrst, 'reload schema';
