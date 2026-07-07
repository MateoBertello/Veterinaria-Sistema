-- =====================================================================
-- MIGRACIÓN: Vacunación — marcar dosis Aplicada (transacción plan+evento)
-- =====================================================================
-- Etapa 8. Marcar una dosis como Aplicada NO es un simple UPDATE: debe crear
-- el evento clínico 'Vacunación' en historial_clinico Y enlazarlo a la dosis,
-- todo ATÓMICO (o las dos cosas o ninguna), mismo principio que la eutanasia
-- (CLAUDE.md regla 8). El esquema ya lo exige: plan_vacunacion tiene
--   CHECK (estado <> 'Aplicada' OR evento_aplicacion_id IS NOT NULL).
-- Como supabase-js no da transacciones multi-statement, la atomicidad exige
-- este RPC (SECURITY DEFINER), calcado de registrar_eutanasia.
--
-- Guardas (mismo orden de defensa que la eutanasia):
--   • VACCINE_PLAN_NOT_FOUND        — dosis inexistente en el tenant.
--   • VACCINE_PLAN_ALREADY_APPLIED  — RN-PV5: sólo se aplica una dosis Pendiente
--     (cubre Aplicada y Cancelada; una mascota eutanasiada dejó sus pendientes
--     en Cancelada vía RN-PV4, así que NO puede marcarse Aplicada después).
--   • PET_DECEASED                  — defensa para fallecimiento manual (RN-MF),
--     donde las pendientes pueden no haberse cancelado.
--   • FORBIDDEN                     — el profesional firmante no es del tenant.
--
-- El asiento de auditoría (RN-S3) va DENTRO de la transacción: si algo falla,
-- rollbackea junto con el evento y el cambio de estado (no es best-effort).
--
-- Gotcha (ver 20260623000002_registrar_eutanasia_rpc): RETURNS TABLE crea
-- variables de salida homónimas. Se aliasan las tablas (pv) y se califican las
-- columnas en WHERE/SET para evitar "column reference ... is ambiguous" (que se
-- manifiesta como HTTP 500 en el happy path). El RETURN sólo usa variables/params.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.marcar_dosis_aplicada(
  p_tenant_id       UUID,
  p_dosis_id        UUID,
  p_professional_id UUID,
  p_user_id         UUID,
  p_date            DATE,
  p_weight_kg       NUMERIC DEFAULT NULL,
  p_temperature_c   NUMERIC DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  dosis_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dosis       plan_vacunacion%ROWTYPE;
  v_pet         mascotas%ROWTYPE;
  v_prof_name   TEXT;
  v_owner_name  TEXT;
  v_tipo_nombre TEXT;
  v_user_name   TEXT;
  v_user_role   TEXT;
  v_event_id    UUID;
BEGIN
  -- Dosis del tenant. FOR UPDATE: bloquea la fila para serializar contra una
  -- eutanasia concurrente (que cancelaría las pendientes). El que fije el estado
  -- final de la dosis gana; una dosis ya Aplicada no la cancela la eutanasia.
  SELECT * INTO v_dosis
  FROM plan_vacunacion pv
  WHERE pv.id = p_dosis_id AND pv.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VACCINE_PLAN_NOT_FOUND';
  END IF;

  -- RN-PV5: sólo una dosis Pendiente puede marcarse Aplicada.
  IF v_dosis.estado <> 'Pendiente' THEN
    RAISE EXCEPTION 'VACCINE_PLAN_ALREADY_APPLIED';
  END IF;

  -- Mascota del tenant, no eliminada.
  SELECT * INTO v_pet
  FROM mascotas m
  WHERE m.id = v_dosis.pet_id AND m.tenant_id = p_tenant_id AND m.deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  -- Defensa (fallecimiento manual RN-MF): no se aplica una dosis a una mascota
  -- Fallecida. (La eutanasia ya cancela las pendientes vía RN-PV4.)
  IF v_pet.estado = 'Fallecida' THEN
    RAISE EXCEPTION 'PET_DECEASED';
  END IF;

  -- El profesional firmante debe existir y pertenecer al mismo tenant.
  SELECT u.full_name INTO v_prof_name
  FROM usuarios u
  WHERE u.id = p_professional_id AND u.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- RN-EC5: snapshot inmutable del dueño vigente. client_id es NOT NULL (FK);
  -- se toma el nombre aunque el cliente esté en baja lógica (es la historia).
  SELECT c.full_name INTO v_owner_name
  FROM clientes c
  WHERE c.id = v_pet.client_id AND c.tenant_id = p_tenant_id;

  IF v_owner_name IS NULL THEN
    RAISE EXCEPTION 'INTERNAL_ERROR';
  END IF;

  -- Nombre de la vacuna (catálogo global) para componer la descripción del evento.
  SELECT tv.nombre INTO v_tipo_nombre
  FROM tipos_vacuna tv
  WHERE tv.id = v_dosis.tipo_vacuna_id;

  -- Identidad del usuario que EJECUTA la aplicación (para el asiento RN-S3).
  -- No bloquea la operación si no se resuelve: el user_id igual queda registrado.
  SELECT u.full_name, COALESCE(r.display_name, r.name)
  INTO v_user_name, v_user_role
  FROM usuarios u
  LEFT JOIN roles r ON r.id = u.rol_id
  WHERE u.id = p_user_id AND u.tenant_id = p_tenant_id;

  -- (1) Evento clínico 'Vacunación'. description autogenerada del nombre de vacuna.
  INSERT INTO historial_clinico (
    tenant_id, pet_id, professional_id, date, event_type, description,
    weight_kg, temperature_c, notes,
    client_id_at_time, client_name_at_time
  ) VALUES (
    p_tenant_id, v_dosis.pet_id, p_professional_id, p_date, 'Vacunación',
    'Aplicación de vacuna: ' || COALESCE(v_tipo_nombre, 'sin especificar'),
    p_weight_kg, p_temperature_c, p_notes,
    v_pet.client_id, v_owner_name
  )
  RETURNING id INTO v_event_id;

  -- (2) La dosis pasa a Aplicada y queda enlazada al evento (satisface el CHECK
  -- estado <> 'Aplicada' OR evento_aplicacion_id IS NOT NULL). Se aliasa la tabla
  -- (pv) y se califican las columnas para desambiguar de las columnas de salida.
  UPDATE plan_vacunacion AS pv
  SET estado               = 'Aplicada',
      evento_aplicacion_id = v_event_id
  WHERE pv.id = p_dosis_id AND pv.tenant_id = p_tenant_id;

  -- (3) RN-S3: asiento de auditoría ATÓMICO con la operación. La entidad es la
  -- dosis (igual que programar/editar/cancelar); el evento queda en new_values.
  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id,
    old_values, new_values
  ) VALUES (
    p_tenant_id, p_user_id, v_user_name, v_user_role, 'UPDATE', 'medical_records',
    p_dosis_id::text,
    jsonb_build_object('estado', 'Pendiente'),
    jsonb_build_object(
      'estado',               'Aplicada',
      'evento_aplicacion_id', v_event_id,
      'event_type',           'Vacunación',
      'professional_id',      p_professional_id,
      'date',                 p_date
    )
  );

  RETURN QUERY SELECT v_event_id, p_dosis_id;
END;
$$;

-- Endurecimiento: la transacción plan+evento sólo la invoca la Edge Function
-- (service_role); se revoca el EXECUTE por defecto a PUBLIC para que
-- anon/authenticated no la ejecuten directamente vía PostgREST con un
-- p_tenant_id arbitrario.
REVOKE ALL ON FUNCTION public.marcar_dosis_aplicada(
  UUID, UUID, UUID, UUID, DATE, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.marcar_dosis_aplicada(
  UUID, UUID, UUID, UUID, DATE, NUMERIC, NUMERIC, TEXT
) TO service_role;

-- Que PostgREST relea la firma del nuevo RPC (gotcha conocido: sin esto, la
-- primera llamada falla con "could not find function ... in schema cache").
NOTIFY pgrst, 'reload schema';
