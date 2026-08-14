-- =====================================================================
-- MIGRACIÓN: Auditoría — política de retención y purga programada
-- (RN-AUD4, DT-9)  [Etapa 9 — S11]
-- =====================================================================
--
-- RN-AUD4 pide conservar "al menos el histórico definido por política
-- (p. ej. últimos N registros / X meses)". Los índices que exige la regla
-- (fecha, módulo y usuario) ya existen: idx_auditoria_tenant_ts,
-- idx_auditoria_modulo (migración de tablas) e idx_auditoria_usuario (S10).
-- Esta migración implementa la política en sí.
--
-- POLÍTICA (MVP, decisión de producto en S11): conservar 12 MESES de
-- auditoría, global para todos los tenants. El horizonte es el parámetro
-- p_meses (DEFAULT 12): ajustar la política no requiere migración nueva,
-- solo reprogramar el job con otro argumento. La variante por-tenant
-- (columna en configuracion_tenant + UI) queda como evolución post-MVP.
--
-- La purga NO genera asiento de auditoría: RN-S3 audita escrituras de
-- usuario sobre entidades de negocio; esto es mantenimiento del sistema
-- (no hay usuario actor y auditar el borrado de auditoría vieja recrearía
-- el problema que se intenta resolver).
--
-- Sin secrets: a diferencia del cron de notificaciones (pg_net + Vault),
-- la purga es SQL puro dentro de la base → pg_cron invoca la función
-- directamente. Funciona en cualquier entorno apenas se aplica la
-- migración, sin setup adicional.

-- Habilitada por la migración del cron de notificaciones; idempotente por
-- si esta migración se aplica sobre una base que no la tenga.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- SECURITY DEFINER + EXECUTE restringido a service_role (patrón de la casa):
-- borra transversalmente a todos los tenants, no debe ser invocable por
-- roles de la API. pg_cron corre como superusuario (postgres), no lo afecta.
CREATE OR REPLACE FUNCTION public.purgar_auditoria(p_meses INTEGER DEFAULT 12)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_borrados INTEGER := 0;
BEGIN
  -- Guard: un horizonte no positivo vaciaría la tabla entera.
  IF p_meses IS NULL OR p_meses < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  DELETE FROM registros_auditoria
  WHERE "timestamp" < now() - make_interval(months => p_meses);

  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  RETURN v_borrados;
END;
$$;

REVOKE ALL     ON FUNCTION public.purgar_auditoria(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purgar_auditoria(INTEGER) TO   service_role;

-- Programación idempotente del job (por si se re-aplica sobre una DB existente).
DO $$
BEGIN
  PERFORM cron.unschedule('auditoria-purga-semanal');
EXCEPTION WHEN OTHERS THEN
  NULL; -- el job no existía todavía; se ignora
END;
$$;

-- Semanal (domingos 04:00 UTC): la granularidad fina no aporta — el horizonte
-- es de meses — y el DELETE barre idx_auditoria_tenant_ts sin bloquear escrituras.
SELECT cron.schedule(
  'auditoria-purga-semanal',
  '0 4 * * 0',
  $$SELECT public.purgar_auditoria();$$
);

-- Convención de la casa: recargar el schema cache de PostgREST tras crear RPCs.
NOTIFY pgrst, 'reload schema';
