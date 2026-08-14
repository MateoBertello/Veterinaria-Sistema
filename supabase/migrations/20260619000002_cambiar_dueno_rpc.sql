-- =====================================================================
-- MIGRACIÓN 008: Cambiar Dueño de Mascota — transferencia atómica
-- Caso de uso "Cambiar Dueño de Mascota" (v1.0 §1, RN-CD1..CD5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- RPC cambiar_dueno_mascota — transferencia transaccional (RN-CD2)
-- Mueve la mascota a otro cliente e inserta el registro de trazabilidad
-- en cambios_propietario dentro de UNA ÚNICA transacción: si el INSERT
-- de trazabilidad falla, el UPDATE de la mascota se revierte.
--
-- Las validaciones RN-CD1 (cliente distinto) y RN-CD4 (mascota activa y
-- no eliminada) se hacen DENTRO de la transacción para evitar TOCTOU.
--
-- RN-CD3 (preservación clínica) NO requiere acción: historial_clinico
-- guarda snapshots inmutables (client_id_at_time/client_name_at_time) al
-- crear cada evento; cambiar el dueño nunca reescribe la historia.
--
-- SECURITY DEFINER: la Edge Function opera vía service role (bypass RLS);
-- el aislamiento por tenant se garantiza explícitamente con p_tenant_id en
-- cada lectura/escritura de esta función.
--
-- Los errores de negocio se propagan vía RAISE EXCEPTION con el MESSAGE
-- igual al código de ErrorCode; el Service los mapea a DomainError.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_dueno_mascota(
  p_tenant_id      UUID,
  p_pet_id         UUID,
  p_new_client_id  UUID,
  p_recorded_by    UUID,
  p_reason         TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS TABLE (
  pet_id                UUID,
  previous_client_id    UUID,
  previous_client_name  TEXT,
  new_client_id         UUID,
  new_client_name       TEXT,
  change_date           TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pet         mascotas%ROWTYPE;
  v_prev_name   TEXT;
  v_new_name    TEXT;
  v_change_date TIMESTAMPTZ := now();
BEGIN
  -- Mascota del tenant, viva (no eliminada). FOR UPDATE: bloquea la fila
  -- durante la transferencia para serializar cambios concurrentes.
  SELECT * INTO v_pet
  FROM mascotas
  WHERE id = p_pet_id AND tenant_id = p_tenant_id AND deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MASCOTA_NOT_FOUND';
  END IF;

  -- RN-CD4: sólo se transfiere una mascota no fallecida.
  IF v_pet.estado <> 'Activa' THEN
    RAISE EXCEPTION 'PET_DECEASED';
  END IF;

  -- RN-CD1: el nuevo dueño debe ser distinto del actual.
  IF v_pet.client_id = p_new_client_id THEN
    RAISE EXCEPTION 'SAME_OWNER';
  END IF;

  -- El nuevo dueño debe existir, ser del mismo tenant y no estar eliminado.
  SELECT full_name INTO v_new_name
  FROM clientes
  WHERE id = p_new_client_id AND tenant_id = p_tenant_id AND deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Nombre del dueño anterior (para la respuesta y trazabilidad).
  SELECT full_name INTO v_prev_name
  FROM clientes
  WHERE id = v_pet.client_id;

  -- (1) Transferencia.
  UPDATE mascotas
  SET client_id = p_new_client_id
  WHERE id = p_pet_id AND tenant_id = p_tenant_id;

  -- (2) Trazabilidad (RN-CD2).
  INSERT INTO cambios_propietario (
    tenant_id, pet_id, previous_client_id, new_client_id, change_date, reason, notes, recorded_by
  ) VALUES (
    p_tenant_id, p_pet_id, v_pet.client_id, p_new_client_id, v_change_date, p_reason, p_notes, p_recorded_by
  );

  RETURN QUERY SELECT
    p_pet_id, v_pet.client_id, v_prev_name, p_new_client_id, v_new_name, v_change_date;
END;
$$;
