-- =====================================================================
-- MIGRACIÓN 012: Eutanasia — auditoría ATÓMICA dentro del RPC
-- Supersede a la migración 011 (20260623000002): mueve el asiento de
-- auditoría (RN-S3) DENTRO de la transacción de `registrar_eutanasia`, para
-- que el registro de la operación irreversible sea atómico con ella (no
-- best-effort en el Service): si la eutanasia hace rollback, el asiento de
-- auditoría también; si commitea, el asiento queda garantizado.
--
-- Cambios vs. migración 011:
--   • Nuevo parámetro p_user_id (UUID): el usuario AUTENTICADO que ejecuta la
--     operación (caller, del JWT), distinto del profesional firmante
--     (p_professional_id). El asiento registra a este usuario.
--   • INSERT INTO registros_auditoria antes del RETURN QUERY, módulo
--     'medical_records', acción 'CREATE'.
--   • El RPC resuelve full_name / display_name del ejecutor desde usuarios+roles
--     (SECURITY DEFINER bypasea RLS), para que el asiento registre QUIÉN ejecutó
--     y no 'unknown'.
--
-- Se hace DROP + CREATE (no CREATE OR REPLACE) porque cambia la firma de la
-- función (nuevo parámetro). Es una feature recién agregada, sin uso en
-- producción: el DROP es seguro.
-- =====================================================================

DROP FUNCTION IF EXISTS public.registrar_eutanasia(
  UUID, UUID, UUID, DATE, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.registrar_eutanasia(
  p_tenant_id       UUID,
  p_pet_id          UUID,
  p_professional_id UUID,
  p_user_id         UUID,
  p_date            DATE,
  p_description     TEXT,
  p_confirmed       BOOLEAN,
  p_weight_kg       NUMERIC DEFAULT NULL,
  p_temperature_c   NUMERIC DEFAULT NULL,
  p_diagnosis       TEXT    DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL
)
RETURNS TABLE (
  event_id            UUID,
  pet_id              UUID,
  date                DATE,
  event_type          TEXT,
  professional_name   TEXT,
  client_name_at_time TEXT,
  mascota_name        TEXT,
  mascota_estado      TEXT,
  deceased_date       DATE,
  deceased_reason     TEXT,
  cancelled_doses     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pet        mascotas%ROWTYPE;
  v_prof_name  TEXT;
  v_owner_name TEXT;
  v_user_name  TEXT;
  v_user_role  TEXT;
  v_event_id   UUID;
  v_cancelled  INTEGER := 0;
BEGIN
  -- Mascota del tenant, no eliminada. FOR UPDATE: bloquea la fila para
  -- serializar cualquier cambio de estado concurrente (evita doble eutanasia).
  SELECT * INTO v_pet
  FROM mascotas
  WHERE id = p_pet_id AND tenant_id = p_tenant_id AND deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  -- RN-EC10 (defensa en profundidad): sin confirmación explícita no se ejecuta
  -- la transacción irreversible. La validación primaria está en el Service.
  IF NOT COALESCE(p_confirmed, false) THEN
    RAISE EXCEPTION 'EUTHANASIA_CONFIRMATION_REQUIRED';
  END IF;

  -- Guard de irreversibilidad: sólo se eutanasia una mascota viva.
  IF v_pet.estado <> 'Activa' THEN
    RAISE EXCEPTION 'PET_DECEASED';
  END IF;

  -- El profesional firmante debe existir y pertenecer al mismo tenant.
  SELECT full_name INTO v_prof_name
  FROM usuarios
  WHERE id = p_professional_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- RN-EC5: snapshot inmutable del dueño vigente. client_id es NOT NULL (FK);
  -- se toma el nombre aunque el cliente esté en baja lógica (es la historia).
  SELECT full_name INTO v_owner_name
  FROM clientes
  WHERE id = v_pet.client_id AND tenant_id = p_tenant_id;

  IF v_owner_name IS NULL THEN
    RAISE EXCEPTION 'INTERNAL_ERROR';
  END IF;

  -- Identidad del usuario que EJECUTA la eutanasia (para el asiento RN-S3).
  -- No bloquea la operación si no se resuelve: el user_id igual queda registrado.
  SELECT u.full_name, COALESCE(r.display_name, r.name)
  INTO v_user_name, v_user_role
  FROM usuarios u
  LEFT JOIN roles r ON r.id = u.rol_id
  WHERE u.id = p_user_id AND u.tenant_id = p_tenant_id;

  -- (1) Evento clínico 'Eutanasia' (último registro admisible de la historia).
  INSERT INTO historial_clinico (
    tenant_id, pet_id, professional_id, date, event_type, description,
    weight_kg, temperature_c, diagnosis, notes,
    client_id_at_time, client_name_at_time
  ) VALUES (
    p_tenant_id, p_pet_id, p_professional_id, p_date, 'Eutanasia', p_description,
    p_weight_kg, p_temperature_c, p_diagnosis, p_notes,
    v_pet.client_id, v_owner_name
  )
  RETURNING id INTO v_event_id;

  -- (2) Inactivación automática e irreversible. deceased_date = fecha del
  -- evento; deceased_reason fijo 'Eutanasia'. Cumple el CHECK de mascotas
  -- (estado='Activa' OR deceased_date IS NOT NULL).
  UPDATE mascotas
  SET estado          = 'Fallecida',
      deceased_date   = p_date,
      deceased_reason = 'Eutanasia'
  WHERE id = p_pet_id AND tenant_id = p_tenant_id;

  -- (3) RN-PV4: las dosis Pendiente de la mascota pasan a Cancelada dentro de
  -- esta misma transacción.
  UPDATE plan_vacunacion
  SET estado = 'Cancelada'
  WHERE pet_id = p_pet_id AND tenant_id = p_tenant_id AND estado = 'Pendiente';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- (4) RN-S3: asiento de auditoría ATÓMICO con la operación. Si algo de lo
  -- anterior hubiera fallado, este INSERT no se alcanza; si algo posterior
  -- fallara, este INSERT también rollbackea. Registra al usuario ejecutor.
  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_user_id, v_user_name, v_user_role, 'CREATE', 'medical_records', v_event_id::text,
    jsonb_build_object(
      'event_type',      'Eutanasia',
      'pet_id',          p_pet_id,
      'professional_id', p_professional_id,
      'deceased_date',   p_date,
      'deceased_reason', 'Eutanasia',
      'cancelled_doses', v_cancelled
    )
  );

  RETURN QUERY SELECT
    v_event_id,
    p_pet_id,
    p_date,
    'Eutanasia'::text,
    v_prof_name,
    v_owner_name,
    v_pet.name,
    'Fallecida'::text,
    p_date,
    'Eutanasia'::text,
    v_cancelled;
END;
$$;

-- Endurecimiento: por tratarse de la única transacción IRREVERSIBLE, sólo la
-- Edge Function (service_role) puede invocarla. Se revoca el EXECUTE por
-- defecto a PUBLIC para que `anon`/`authenticated` no puedan ejecutarla
-- directamente vía PostgREST con un p_tenant_id arbitrario.
REVOKE ALL ON FUNCTION public.registrar_eutanasia(
  UUID, UUID, UUID, UUID, DATE, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_eutanasia(
  UUID, UUID, UUID, UUID, DATE, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, TEXT
) TO service_role;
