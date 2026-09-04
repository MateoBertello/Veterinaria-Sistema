-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C8·T3: Índice para trazabilidad mascota -> lotes de consumo
-- =====================================================================

-- C13 / Consumo clínico: búsqueda directa de consumos por mascota.
-- Medición justificada con método docs/EXPLAIN_INDICES.md:
-- ANTES: Bitmap Heap Scan con idx_mov_tipo + filter mascota_id (Rows Removed by Filter: 190, 0.156 ms).
-- DESPUÉS: Index Scan directo usando idx_mov_mascota (0 rows filtered, 0.033 ms).
CREATE INDEX IF NOT EXISTS idx_mov_mascota
  ON public.movimientos_stock (tenant_id, mascota_id)
  WHERE mascota_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
