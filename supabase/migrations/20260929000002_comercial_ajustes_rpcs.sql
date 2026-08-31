-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C5·T2: RPCs ajustar_existencia, bloquear/desbloquear_lote y registrar_devolucion
-- =====================================================================

-- ─── 0. Helper: motivo_valido ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.motivo_valido(p_motivo TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_motivo IS NOT NULL AND length(trim(p_motivo)) >= 10;
$$;

REVOKE ALL ON FUNCTION public.motivo_valido(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.motivo_valido(TEXT) TO service_role;

-- ─── 1. RPC ajustar_existencia ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ajustar_existencia(
  p_tenant_id  UUID,
  p_usuario_id UUID,
  p_lote_id    UUID,
  p_tipo       tipo_movimiento_stock,
  p_cantidad   NUMERIC,
  p_motivo     TEXT
)
RETURNS TABLE (
  movimiento_id        UUID,
  operacion_id         UUID,
  existencia_resultante NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote RECORD;
  v_existencia_actual NUMERIC(14,3);
  v_existencia_nueva  NUMERIC(14,3);
  v_operacion UUID;
  v_mov_id    UUID;
BEGIN
  IF NOT motivo_valido(p_motivo) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  IF p_tipo NOT IN ('entrada_ajuste', 'salida_ajuste', 'merma_vencimiento', 'merma_rotura', 'entrada_inicial') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  SELECT l.*, p.unidad_medida_id, p.activo AS producto_activo
    INTO v_lote
    FROM lotes l
    JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  IF NOT cantidad_valida_para_unidad(p_cantidad, v_lote.unidad_medida_id) THEN
    RAISE EXCEPTION 'UNIT_NO_DECIMALS';
  END IF;

  -- RN-AJ7: la ÚNICA salida posible de un lote vencido es merma_vencimiento
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE
     AND p_tipo <> 'merma_vencimiento' AND signo_movimiento(p_tipo) = -1 THEN
    RAISE EXCEPTION 'BATCH_EXPIRED';
  END IF;

  -- Bloqueo de fila en existencias_lote antes de validar saldo
  SELECT cantidad INTO v_existencia_actual
    FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id
   FOR UPDATE;

  v_existencia_actual := COALESCE(v_existencia_actual, 0);

  IF signo_movimiento(p_tipo) = -1 AND v_existencia_actual < p_cantidad THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK';
  END IF;

  v_operacion := gen_random_uuid();

  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id,
    cantidad, costo_unitario, costo_total, motivo, usuario_id
  ) VALUES (
    p_tenant_id, v_operacion, p_tipo, v_lote.producto_id, p_lote_id,
    p_cantidad, v_lote.costo_unitario_efectivo,
    round(p_cantidad * v_lote.costo_unitario_efectivo, 2),
    p_motivo, p_usuario_id
  ) RETURNING id INTO v_mov_id;

  SELECT cantidad INTO v_existencia_nueva
    FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE id = p_usuario_id AND tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', v_mov_id::text,
    jsonb_build_object(
      'tipo', p_tipo,
      'lote_id', p_lote_id,
      'cantidad', p_cantidad,
      'motivo', p_motivo,
      'operacion_id', v_operacion
    )
  );

  RETURN QUERY SELECT v_mov_id, v_operacion, v_existencia_nueva;
END;
$$;

-- ─── 2. RPCs bloquear_lote y desbloquear_lote ────────────────────────

CREATE OR REPLACE FUNCTION public.bloquear_lote(
  p_tenant_id  UUID,
  p_usuario_id UUID,
  p_lote_id    UUID,
  p_motivo     TEXT
)
RETURNS VOID
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
   WHERE id = p_lote_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  UPDATE lotes
     SET estado = 'bloqueado',
         motivo_bloqueo = p_motivo
   WHERE id = p_lote_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE id = p_usuario_id AND tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', p_lote_id::text,
    jsonb_build_object('accion', 'bloquear_lote', 'motivo', p_motivo)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.desbloquear_lote(
  p_tenant_id  UUID,
  p_usuario_id UUID,
  p_lote_id    UUID,
  p_motivo     TEXT
)
RETURNS VOID
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
   WHERE id = p_lote_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  -- Desbloquear vuelve a disponible y conserva motivo_bloqueo para trazabilidad
  UPDATE lotes
     SET estado = 'disponible'
   WHERE id = p_lote_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE id = p_usuario_id AND tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', p_lote_id::text,
    jsonb_build_object('accion', 'desbloquear_lote', 'motivo', p_motivo)
  );
