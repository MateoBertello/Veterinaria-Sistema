-- =====================================================================
-- MIGRACIÓN 019: Guardería — Check-in y Check-out (RPCs)
-- Casos de uso "Check-in" y "Check-out" (Etapa 7; v1.0 §5, RN-CK1..CK6).
-- =====================================================================
--
-- ─── hacer_checkin ────────────────────────────────────────────────────────────
--
-- RN-CK1: transición válida Reservada → EnCurso. Cualquier otro estado origen →
--   INVALID_TRANSITION (422). EnCurso, Finalizada y Cancelada son rechazados.
-- RN-CK2: registra checked_in_at = now() al pasar a EnCurso.
-- RN-CK4: Finalizada y Cancelada son estados terminales; también los rechaza.
-- RN-CK5: permiso manage_daycare gestionado por el middleware del controller.
-- RN-CK6: auditoría UPDATE módulo daycare — la registra el Service.
--
-- No requiere lock de cupo (FOR UPDATE sobre configuracion_tenant):
--   check-in NO cambia la ocupación del día — Reservada y EnCurso cuentan igual
--   en el conteo de cupo. Solo se toma un FOR UPDATE sobre la fila de estadías
--   para serializar operaciones simultáneas sobre el mismo id.
--
-- ─── hacer_checkout ───────────────────────────────────────────────────────────
--
-- RN-CK1: transición válida EnCurso → Finalizada. Cualquier otro origen →
--   INVALID_TRANSITION.
-- RN-CK3: registra checked_out_at = now(); libera cupo de forma IMPLÍCITA
--   (el conteo de cupo filtra `status IN ('Reservada','EnCurso')`; al pasar
--   a Finalizada la estadía deja de contar automáticamente, sin lógica extra).
-- RN-CK4: Reservada, Finalizada y Cancelada son rechazados.
--
-- Patrón aplicado (gotcha de 7b):
--   - El WHERE del UPDATE usa el alias `estadias.id` (nombre de la tabla, no la
--     columna de RETURNS TABLE) para evitar el shadowing de columnas que generó
--     el bug de 7a/7b.
--   - El RETURN QUERY SELECT devuelve las variables DECLARE (p_estadia_id, literal,
--     v_now) en lugar de columnas de RETURNING, mismo enfoque que cancelar_estadia.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hacer_checkin(
  p_tenant_id   UUID,
  p_estadia_id  UUID
)
RETURNS TABLE (
  id            UUID,
  status        TEXT,
  checked_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estadia  estadias%ROWTYPE;
  v_now      TIMESTAMPTZ := now();
BEGIN
  -- (1) Leer y bloquear la fila de la estadía (serializa dobles check-in concurrentes).
  SELECT * INTO v_estadia
  FROM estadias e
  WHERE e.id = p_estadia_id AND e.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTADIA_NOT_FOUND';
  END IF;

  -- (2) RN-CK1/CK4: solo Reservada puede hacer check-in.
  IF v_estadia.status != 'Reservada' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  -- (3) RN-CK2: pasar a EnCurso y registrar marca temporal de ingreso real.
  UPDATE estadias
  SET status        = 'EnCurso',
      checked_in_at = v_now
  WHERE estadias.id = p_estadia_id AND estadias.tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    p_estadia_id,
    'EnCurso'::text,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.hacer_checkin(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hacer_checkin(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hacer_checkout(
  p_tenant_id   UUID,
  p_estadia_id  UUID
)
RETURNS TABLE (
  id             UUID,
  status         TEXT,
  checked_out_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estadia  estadias%ROWTYPE;
  v_now      TIMESTAMPTZ := now();
BEGIN
  -- (1) Leer y bloquear la fila (serializa dobles check-out concurrentes).
  SELECT * INTO v_estadia
  FROM estadias e
  WHERE e.id = p_estadia_id AND e.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTADIA_NOT_FOUND';
  END IF;

  -- (2) RN-CK1/CK4: solo EnCurso puede hacer check-out.
  IF v_estadia.status != 'EnCurso' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  -- (3) RN-CK3: pasar a Finalizada y registrar marca temporal de egreso real.
  --     El cupo se libera implícitamente: Finalizada deja de contar en el
  --     conteo de cupo (que filtra Reservada/EnCurso).
  UPDATE estadias
  SET status         = 'Finalizada',
      checked_out_at = v_now
  WHERE estadias.id = p_estadia_id AND estadias.tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    p_estadia_id,
    'Finalizada'::text,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.hacer_checkout(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hacer_checkout(UUID, UUID) TO service_role;

-- Recargar el cache de esquema para que ambas funciones sean invocables vía supabase-js.
NOTIFY pgrst, 'reload schema';
