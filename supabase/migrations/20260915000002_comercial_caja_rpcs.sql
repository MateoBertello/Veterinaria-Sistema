-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C3·T2: RPCs de Caja (apertura, movimientos, cierre)
-- =====================================================================

-- ─── 1. abrir_sesion_caja ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.abrir_sesion_caja(
  p_tenant_id UUID,
  p_usuario_id UUID,
  p_caja_id UUID,
  p_saldo_inicial NUMERIC
)
RETURNS TABLE (
  sesion_id UUID,
  caja_id UUID,
  apertura_at TIMESTAMPTZ,
  saldo_inicial NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activa BOOLEAN;
  v_sesion_id UUID;
  v_apertura TIMESTAMPTZ;
  v_user_name TEXT;
  v_user_role TEXT;
BEGIN
  IF p_saldo_inicial IS NULL OR p_saldo_inicial < 0 THEN
    RAISE EXCEPTION 'INVALID_OPENING_BALANCE';
  END IF;

  -- La caja existe, es de este tenant y está activa.
  SELECT activa INTO v_activa FROM cajas
   WHERE id = p_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND';
  END IF;

  IF NOT v_activa THEN
    RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND';
  END IF;

  -- RN-CJ4. NO se chequea "¿hay alguna abierta?" con un SELECT previo: eso deja
  -- una ventana entre la lectura y el INSERT por la que pasan dos aperturas
  -- simultáneas. Se intenta insertar y se deja que el índice parcial único
  -- decida, capturando su unique_violation. La base es el árbitro.
  BEGIN
    INSERT INTO sesiones_caja (tenant_id, caja_id, estado, apertura_usuario_id, saldo_inicial)
    VALUES (p_tenant_id, p_caja_id, 'abierta', p_usuario_id, p_saldo_inicial)
    RETURNING id, sesiones_caja.apertura_at INTO v_sesion_id, v_apertura;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'CASH_SESSION_ALREADY_OPEN';
  END;

  -- Resolver usuario para auditoría
  SELECT u.full_name, COALESCE(r.name, 'unknown')
    INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'CREATE', 'cash_register', v_sesion_id::text,
    jsonb_build_object(
      'caja_id', p_caja_id,
      'saldo_inicial', p_saldo_inicial,
      'apertura_at', v_apertura
    )
  );

  RETURN QUERY SELECT v_sesion_id, p_caja_id, v_apertura, p_saldo_inicial;
END;
$$;

