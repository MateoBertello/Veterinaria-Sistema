-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN: Módulo Comercial — Conciliación de la caché de existencias
-- Funciones para verificar y recalcular existencias_lote desde el libro mayor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. recalcular_existencias(p_tenant_id, p_producto_id DEFAULT NULL)
-- Reconstruye la caché desde el libro mayor movimientos_stock.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_existencias(
  p_tenant_id   UUID,
  p_producto_id UUID DEFAULT NULL
)
RETURNS INTEGER            -- cantidad de filas de existencias_lote reescritas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filas INTEGER;
BEGIN
  -- Se reconstruye TODA fila de existencias_lote del alcance, incluidas las que
  -- quedarían en cero: una fila que la caché tiene y el libro mayor no respalda
  -- es exactamente el desvío que hay que corregir.
  WITH saldos AS (
    SELECT m.lote_id,
           m.tenant_id,
           m.producto_id,
           sum(m.cantidad_con_signo) AS cantidad
    FROM movimientos_stock m
    WHERE m.tenant_id = p_tenant_id
      AND (p_producto_id IS NULL OR m.producto_id = p_producto_id)
    GROUP BY m.lote_id, m.tenant_id, m.producto_id
  ),
  escritos AS (
    INSERT INTO existencias_lote (lote_id, tenant_id, producto_id, cantidad, actualizado_at)
    SELECT s.lote_id, s.tenant_id, s.producto_id, s.cantidad, now()
    FROM saldos s
    ON CONFLICT (lote_id) DO UPDATE
      SET cantidad       = EXCLUDED.cantidad,
          producto_id    = EXCLUDED.producto_id,
          actualizado_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_filas FROM escritos;

  -- Lotes del alcance que quedaron SIN ningún movimiento: su saldo es cero.
  -- Sin esta parte, un lote cuyos movimientos se hubieran ido con un rollback
  -- conservaría para siempre el saldo viejo.
  UPDATE existencias_lote e
  SET cantidad = 0, actualizado_at = now()
  WHERE e.tenant_id = p_tenant_id
    AND (p_producto_id IS NULL OR e.producto_id = p_producto_id)
    AND NOT EXISTS (
      SELECT 1 FROM movimientos_stock m
      WHERE m.tenant_id = e.tenant_id AND m.lote_id = e.lote_id
    );

  RETURN v_filas;
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_existencias(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalcular_existencias(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------
-- 2. verificar_existencias(p_tenant_id)
-- Devuelve los lotes donde la caché difiere de la suma del libro mayor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_existencias(p_tenant_id UUID)
RETURNS TABLE (
  lote_id          UUID,
  producto_id      UUID,
  cantidad_cache   NUMERIC(14,3),
  cantidad_real    NUMERIC(14,3),
  diferencia       NUMERIC(14,3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.lote_id,
         e.producto_id,
         e.cantidad                                  AS cantidad_cache,
         COALESCE(m.suma, 0)                         AS cantidad_real,
         e.cantidad - COALESCE(m.suma, 0)            AS diferencia
  FROM existencias_lote e
  LEFT JOIN (
    SELECT ms.lote_id, sum(ms.cantidad_con_signo) AS suma
    FROM movimientos_stock ms
    WHERE ms.tenant_id = p_tenant_id
    GROUP BY ms.lote_id
  ) m ON m.lote_id = e.lote_id
  WHERE e.tenant_id = p_tenant_id
    AND e.cantidad <> COALESCE(m.suma, 0);
$$;

REVOKE ALL ON FUNCTION public.verificar_existencias(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_existencias(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
