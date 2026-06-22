-- =====================================================================
-- MIGRACIÓN 010: GRANTs a los roles de la API de Supabase
-- =====================================================================
-- Las tablas se crean en migraciones ejecutadas como `postgres`, pero los
-- roles de la API (`anon`, `authenticated`, `service_role`) NO reciben
-- privilegios DML automáticamente en un Postgres no gestionado / un stack
-- LOCAL fresco (en un proyecto hosted Supabase los aplica la plataforma).
-- Sin estos GRANT, todo endpoint responde "permission denied" (42501) y los
-- middlewares fallan con TENANT_NOT_FOUND aunque las migraciones y RLS estén
-- bien. El AISLAMIENTO POR TENANT lo sigue garantizando RLS (regla 1): estos
-- grants son a nivel tabla; las políticas RLS gobiernan el acceso por fila.
--
-- Idempotente: GRANT/ALTER DEFAULT PRIVILEGES se pueden reaplicar sin efecto.
--
-- ⚠️ DEUDA DE SEGURIDAD (Etapa 9 — hardening):
-- Aquí se otorga SELECT/INSERT/UPDATE/DELETE también a `anon` (rol SIN
-- autenticar) para desbloquear el dev local, replicando el modelo por defecto
-- de Supabase (grants amplios + RLS como única barrera). Antes de producción,
-- ACOTAR los privilegios de `anon` al mínimo imprescindible (idealmente solo
-- SELECT sobre catálogos globales) o QUITARLOS si el acceso real va siempre por
-- `authenticated`/`service_role`. Revisar junto con las políticas RLS.
-- =====================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- DML sobre todas las tablas actuales del esquema public.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Secuencias (por si alguna tabla usa identidades/serial).
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Que las tablas/secuencias creadas a futuro por `postgres` hereden los grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role;
