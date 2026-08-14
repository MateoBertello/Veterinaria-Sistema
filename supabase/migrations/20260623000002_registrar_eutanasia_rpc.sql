-- =====================================================================
-- MIGRACIÓN: Eutanasia — transacción atómica única (RPC)
-- Caso de uso "Registrar Evento Clínico — Eutanasia" (Addendum v1.1 §HC,
-- RN-EC10..EC12, RN-PV4, RN-S3). Es la ÚNICA operación irreversible del
-- sistema (CLAUDE.md regla 8).
--
-- [Historial consolidado en Etapa 9 — S11 (DT-8): este archivo reúne las
--  migraciones 20260623000002..000005 (RPC original, auditoría atómica,
--  reload de PostgREST y fix de ambigüedad). El detalle de cada iteración
--  está en el historial de git.]
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- RPC registrar_eutanasia — eutanasia transaccional (RN-EC11)
--
-- En UNA ÚNICA transacción (el cuerpo de la función ES la unidad atómica):
--   (1) inserta el evento clínico 'Eutanasia' en historial_clinico,
--   (2) actualiza la mascota a estado='Fallecida' (deceased_date = fecha del
--       evento, deceased_reason = 'Eutanasia'),
--   (3) cancela las dosis 'Pendiente' del plan_vacunacion de esa mascota
--       (RN-PV4),
--   (4) registra el asiento de auditoría (RN-S3) DENTRO de la transacción:
--       si la eutanasia hace rollback, el asiento también; si commitea, el
--       asiento queda garantizado (no best-effort en el Service).
-- Si CUALQUIERA de los pasos lanza, PostgreSQL revierte TODO: la mascota
-- nunca queda "media muerta". Esa atomicidad es la esencia de RN-EC11.
--
-- p_user_id es el usuario AUTENTICADO que ejecuta la operación (caller, del
-- JWT), distinto del profesional firmante (p_professional_id). El asiento de
-- auditoría registra a este usuario; la función resuelve su full_name /
-- display_name desde usuarios+roles (SECURITY DEFINER bypasea RLS) para que
-- el asiento no quede como 'unknown'.
--
-- RN-EC10 (confirmación): el flag se valida en el Service (código
-- EUTHANASIA_CONFIRMATION_REQUIRED); aquí se re-verifica como defensa en
-- profundidad ANTES de cualquier escritura.
--
-- RN-EC12 (irreversibilidad): no existe función inversa; revertir 'Fallecida'
-- es intervención manual de soporte con auditoría.
--
-- No se pisa con "Marcar Fallecida" manual (RN-MF): el guard estado='Activa'
-- (vía FOR UPDATE) rechaza con PET_DECEASED una mascota ya fallecida, venga de
-- donde venga. Ambos flujos son mutuamente excluyentes.
--
-- SECURITY DEFINER: la Edge Function opera vía service_role (bypass RLS); el
-- aislamiento por tenant se garantiza explícitamente con p_tenant_id en cada
-- lectura/escritura. p_tenant_id SIEMPRE proviene del JWT (regla 1).
--
-- Los errores de negocio se propagan vía RAISE EXCEPTION con el MESSAGE igual
-- al código de ErrorCode; el Service los mapea a DomainError.
--
-- Gotcha PL/pgSQL: RETURNS TABLE (..., pet_id UUID, ...) crea variables de
-- salida implícitas visibles en TODO el cuerpo. En el UPDATE de
-- plan_vacunacion se aliasa la tabla (pv) y se califican sus columnas para
-- que `pet_id` no quede ambiguo entre la COLUMNA y la VARIABLE de retorno
-- ("column reference \"pet_id\" is ambiguous" en runtime). El resto del
-- cuerpo no tiene esta colisión (los INSERT usan lista de columnas; el UPDATE
-- de mascotas usa targets de SET, siempre columna; el RETURN/SELECT usan
-- variables v_*/p_* explícitas).
-- ---------------------------------------------------------------------

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
  -- esta misma transacción. Se aliasa la tabla (pv) para desambiguar `pet_id`
  -- respecto de la columna de salida homónima del RETURNS TABLE.
  UPDATE plan_vacunacion AS pv
  SET estado = 'Cancelada'
  WHERE pv.pet_id = p_pet_id AND pv.tenant_id = p_tenant_id AND pv.estado = 'Pendiente';
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

-- Endurecimiento: sólo la Edge Function (service_role) puede invocar la
-- transacción irreversible; se revoca el EXECUTE por defecto a PUBLIC.
REVOKE ALL ON FUNCTION public.registrar_eutanasia(
  UUID, UUID, UUID, UUID, DATE, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_eutanasia(
  UUID, UUID, UUID, UUID, DATE, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, TEXT
) TO service_role;

-- Convención de la casa: toda migración que cree o cambie funciones expuestas
-- por PostgREST (RPC) termina con este NOTIFY. PostgREST cachea el esquema y
-- puede no recargarlo tras un push, dejando la firma vieja en cache
-- ("Could not find the function ... in the schema cache").
NOTIFY pgrst, 'reload schema';
