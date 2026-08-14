-- =====================================================================
-- MIGRACIÓN 016: Guardería — Modificar y Cancelar Estadía (RPCs)
-- Casos de uso "Modificar Estadía" y "Cancelar Estadía" (Etapa 7; v1.0 §5).
-- =====================================================================
--
-- ─── modificar_estadia_con_cupo ───────────────────────────────────────────────
--
-- Reutiliza el mismo patrón de guarda atómica que `crear_estadia_con_cupo`
-- (FOR UPDATE sobre configuracion_tenant por tenant) para revalidar el cupo
-- en los NUEVOS días sin ventana de carrera (RN-ME2 + RN-GU4).
--
-- Diferencia clave respecto a crear: el conteo de ocupación excluye la propia
-- estadía que se está modificando (`AND e.id <> p_estadia_id`), ya que sus días
-- actuales quedan libres cuando se cambia el rango.
--
-- RN-ME1 (estados editables):
--   - Finalizada | Cancelada → STAY_LOCKED (terminal; no se puede editar).
--   - EnCurso + p_check_in ≠ check_in_date vigente → STAY_LOCKED (solo egreso).
--   - Reservada → modificación completa.
--
-- RN-ME2 (revalidación): cupo y solape se revalidan igual que en el alta.
-- El constraint GIST `excl_estadias_solapadas` en UPDATE excluye la fila
-- modificada antes de re-insertarla (comportamiento estándar de PostgreSQL),
-- por lo que los solapes contra otras estadías se detectan correctamente.
--
-- SECURITY DEFINER + REVOKE PUBLIC + GRANT service_role: mismo endurecimiento
-- que los otros RPCs de guardería.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.modificar_estadia_con_cupo(
  p_tenant_id   UUID,
  p_estadia_id  UUID,
  p_check_in    DATE,
  p_check_out   DATE,
  p_reason      TEXT,
  p_notes       TEXT DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  client_id      UUID,
  pet_id         UUID,
  check_in_date  DATE,
  check_out_date DATE,
  status         TEXT,
  reason         TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ,
  pet_name       TEXT,
  pet_tamano     TEXT,
  pet_dieta      TEXT,
  client_name    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupo         INTEGER;
  v_estadia      estadias%ROWTYPE;
  v_pet          mascotas%ROWTYPE;
  v_client_name  TEXT;
  v_dias_llenos  DATE[];
BEGIN
  -- (0) Lock por tenant + cupo VIGENTE (mismo mutex que crear_estadia_con_cupo).
  SELECT cupo_maximo_diario INTO v_cupo
  FROM configuracion_tenant
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_NOT_FOUND';
  END IF;

  -- (1) Leer la estadía actual (verifica existencia + tenencia).
  SELECT * INTO v_estadia
  FROM estadias e
  WHERE e.id = p_estadia_id AND e.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTADIA_NOT_FOUND';
  END IF;

  -- (2) RN-ME1: validación de estado.
  IF v_estadia.status IN ('Finalizada', 'Cancelada') THEN
    RAISE EXCEPTION 'STAY_LOCKED';
  END IF;

  IF v_estadia.status = 'EnCurso' AND p_check_in <> v_estadia.check_in_date THEN
    -- Solo se permite ajustar la fecha de egreso cuando está En Curso.
    RAISE EXCEPTION 'STAY_LOCKED';
  END IF;

  -- (3) RN-ME2: cupo en el NUEVO rango, excluyendo esta estadía del conteo.
  SELECT array_agg(d::date ORDER BY d::date) INTO v_dias_llenos
  FROM generate_series(p_check_in, p_check_out, interval '1 day') AS d
  WHERE (
    SELECT count(*)
    FROM estadias e
    WHERE e.tenant_id = p_tenant_id
      AND e.id <> p_estadia_id
      AND e.status IN ('Reservada', 'EnCurso')
      AND daterange(e.check_in_date, e.check_out_date, '[]') @> d::date
  ) >= v_cupo;

  IF v_dias_llenos IS NOT NULL THEN
    RAISE EXCEPTION 'CUPO_GUARDERIA_AGOTADO:%', to_jsonb(v_dias_llenos)::text;
  END IF;

  -- (4) RN-ME2: actualizar. El constraint GIST excluye la fila modificada
  -- durante el UPDATE, detectando solapes contra otras estadías → STAY_OVERLAP.
  BEGIN
    UPDATE estadias
    SET check_in_date  = p_check_in,
        check_out_date = p_check_out,
        reason         = p_reason,
        notes          = p_notes
    WHERE estadias.id = p_estadia_id AND estadias.tenant_id = p_tenant_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'STAY_OVERLAP';
  END;

  -- (5) Cargar tarjeta de mascota y cliente para la respuesta (misma forma que crear).
  SELECT * INTO v_pet
  FROM mascotas
  WHERE mascotas.id = v_estadia.pet_id AND mascotas.tenant_id = p_tenant_id;

  SELECT clientes.full_name INTO v_client_name
  FROM clientes
  WHERE clientes.id = v_estadia.client_id AND clientes.tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    v_estadia.id,
    v_estadia.client_id,
    v_estadia.pet_id,
    p_check_in,
    p_check_out,
    v_estadia.status::text,
    p_reason,
    p_notes,
    v_estadia.created_at,
    v_pet.name,
    v_pet.tamano::text,
    v_pet.alimento_dieta,
    v_client_name;
END;
$$;

REVOKE ALL ON FUNCTION public.modificar_estadia_con_cupo(
  UUID, UUID, DATE, DATE, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.modificar_estadia_con_cupo(
  UUID, UUID, DATE, DATE, TEXT, TEXT
) TO service_role;

-- ─── cancelar_estadia ─────────────────────────────────────────────────────────
--
-- No requiere lock de cupo: cancelar libera cupo automáticamente (el conteo de
-- ocupación solo cuenta Reservada/EnCurso; Cancelada no se cuenta). No puede
-- producir overbooking.
--
-- RN-ME1: Finalizada y Cancelada son terminales → STAY_LOCKED.
-- RN-ME3: marca status='Cancelada', persiste motivo y timestamp.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancelar_estadia(
  p_tenant_id            UUID,
  p_estadia_id           UUID,
  p_cancellation_reason  TEXT
)
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  cancelled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estadia  estadias%ROWTYPE;
  v_now      TIMESTAMPTZ := now();
BEGIN
  -- (1) Leer la estadía actual.
  SELECT * INTO v_estadia
  FROM estadias e
  WHERE e.id = p_estadia_id AND e.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTADIA_NOT_FOUND';
  END IF;

  -- (2) RN-ME1: estados terminales no se cancelan.
  IF v_estadia.status IN ('Finalizada', 'Cancelada') THEN
    RAISE EXCEPTION 'STAY_LOCKED';
  END IF;

  -- (3) RN-ME3: marcar como Cancelada con motivo y timestamp.
  UPDATE estadias
  SET status               = 'Cancelada',
      cancellation_reason  = p_cancellation_reason,
      cancelled_at         = v_now
  WHERE estadias.id = p_estadia_id AND estadias.tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    p_estadia_id,
    'Cancelada'::text,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_estadia(
  UUID, UUID, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cancelar_estadia(
  UUID, UUID, TEXT
) TO service_role;

-- Recargar el cache de esquema para que ambas funciones sean invocables vía supabase-js.
NOTIFY pgrst, 'reload schema';
