-- =====================================================================
-- MIGRACIÓN: Acota el EXECUTE de funciones al mínimo privilegio [pre-deploy]
-- =====================================================================
-- El análisis de seguridad pre-deploy encontró que 6 funciones de public
-- conservaban el EXECUTE implícito de PUBLIC (proacl nulo): eran ejecutables
-- por `anon` y `authenticated` vía POST /rest/v1/rpc/<fn>. Tres de ellas son
-- SECURITY DEFINER y reciben p_tenant_id/estructura por parámetro, así que
-- PostgREST + anon key permitía operar sobre CUALQUIER tenant sin pasar por
-- la Edge Function (RLS no aplica dentro de un DEFINER):
--
--   - cambiar_dueno_mascota  → transferencia de mascotas cross-tenant
--   - crear_tenant           → alta de tenants desde anon
--   - on_tenant_created      → re-aprovisionamiento de roles/módulos
--
-- Se aplica el mismo endurecimiento que ya usan registrar_eutanasia y
-- crear_estadia_con_cupo: REVOKE del default de PUBLIC + GRANT explícito a
-- service_role (la Edge Function es el único caller legítimo).
--
-- Los helpers current_tenant_id / is_super_admin / timerange NO pueden
-- quedar solo en service_role: los dos primeros se evalúan dentro de las
-- políticas RLS (20260614000003_rls.sql) con el rol efectivo del caller
-- (`authenticated` en los reads de catálogos y en la suite de aislamiento),
-- y timerange() se evalúa en el constraint EXCLUDE de turnos también bajo
-- escrituras de `authenticated` (las políticas de negocio son FOR ALL).
-- Para ellos el mínimo es authenticated + service_role.
--
-- Verificación en stack local (has_function_privilege) antes del fix:
--   anon_exec = true en las 6; después: false en todas, RLS intacta.
-- =====================================================================

-- ── RPCs sensibles: solo la Edge Function (service_role) ────────────────────

REVOKE ALL ON FUNCTION public.cambiar_dueno_mascota(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cambiar_dueno_mascota(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.crear_tenant(
  TEXT, TEXT, TEXT, plan_tenant
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_tenant(
  TEXT, TEXT, TEXT, plan_tenant
) TO service_role;

REVOKE ALL ON FUNCTION public.on_tenant_created(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.on_tenant_created(UUID) TO service_role;

-- ── Helpers de RLS/constraints: authenticated + service_role ────────────────

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.timerange(time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.timerange(time, time) TO authenticated, service_role;

-- ── Defensa a futuro (espejo de 20260706000001 para tablas/secuencias) ──────
-- Las funciones que se creen de acá en más no nacen ejecutables por PUBLIC:
-- cada RPC nueva debe GRANTear explícitamente a su caller (todas las
-- migraciones de RPC existentes ya lo hacen).

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