END;
$$;

-- ─── 3. RPC registrar_devolucion ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_devolucion(
  p_tenant_id          UUID,
  p_usuario_id         UUID,
  p_venta_id           UUID,
  p_items              JSONB,
  p_motivo             TEXT,
  p_reintegra_efectivo BOOLEAN DEFAULT true,
  p_sesion_caja_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  operacion_id         UUID,
  movimientos_generados INTEGER,
  importe_reintegrado  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta               ventas%ROWTYPE;
  v_item_json           JSONB;
  v_item_id             UUID;
  v_item_cant           NUMERIC(14,3);
  v_item_revendible     BOOLEAN;
  v_linea               ventas_items%ROWTYPE;
  v_ya_devuelto         NUMERIC(14,3);
  v_orig_mov            RECORD;
  v_lote_bloqueado      UUID;
  v_operacion           UUID;
  v_movs_count          INTEGER := 0;
  v_importe_linea_dev   NUMERIC(14,2) := 0;
  v_importe_total_dev   NUMERIC(14,2) := 0;
  v_sesion_id           UUID;
  v_medio_pago_efectivo UUID;
  v_estado_sesion       estado_sesion_caja;
BEGIN
  IF NOT motivo_valido(p_motivo) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  -- 1. Buscar y bloquear venta
  SELECT * INTO v_venta
    FROM ventas
   WHERE id = p_venta_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_WITHOUT_SALE';
  END IF;
  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'SALE_ALREADY_VOIDED';
  END IF;

  v_operacion := gen_random_uuid();

  -- 2. Procesar cada item devuelto
  FOR v_item_json IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id         := (v_item_json->>'ventaItemId')::UUID;
    v_item_cant       := (v_item_json->>'cantidad')::NUMERIC;
    v_item_revendible := COALESCE((v_item_json->>'revendible')::BOOLEAN, true);

    IF v_item_cant IS NULL OR v_item_cant <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR';
    END IF;

    SELECT * INTO v_linea
      FROM ventas_items
     WHERE id = v_item_id AND tenant_id = p_tenant_id AND venta_id = p_venta_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RETURN_WITHOUT_SALE';
    END IF;

    -- RN-AJ4: no se devuelve más de lo vendido, acumulando devoluciones previas
    SELECT COALESCE(sum(m.cantidad), 0) INTO v_ya_devuelto
      FROM movimientos_stock m
     WHERE m.tenant_id = p_tenant_id
       AND m.tipo = 'entrada_devolucion'
       AND m.venta_item_id = v_linea.id;

    IF v_ya_devuelto + v_item_cant > v_linea.cantidad THEN
      RAISE EXCEPTION 'RETURN_EXCEEDS_SOLD';
    END IF;

    -- Importe a reintegrar proporcional
    v_importe_linea_dev := round((v_linea.importe_total / v_linea.cantidad) * v_item_cant, 2);
    v_importe_total_dev := v_importe_total_dev + v_importe_linea_dev;

    -- Stock si es producto
    IF v_linea.tipo_item = 'producto' THEN
      SELECT ms.lote_id, ms.producto_id, ms.costo_unitario, l.costo_unitario_efectivo,
             l.codigo_lote, l.fecha_vencimiento
        INTO v_orig_mov
        FROM movimientos_stock ms
        JOIN lotes l ON l.id = ms.lote_id AND l.tenant_id = p_tenant_id
       WHERE ms.venta_item_id = v_linea.id
         AND ms.tenant_id = p_tenant_id
         AND ms.tipo = 'salida_venta'
       LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'RETURN_WITHOUT_SALE';
      END IF;

      IF v_item_revendible THEN
        PERFORM 1 FROM existencias_lote
         WHERE tenant_id = p_tenant_id AND lote_id = v_orig_mov.lote_id
         FOR UPDATE;

        INSERT INTO movimientos_stock (
          tenant_id, operacion_id, tipo, producto_id, lote_id,
          cantidad, costo_unitario, costo_total, venta_item_id,
          motivo, usuario_id
        ) VALUES (
          p_tenant_id, v_operacion, 'entrada_devolucion', v_orig_mov.producto_id,
          v_orig_mov.lote_id, v_item_cant, v_orig_mov.costo_unitario_efectivo,
          round(v_item_cant * v_orig_mov.costo_unitario_efectivo, 2),
          v_linea.id, p_motivo, p_usuario_id
        );
        v_movs_count := v_movs_count + 1;
      ELSE
        -- RN-AJ5: lo no revendible entra a un lote BLOQUEADO
        INSERT INTO lotes (
          tenant_id, producto_id, codigo_lote, fecha_vencimiento,
          costo_unitario_neto, costo_unitario_efectivo,
          estado, motivo_bloqueo, origen, lote_padre_id, usuario_id
        ) VALUES (
          p_tenant_id, v_orig_mov.producto_id,
          COALESCE(v_orig_mov.codigo_lote, 'DEV') || '-BLOQ-' || substr(gen_random_uuid()::text, 1, 6),
          v_orig_mov.fecha_vencimiento,
          v_orig_mov.costo_unitario,
          v_orig_mov.costo_unitario_efectivo,
          'bloqueado', p_motivo, 'devolucion', v_orig_mov.lote_id, p_usuario_id
        ) RETURNING id INTO v_lote_bloqueado;

        INSERT INTO movimientos_stock (
          tenant_id, operacion_id, tipo, producto_id, lote_id,
          cantidad, costo_unitario, costo_total, venta_item_id,
          motivo, usuario_id
        ) VALUES (
          p_tenant_id, v_operacion, 'entrada_devolucion', v_orig_mov.producto_id,
          v_lote_bloqueado, v_item_cant, v_orig_mov.costo_unitario_efectivo,
          round(v_item_cant * v_orig_mov.costo_unitario_efectivo, 2),
          v_linea.id, p_motivo, p_usuario_id
        );
        v_movs_count := v_movs_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- 3. Compensación de caja en la sesión abierta (si corresponde)
  IF COALESCE(p_reintegra_efectivo, true) AND v_importe_total_dev > 0 THEN
    IF p_sesion_caja_id IS NOT NULL THEN
      SELECT id, estado INTO v_sesion_id, v_estado_sesion
        FROM sesiones_caja
       WHERE id = p_sesion_caja_id AND tenant_id = p_tenant_id;
      IF NOT FOUND OR v_estado_sesion <> 'abierta' THEN
        RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
      END IF;
    ELSE
      SELECT id INTO v_sesion_id
        FROM sesiones_caja
       WHERE tenant_id = p_tenant_id AND estado = 'abierta'
       ORDER BY created_at DESC
       LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
      END IF;
    END IF;

    SELECT id INTO v_medio_pago_efectivo
      FROM medios_pago
     WHERE codigo = 'efectivo';

    INSERT INTO movimientos_caja (
      tenant_id, sesion_caja_id, tipo, medio_pago_id,
      importe, venta_id, motivo, usuario_id
    ) VALUES (
      p_tenant_id, v_sesion_id, 'egreso_devolucion', v_medio_pago_efectivo,
      v_importe_total_dev, p_venta_id, p_motivo, p_usuario_id
    );
  END IF;

  -- 4. Auditoría con module = 'sales'
  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE id = p_usuario_id AND tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'sales', p_venta_id::text,
    jsonb_build_object(
      'accion', 'registrar_devolucion',
      'operacion_id', v_operacion,
      'motivo', p_motivo,
      'reintegra_efectivo', p_reintegra_efectivo,
      'importe_reintegrado', v_importe_total_dev,
      'items', p_items
    )
  );

  RETURN QUERY SELECT v_operacion, v_movs_count, v_importe_total_dev;
END;
$$;

-- ─── 4. Privilegios y recarga de schema ───────────────────────────────

REVOKE ALL ON FUNCTION public.motivo_valido(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.motivo_valido(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.ajustar_existencia(UUID, UUID, UUID, tipo_movimiento_stock, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajustar_existencia(UUID, UUID, UUID, tipo_movimiento_stock, NUMERIC, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.bloquear_lote(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_lote(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.desbloquear_lote(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desbloquear_lote(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_devolucion(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
