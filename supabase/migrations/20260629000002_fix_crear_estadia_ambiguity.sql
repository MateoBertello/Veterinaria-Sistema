-- =====================================================================
-- MIGRACIÓN 015: Fix — "column reference 'id' is ambiguous" en
-- crear_estadia_con_cupo (Etapa 7). Migración correctiva de la 014
-- (20260629000001); NO se edita aquella (ya aplicada), se hace DROP + CREATE.
-- =====================================================================
--
-- Causa: en una función `RETURNS TABLE (id UUID, ...)`, los nombres de las
-- columnas de salida (id, status, ...) son parámetros OUT visibles en TODO el
-- cuerpo. Las búsquedas `WHERE id = ...` sobre mascotas y clientes quedaban
-- ambiguas entre `<tabla>.id` y el OUT param `id`, abortando la función con
-- "column reference 'id' is ambiguous" (mismo gotcha que se corrigió en la
-- eutanasia: RETURNS TABLE sombrea columnas → calificar las tablas en WHERE).
--
-- Fix: calificar TODAS las referencias ambiguas (mascotas.id, clientes.id). El
-- resto del cuerpo ya estaba calificado (e.status, e.tenant_id, estadias.id).
-- Se conservan los nombres de las columnas de salida (los lee el Service vía
-- PostgREST), por eso NO se renombran: se califican las tablas, no los OUT.
-- =====================================================================

DROP FUNCTION IF EXISTS public.crear_estadia_con_cupo(
  UUID, UUID, UUID, DATE, DATE, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.crear_estadia_con_cupo(
  p_tenant_id  UUID,
  p_client_id  UUID,
  p_pet_id     UUID,
  p_check_in   DATE,
  p_check_out  DATE,
  p_reason     TEXT,
  p_notes      TEXT DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  client_id     UUID,
  pet_id        UUID,
  check_in_date DATE,
  check_out_date DATE,
  status        TEXT,
  reason        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ,
  pet_name      TEXT,
  pet_tamano    TEXT,
  pet_dieta     TEXT,
  client_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupo        INTEGER;
  v_pet         mascotas%ROWTYPE;
  v_client_name TEXT;
  v_dias_llenos DATE[];
  v_estadia_id  UUID;
BEGIN
  -- (0) Lock por tenant + cupo VIGENTE. Este FOR UPDATE serializa los altas del
  -- tenant (la 2ª transacción espera el COMMIT de la 1ª y cuenta ya con su fila).
  SELECT cupo_maximo_diario INTO v_cupo
  FROM configuracion_tenant
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_NOT_FOUND';
  END IF;

  -- (1) RN-GU3: mascota del tenant, no eliminada y viva. Se aprovecha para el
  -- snapshot de la tarjeta (nombre, tamaño, dieta).
  -- `mascotas.id` calificado: `id` es además un OUT param de la función.
  SELECT * INTO v_pet
  FROM mascotas
  WHERE mascotas.id = p_pet_id AND mascotas.tenant_id = p_tenant_id AND mascotas.deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  IF v_pet.estado <> 'Activa' THEN
    RAISE EXCEPTION 'PET_DECEASED';
  END IF;

  -- La mascota debe pertenecer al cliente seleccionado (coherencia del formulario).
  IF v_pet.client_id <> p_client_id THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  -- Cliente del tenant (para la tarjeta). `clientes.id` calificado por la misma razón.
  SELECT clientes.full_name INTO v_client_name
  FROM clientes
  WHERE clientes.id = p_client_id AND clientes.tenant_id = p_tenant_id;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  -- (2) RN-GU4: días del rango [check_in, check_out] cuya ocupación activa
  -- (Reservada/EnCurso) ya alcanza el cupo. '>=' ⇒ ocupados == cupo también
  -- rechaza (borde exacto). El conteo es consistente gracias al lock de (0).
  SELECT array_agg(d::date ORDER BY d::date) INTO v_dias_llenos
  FROM generate_series(p_check_in, p_check_out, interval '1 day') AS d
  WHERE (
    SELECT count(*)
    FROM estadias e
    WHERE e.tenant_id = p_tenant_id
      AND e.status IN ('Reservada', 'EnCurso')
      AND daterange(e.check_in_date, e.check_out_date, '[]') @> d::date
  ) >= v_cupo;

  IF v_dias_llenos IS NOT NULL THEN
    -- El Service parsea el JSON tras los dos puntos para poblar details.
    RAISE EXCEPTION 'CUPO_GUARDERIA_AGOTADO:%', to_jsonb(v_dias_llenos)::text;
  END IF;

  -- (3) Alta. RN-GU5: nace 'Reservada'. El constraint GIST excl_estadias_solapadas
  -- (RN-GU2) puede lanzar exclusion_violation → se re-lanza como STAY_OVERLAP.
  BEGIN
    INSERT INTO estadias (
      tenant_id, client_id, pet_id, check_in_date, check_out_date,
      status, reason, notes
    ) VALUES (
      p_tenant_id, p_client_id, p_pet_id, p_check_in, p_check_out,
      'Reservada', p_reason, p_notes
    )
    RETURNING estadias.id INTO v_estadia_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'STAY_OVERLAP';
  END;

  RETURN QUERY SELECT
    v_estadia_id,
    p_client_id,
    p_pet_id,
    p_check_in,
    p_check_out,
    'Reservada'::text,
    p_reason,
    p_notes,
    now(),
    v_pet.name,
    v_pet.tamano::text,
    v_pet.alimento_dieta,
    v_client_name;
END;
$$;

-- Endurecimiento: sólo la Edge Function (service_role) puede invocarla (la guarda
-- de cupo se saltearía si se invocara directo vía PostgREST con un p_tenant_id
-- arbitrario). El DROP anterior elimina los grants previos: se reaplican.
REVOKE ALL ON FUNCTION public.crear_estadia_con_cupo(
  UUID, UUID, UUID, DATE, DATE, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crear_estadia_con_cupo(
  UUID, UUID, UUID, DATE, DATE, TEXT, TEXT
) TO service_role;

-- Gotcha PostgREST: recargar el cache de esquema tras recrear la función.
NOTIFY pgrst, 'reload schema';