REVOKE ALL ON FUNCTION public.abrir_sesion_caja(UUID, UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abrir_sesion_caja(UUID, UUID, UUID, NUMERIC) TO service_role;

-- ─── 2. registrar_movimiento_caja ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja(
  p_tenant_id UUID,
  p_usuario_id UUID,
  p_sesion_id UUID,
  p_tipo tipo_movimiento_caja,
  p_medio_pago_id UUID,
  p_importe NUMERIC,
  p_motivo TEXT DEFAULT NULL,
  p_referencia TEXT DEFAULT NULL
)
RETURNS TABLE (
  movimiento_id UUID,
  sesion_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado estado_sesion_caja;
  v_mp RECORD;
  v_mov_id UUID;
  v_user_name TEXT;
  v_user_role TEXT;
BEGIN
  -- RN-CJ5: la sesión tiene que estar ABIERTA. El FOR UPDATE evita que se cierre
  -- entre esta lectura y el INSERT.
  SELECT estado INTO v_estado FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND';
  END IF;
  IF v_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CASH_SESSION_CLOSED';
  END IF;

  -- El medio de pago existe y está activo (catálogo global sin tenant_id).
  SELECT activo, requiere_referencia INTO v_mp
    FROM medios_pago WHERE id = p_medio_pago_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED';
  END IF;
  IF NOT v_mp.activo THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED';
  END IF;

  -- RN-CJ9: transferencia y tarjeta piden número de operación; efectivo no.
  IF v_mp.requiere_referencia AND (p_referencia IS NULL OR trim(p_referencia) = '') THEN
    RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED';
  END IF;

  IF p_importe IS NULL OR p_importe <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Los movimientos manuales exigen motivo >= 10 caracteres
  IF p_tipo IN ('ingreso_manual', 'egreso_manual', 'egreso_retiro')
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  INSERT INTO movimientos_caja (
    tenant_id, sesion_caja_id, tipo, medio_pago_id, importe, motivo, usuario_id
  ) VALUES (
    p_tenant_id, p_sesion_id, p_tipo, p_medio_pago_id, p_importe, p_motivo, p_usuario_id
  )
  RETURNING id INTO v_mov_id;

  -- Resolver usuario para auditoría
  SELECT u.full_name, COALESCE(r.name, 'unknown')
    INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'CREATE', 'cash_register', v_mov_id::text,
    jsonb_build_object(
      'sesion_caja_id', p_sesion_id,
      'tipo', p_tipo,
      'medio_pago_id', p_medio_pago_id,
      'importe', p_importe,
      'motivo', p_motivo,
      'referencia', p_referencia
    )
  );

  RETURN QUERY SELECT v_mov_id, p_sesion_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_caja(UUID, UUID, UUID, tipo_movimiento_caja, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja(UUID, UUID, UUID, tipo_movimiento_caja, UUID, NUMERIC, TEXT, TEXT) TO service_role;

-- ─── 3. cerrar_sesion_caja ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cerrar_sesion_caja(
  p_tenant_id UUID,
  p_usuario_id UUID,
  p_sesion_id UUID,
  p_efectivo_contado NUMERIC,
  p_motivo TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS TABLE (
  sesion_id UUID,
  saldo_teorico_efectivo NUMERIC,
  efectivo_contado NUMERIC,
  diferencia NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sesion RECORD;
  v_teorico NUMERIC(14,2);
  v_diferencia NUMERIC(14,2);
  v_tolerancia NUMERIC(14,2);
  v_user_name TEXT;
  v_user_role TEXT;
BEGIN
  SELECT * INTO v_sesion FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND';
  END IF;
  IF v_sesion.estado <> 'abierta' THEN
    RAISE EXCEPTION 'CASH_SESSION_CLOSED';
  END IF;

  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'INVALID_OPENING_BALANCE';
  END IF;

  -- RN-CJ2: SOLO los medios con afecta_arqueo entran al teórico.
  SELECT v_sesion.saldo_inicial
         + COALESCE(sum(mov.importe * signo_movimiento_caja(mov.tipo)), 0)
    INTO v_teorico
    FROM movimientos_caja mov
    JOIN medios_pago mp ON mp.id = mov.medio_pago_id
   WHERE mov.sesion_caja_id = p_sesion_id
     AND mov.tenant_id      = p_tenant_id
     AND mp.afecta_arqueo;

  v_diferencia := p_efectivo_contado - v_teorico;

  -- RN-CJ7: por encima de la tolerancia del tenant, el motivo es obligatorio.
  SELECT tolerancia_diferencia_arqueo INTO v_tolerancia
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  IF abs(v_diferencia) > COALESCE(v_tolerancia, 0)
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- RN-CJ6: la diferencia se guarda SIEMPRE, incluso en cero. RN-CJ8: el teórico se CONGELA.
  UPDATE sesiones_caja
     SET estado = 'cerrada',
         cierre_at = now(),
         cierre_usuario_id = p_usuario_id,
         saldo_teorico_efectivo = v_teorico,
         efectivo_contado = p_efectivo_contado,
         diferencia = v_diferencia,
         motivo_diferencia = p_motivo,
         observaciones = p_observaciones
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id;

  -- Resolver usuario para auditoría
  SELECT u.full_name, COALESCE(r.name, 'unknown')
    INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'UPDATE', 'cash_register', p_sesion_id::text,
    jsonb_build_object(
      'saldo_teorico', v_teorico,
      'contado', p_efectivo_contado,
      'diferencia', v_diferencia
    )
  );

  RETURN QUERY SELECT p_sesion_id, v_teorico, p_efectivo_contado, v_diferencia;
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_sesion_caja(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cerrar_sesion_caja(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
