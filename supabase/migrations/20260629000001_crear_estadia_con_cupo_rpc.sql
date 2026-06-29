-- =====================================================================
-- MIGRACIÓN 014: Guardería — Registrar Estadía con guarda de cupo (RPC)
-- Caso de uso "Registrar Estadía" (Etapa 7; v1.0 §5 + Addendum v1.1).
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- RPC crear_estadia_con_cupo — alta de estadía con cupo SIN ventana de carrera
--
-- RN-GU4 (cupo por día) NO es expresable como un constraint de tabla (es una
-- capacidad sobre rangos solapados) y NO puede resolverse con
-- chequear-antes-de-insertar en el Service: dos requests por el último lugar
-- leerían "hay cupo" y ambas insertarían → overbooking. Es, en gravedad, el
-- equivalente al rollback de la eutanasia: un bug acá deja overbooking en prod.
--
-- La guarda real vive en DB. Esta función toma `SELECT ... FOR UPDATE` sobre la
-- fila de `configuracion_tenant` del tenant (singleton: una fila por tenant →
-- mutex natural por tenant). Dos transacciones concurrentes del mismo tenant se
-- serializan: la 2ª espera al COMMIT de la 1ª y recién entonces cuenta la
-- ocupación, viendo ya la estadía que la 1ª insertó. Así el conteo+insert son
-- atómicos por tenant. Además, leer el cupo bajo el lock garantiza el valor
-- VIGENTE (RN-CF3, sin caché).
--
-- RN-GU2 (sin solape por mascota) la sigue garantizando el constraint GIST
-- `excl_estadias_solapadas`; aquí se captura su `exclusion_violation` y se
-- re-lanza como STAY_OVERLAP para mapeo uniforme en el Service.
--
-- RN-GU1 (rango válido / fecha no pasada) se valida en el Service con Zod
-- (INVALID_RANGE / PAST_DATE); el CHECK de la tabla es backstop.
--
-- SECURITY DEFINER: la Edge Function opera vía service_role (bypass RLS); el
-- aislamiento por tenant se garantiza explícitamente con p_tenant_id en cada
-- lectura/escritura. p_tenant_id SIEMPRE proviene del JWT (regla 1).
--
-- Los errores de negocio se propagan vía RAISE EXCEPTION con el MESSAGE igual
-- al código de ErrorCode; el Service los mapea a DomainError. CUPO_GUARDERIA_
-- AGOTADO incluye los días sin cupo como JSON para el campo `details`.
-- ---------------------------------------------------------------------
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
  SELECT * INTO v_pet
  FROM mascotas
  WHERE id = p_pet_id AND tenant_id = p_tenant_id AND deleted = false;

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

  -- Cliente del tenant (para la tarjeta).
  SELECT full_name INTO v_client_name
  FROM clientes
  WHERE id = p_client_id AND tenant_id = p_tenant_id;

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

-- Endurecimiento: sólo la Edge Function (service_role) puede invocarla. Se revoca
-- el EXECUTE por defecto a PUBLIC para que `anon`/`authenticated` no la ejecuten
-- vía PostgREST con un p_tenant_id arbitrario (la guarda de cupo se saltearía si
-- se invocara sin pasar por el Service).
REVOKE ALL ON FUNCTION public.crear_estadia_con_cupo(
  UUID, UUID, UUID, DATE, DATE, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crear_estadia_con_cupo(
  UUID, UUID, UUID, DATE, DATE, TEXT, TEXT
) TO service_role;

-- Gotcha PostgREST: recargar el cache de esquema tras crear la función, para que
-- el RPC sea invocable de inmediato vía supabase-js (.rpc).
NOTIFY pgrst, 'reload schema';
