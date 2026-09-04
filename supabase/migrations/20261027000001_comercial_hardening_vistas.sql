-- @modulo: comercial
-- =====================================================================
-- CORRECCIÓN 1.1 (auditoría final del Módulo Comercial)
-- Hardening de las 7 vistas comerciales: security_invoker + REVOKE SELECT
-- =====================================================================
--
-- QUÉ ESTABA MAL
--
-- Las 7 vistas se crearon con `CREATE OR REPLACE VIEW` a secas. Una vista sin
-- `security_invoker = true` se ejecuta con los privilegios de SU DUEÑO —acá
-- `postgres`, que tiene BYPASSRLS—, no con los de quien la consulta: la RLS de
-- las tablas de abajo NO se aplica. Y como `authenticated` tenía SELECT sobre
-- las 7 (herencia de los GRANT por defecto del esquema public), cualquier
-- usuario logueado de cualquier clínica podía pedirlas por PostgREST directo y
-- leer las filas de TODAS las demás.
--
-- No hacía falta ningún bug en ningún Service: la fuga estaba en la definición
-- de la vista. Verificado en base limpia antes de esta migración: un JWT del
-- tenant B recibía filas del tenant A en las 7 vistas.
--
-- POR QUÉ LAS DOS COSAS Y NO UNA
--
--   * `security_invoker = true` hace que la vista aplique la RLS del que
--     consulta. Es la corrección de fondo: aunque mañana alguien vuelva a
--     otorgar el SELECT, no se filtra nada.
--   * El `REVOKE SELECT ... FROM authenticated` cierra la superficie: estas
--     vistas son de reporte y se consumen por la API con `service_role`
--     (`getServiceDb()`), nunca desde el frontend por PostgREST. Ningún JWT de
--     usuario tiene motivo para pedirlas.
--
-- Se verificó que ningún consumidor se rompe: los 12 accesos a estas vistas en
-- `supabase/functions/api/src/modules/` corren con `getServiceDb()`, y
-- `service_role` tiene BYPASSRLS, así que sigue viendo todo (el aislamiento en
-- ese camino lo da el `.eq("tenant_id", ctx.tenantId)` de cada consulta, ver
-- CLAUDE.md). En `web/src` no hay ni una lectura de estas vistas.
--
-- Ver §4.13 de ADENDA_SPEC_COMERCIAL.md.

-- ─── 1. security_invoker en las 7 vistas ─────────────────────────────────────

ALTER VIEW public.v_lotes_por_vencer          SET (security_invoker = true);
ALTER VIEW public.v_items_vendidos            SET (security_invoker = true);
ALTER VIEW public.v_margen_venta              SET (security_invoker = true);
ALTER VIEW public.v_costo_fraccionamiento     SET (security_invoker = true);
ALTER VIEW public.v_stock_familia_unidad_base SET (security_invoker = true);
ALTER VIEW public.v_consumo_clinico           SET (security_invoker = true);
ALTER VIEW public.v_atenciones_sin_consumo    SET (security_invoker = true);

-- ─── 2. Sin SELECT para anon ni authenticated ────────────────────────────────
--
-- `service_role` conserva el SELECT: es el único camino de lectura previsto.

REVOKE ALL ON public.v_lotes_por_vencer          FROM anon, authenticated;
REVOKE ALL ON public.v_items_vendidos            FROM anon, authenticated;
REVOKE ALL ON public.v_margen_venta              FROM anon, authenticated;
REVOKE ALL ON public.v_costo_fraccionamiento     FROM anon, authenticated;
REVOKE ALL ON public.v_stock_familia_unidad_base FROM anon, authenticated;
REVOKE ALL ON public.v_consumo_clinico           FROM anon, authenticated;
REVOKE ALL ON public.v_atenciones_sin_consumo    FROM anon, authenticated;

GRANT SELECT ON public.v_lotes_por_vencer          TO service_role;
GRANT SELECT ON public.v_items_vendidos            TO service_role;
GRANT SELECT ON public.v_margen_venta              TO service_role;
GRANT SELECT ON public.v_costo_fraccionamiento     TO service_role;
GRANT SELECT ON public.v_stock_familia_unidad_base TO service_role;
GRANT SELECT ON public.v_consumo_clinico           TO service_role;
GRANT SELECT ON public.v_atenciones_sin_consumo    TO service_role;

NOTIFY pgrst, 'reload schema';
