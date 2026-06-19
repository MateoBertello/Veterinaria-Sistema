-- =====================================================================
-- MIGRACIÓN 007: Clientes — baja lógica + unicidad de DNI/CUIT entre activos
-- Caso de uso "Eliminar Cliente" (v1.0 §1, RN-CL9) y unicidad RN-CL3.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RN-CL9 (baja lógica): además del flag `deleted` ya existente, se
-- registran el momento y el autor de la baja para preservar trazabilidad.
-- ---------------------------------------------------------------------
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- RN-CL3 (unicidad): el DNI/CUIT debe ser único SOLO entre clientes no
-- eliminados. El UNIQUE total original (tenant_id, dni_cuit) impedía
-- reutilizar el documento de un cliente dado de baja, contradiciendo la
-- regla. Se reemplaza por un índice único parcial sobre los activos.
-- Se localiza el constraint por sus columnas (no por nombre autogenerado)
-- para que el reemplazo sea robusto.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  WHERE con.conrelid = 'public.clientes'::regclass
    AND con.contype  = 'u'
    AND (
      -- attname es de tipo `name`; se castea a text para comparar con text[].
      SELECT array_agg(att.attname::text ORDER BY att.attname::text)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    ) = ARRAY['dni_cuit', 'tenant_id']
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_dni_activo
  ON clientes (tenant_id, dni_cuit)
  WHERE deleted = false AND dni_cuit IS NOT NULL;

-- ---------------------------------------------------------------------
-- NFR de rendimiento: la búsqueda del listado opera sobre nombre, DNI/CUIT
-- y teléfono. `full_name` ya tiene índice (idx_clientes_nombre) y `dni_cuit`
-- queda cubierto por el índice único parcial; se agrega el de teléfono.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clientes_phone
  ON clientes (tenant_id, phone);
