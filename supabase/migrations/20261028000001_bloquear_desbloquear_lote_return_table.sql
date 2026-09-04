-- =====================================================================
-- MIGRACIÓN: Retornar estado actualizado en bloquear_lote y desbloquear_lote
-- =====================================================================

DROP FUNCTION IF EXISTS public.bloquear_lote(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.bloquear_lote(
  p_tenant_id  UUID,
  p_usuario_id UUID,
  p_lote_id    UUID,
  p_motivo     TEXT
)
RETURNS TABLE (
  id             UUID,
  estado         estado_lote,
  motivo_bloqueo TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote lotes%ROWTYPE;
BEGIN
  IF NOT motivo_valido(p_motivo) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_lote
    FROM lotes
   WHERE lotes.id = p_lote_id AND lotes.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  UPDATE lotes
     SET estado = 'bloqueado',
         motivo_bloqueo = p_motivo
   WHERE lotes.id = p_lote_id AND lotes.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE usuarios.id = p_usuario_id AND usuarios.tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', p_lote_id::text,
    jsonb_build_object('accion', 'bloquear_lote', 'motivo', p_motivo)
  );

  RETURN QUERY
  SELECT l.id, l.estado, l.motivo_bloqueo
    FROM lotes l
   WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id;
END;
$$;

DROP FUNCTION IF EXISTS public.desbloquear_lote(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.desbloquear_lote(
  p_tenant_id  UUID,
  p_usuario_id UUID,
  p_lote_id    UUID,
  p_motivo     TEXT
)
RETURNS TABLE (
  id             UUID,
  estado         estado_lote,
  motivo_bloqueo TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote lotes%ROWTYPE;
BEGIN
  IF NOT motivo_valido(p_motivo) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_lote
    FROM lotes
   WHERE lotes.id = p_lote_id AND lotes.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  UPDATE lotes
     SET estado = 'disponible'
   WHERE lotes.id = p_lote_id AND lotes.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE usuarios.id = p_usuario_id AND usuarios.tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', p_lote_id::text,
    jsonb_build_object('accion', 'desbloquear_lote', 'motivo', p_motivo)
  );

  RETURN QUERY
  SELECT l.id, l.estado, l.motivo_bloqueo
    FROM lotes l
   WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_lote(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_lote(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.desbloquear_lote(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desbloquear_lote(UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
