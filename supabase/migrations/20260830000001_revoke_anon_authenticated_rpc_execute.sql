-- =====================================================================
-- MIGRACIÓN: Revocar EXECUTE explícito de anon y authenticated sobre RPCs
-- =====================================================================
-- En PostgreSQL/Supabase, los roles anon y authenticated recibían
-- EXECUTE por privilegios por defecto sobre funciones en el esquema public.
-- Las migraciones anteriores ejecutaban REVOKE ALL ... FROM PUBLIC, pero
-- en Postgres revocar de PUBLIC no elimina los grants otorgados
-- específicamente a anon y authenticated.
--
-- Esta migración revoca EXECUTE de anon y authenticated en todo el
-- esquema public, vuelve a otorgar permisos únicamente a las funciones de
-- soporte RLS necesarias para usuarios autenticados, y asegura que
-- service_role conserve EXECUTE.
-- =====================================================================

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Helpers requeridos por RLS / constraints evaluados con el rol del caller:
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.timerange(time, time) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.usuario_activo()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tiene_permiso(text) TO authenticated, service_role;

-- La Edge Function opera con service_role:
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Configuración por defecto para funciones creadas a futuro:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
