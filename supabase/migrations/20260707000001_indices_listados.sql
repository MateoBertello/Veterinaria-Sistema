-- =====================================================================
-- MIGRACIÓN: índice de auditoría por usuario  [Etapa 9 — S10 / DT-9]
-- RN-AUD4 / RN-AUD5: la consulta de auditoría filtra por usuario y
-- ordena por fecha desc (buscarPaginado en auditoria.service.ts). El
-- filtro `user_id` era la ÚNICA columna de filtro de ese listado sin
-- índice: no lidera ningún índice existente.
--
-- Verificado por EXPLAIN (ANALYZE, BUFFERS) con volumen sintético
-- (~13k filas de auditoría por tenant, ver docs/EXPLAIN_INDICES.md):
--   ANTES  → para un usuario poco activo el planner barría TODA la
--            partición del tenant vía idx_auditoria_modulo y descartaba
--            ~13.000 filas por filtro (Rows Removed by Filter: 13.000;
--            Buffers: 283) + un Sort. Costo lineal en el total de
--            auditoría del tenant, que RN-AUD4 hace crecer sin límite.
--   DESPUÉS → Index Scan directo sobre el índice compuesto, sin Sort
--            (el timestamp DESC va en el índice), ~5-7 buffers.
--
-- Se ordena `"timestamp" DESC` en el índice para que sirva a la vez el
-- WHERE (tenant_id, user_id) y el ORDER BY del listado paginado.
--
-- Alcance deliberado: NO se agregan índices especulativos. El resto de
-- los listados (turnos por fecha/rango, estadías por rango, timeline de
-- historial RN-HC5, plan/barrido de vacunación, auditoría por fecha y
-- por módulo) ya resuelven por índice existente, y las búsquedas ILIKE
-- '%term%' se sirven con seq scan sub-ms al volumen real por tenant
-- (pg_trgm no se justifica hoy). Ver el informe para el detalle.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_auditoria_usuario
  ON registros_auditoria (tenant_id, user_id, "timestamp" DESC);
