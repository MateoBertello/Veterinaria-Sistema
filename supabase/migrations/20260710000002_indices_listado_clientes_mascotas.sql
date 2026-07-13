-- =====================================================================
-- MIGRACIÓN: índices de orden para los listados de Clientes y Mascotas
-- [pre-deploy]
-- =====================================================================
-- El listado por defecto de ambos módulos (clientes.service.listar /
-- mascotas.service.listar) filtra `tenant_id + deleted = false` y ordena
-- `created_at DESC` con paginación — la query más caliente de cada módulo,
-- que además ejecuta un count "exact" con los mismos filtros en CADA página.
-- Ninguna de las dos tablas tenía índice que sirviera ese orden.
--
-- Verificado por EXPLAIN (ANALYZE, BUFFERS) con volumen sintético de clínica
-- grande (~4.750 clientes / ~11.400 mascotas vivas por tenant; metodología de
-- S10, ver docs/EXPLAIN_INDICES.md §"Q4a revisada"):
--   ANTES  → Seq Scan + Sort (top-N heapsort) en cada página:
--            clientes 119 buffers / 1,9 ms; mascotas 265 buffers / 3,6 ms.
--            Costo lineal en el total del tenant, en cada carga de página.
--   DESPUÉS→ Index Scan directo, sin Sort: clientes 21 buffers / 0,06 ms
--            (~33×); mascotas 22 buffers / 0,04 ms (~95×). El count exact
--            de mascotas pasa a Index Only Scan (265 → 59 buffers).
--
-- Nota de contexto: S10 había medido este listado a escala demo (~600
-- clientes) y lo declaró "Seq scan aceptable"; a escala de producción de una
-- clínica grande el patrón se confirma como problema y se revierte esa
-- decisión con nueva evidencia.
--
-- Índices PARCIALES (WHERE NOT deleted): los listados solo consultan filas
-- vivas; los soft-deleted no ocupan el índice. El planner los usa porque la
-- query filtra `deleted = false` (predicado demostrable). El DESC en el
-- índice sirve el ORDER BY sin Sort.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_clientes_listado
  ON clientes (tenant_id, created_at DESC) WHERE NOT deleted;

CREATE INDEX IF NOT EXISTS idx_mascotas_listado
  ON mascotas (tenant_id, created_at DESC) WHERE NOT deleted;
