-- ─────────────────────────────────────────────────────────────────────────────
-- Etapa 9 — S6: Scheduler de notificaciones (RN-NT5).
--
-- Programa un job pg_cron horario que dispara, vía pg_net (HTTP), el endpoint interno
-- del Edge Function `POST /internal/notificaciones/procesar`. Ese endpoint corre el
-- barrido de recordatorios de turnos (RN-NT1..NT6) y avisos de vacunación (RN-PV6/PV7)
-- para TODOS los tenants activos con el módulo licenciado (el filtro vive en el service).
--
-- El "no spamear" lo garantiza el UNIQUE(tenant_id, origen, referencia_id, canal) de
-- `notificaciones`: dos disparos consecutivos NO reenvían (el 2.º INSERT choca → skipped).
--
-- Frecuencia: cada hora ('0 * * * *'). Es la ventana más fina del sistema (recordatorio
-- de turno por defecto = 24 h): así ningún recordatorio llega con más de 1 h de atraso, y
-- como el UNIQUE hace idempotentes las relecturas, re-correr es gratis.
--
-- SECRETO FUERA DE LA MIGRACIÓN (Vault): la función lee la URL y el secreto de
-- `vault.decrypted_secrets`. NO se hardcodean acá. Se cargan por entorno (ver más abajo).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;   -- schema `cron`
CREATE EXTENSION IF NOT EXISTS pg_net;    -- schema `net`

-- Función wrapper: lee los secrets de Vault y hace el POST asíncrono (pg_net).
-- SECURITY DEFINER + acceso restringido a service_role (patrón de la casa).
CREATE OR REPLACE FUNCTION public.disparar_notificaciones()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'cron_notif_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_notif_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'disparar_notificaciones: faltan secrets de Vault (cron_notif_url / cron_notif_secret); se omite el disparo';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'X-Cron-Secret', v_secret
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.disparar_notificaciones() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.disparar_notificaciones() TO   service_role;

-- Programación idempotente del job (por si se re-aplica sobre una DB existente).
DO $$
BEGIN
  PERFORM cron.unschedule('notificaciones-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL; -- el job no existía todavía; se ignora
END;
$$;

SELECT cron.schedule(
  'notificaciones-hourly',
  '0 * * * *',
  $$SELECT public.disparar_notificaciones();$$
);

-- La función queda expuesta a PostgREST: recargar el schema cache (gotcha RPC conocido).
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- SETUP DE SECRETS POR ENTORNO (NO commitear valores reales)
--
-- El secreto es el mismo que el env `CRON_SECRET` del Edge Function (lo valida
-- `requireCronSecret`). Cargar en cada entorno (una sola vez):
--
--   SELECT vault.create_secret('<CRON_SECRET>',  'cron_notif_secret');
--   SELECT vault.create_secret('<URL-COMPLETA>', 'cron_notif_url');
--
-- URL completa del endpoint (función `api` + basePath `/api/v1` → doble `api/api/v1`):
--   • Local (pg_net dentro del contenedor DB → gateway del stack):
--       http://host.docker.internal:54321/functions/v1/api/api/v1/internal/notificaciones/procesar
--   • Producción:
--       https://<project-ref>.supabase.co/functions/v1/api/api/v1/internal/notificaciones/procesar
--
-- Rotar un secreto (Vault no permite duplicar el `name`):
--   SELECT vault.update_secret(id, '<nuevo-valor>') FROM vault.secrets WHERE name = 'cron_notif_secret';
-- ─────────────────────────────────────────────────────────────────────────────
