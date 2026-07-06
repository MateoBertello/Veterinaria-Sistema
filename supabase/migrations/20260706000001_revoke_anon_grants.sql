-- =====================================================================
-- MIGRACIÓN: Revoca TODO privilegio de `anon` sobre public (DT-5)
-- =====================================================================
-- Evidencia (Etapa 9 — S3): el proxy de catálogos del front
-- (web/src/api/catalogos.ts) reenvía el JWT del usuario logueado como
-- `Authorization: Bearer`, y PostgREST resuelve el rol efectivo por ese
-- claim (no por el header `apikey`). Un access_token real de GoTrue trae
-- role=authenticated, y todo consumidor de catalogos.ts está montado bajo
-- <ProtectedRoute> (web/src/App.tsx) — no existe un flujo real sin sesión.
-- Las políticas RLS de especies/razas/tipos_vacuna ya exigen
-- auth.uid() IS NOT NULL, así que un GRANT de tabla para `anon` es una
-- barrera redundante que nunca llega a ejercitarse.
--
-- Por lo tanto se revoca TODO privilegio de `anon` (DML + SELECT) sobre
-- las tablas/secuencias actuales y futuras de public. `authenticated` y
-- `service_role` no se modifican.
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM anon;
