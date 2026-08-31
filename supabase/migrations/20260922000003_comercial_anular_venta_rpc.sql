-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C4·T3: RPC anular_venta
-- =====================================================================

CREATE OR REPLACE FUNCTION public.anular_venta(
  p_tenant_id      UUID,
  p_usuario_id     UUID,
  p_venta_id       UUID,
  p_sesion_caja_id UUID,      -- Sesión ABIERTA actual donde imputar la devolución (RN-VT5)
  p_motivo         TEXT
)
RETURNS TABLE (
  venta_id     UUID,
  operacion_id UUID,
  estado       estado_venta,
  anulada_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operacion_id      UUID;
  v_estado_sesion     estado_sesion_caja;
  v_venta             RECORD;
  v_ahora             TIMESTAMPTZ;
  
  -- Iteradores
  v_mov               RECORD;
  v_pago              RECORD;
  v_pid               UUID;
  v_p_rec             RECORD;
  v_stock_actual      NUMERIC(14,3);
  
  -- Arrays para bloqueo
  v_lotes_a_bloquear  UUID[] := ARRAY[]::UUID[];
  v_lotes_unicos      UUID[] := ARRAY[]::UUID[];
  v_prods_restaurados UUID[] := ARRAY[]::UUID[];
  
  -- Auditoría
  v_user_name         TEXT;
  v_user_role         TEXT;
BEGIN
  v_operacion_id := gen_random_uuid();
  v_ahora := now();

  -- ── 1. Validaciones previas ───────────────────────────────────────────────
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'ANULATION_REASON_REQUIRED';
  END IF;

  -- RN-VT8 / RN-VT5: la sesión de devolución debe estar ABIERTA
  SELECT s.estado INTO v_estado_sesion FROM sesiones_caja s
   WHERE s.id = p_sesion_caja_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
  END IF;
  IF v_estado_sesion <> 'abierta' THEN
    RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
  END IF;

  -- Venta existe y no está anulada
  SELECT * INTO v_venta FROM ventas v
   WHERE v.id = p_venta_id AND v.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND';
  END IF;
  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'SALE_ALREADY_ANNULLED';
  END IF;

  -- ── 2. Identificar y bloquear lotes a restaurar ────────────────────────────
  FOR v_mov IN
    SELECT ms.lote_id, ms.producto_id
      FROM movimientos_stock ms
      JOIN ventas_items vi ON vi.id = ms.venta_item_id AND vi.tenant_id = p_tenant_id
     WHERE vi.venta_id = p_venta_id
       AND ms.tenant_id = p_tenant_id
       AND ms.tipo = 'salida_venta'
  LOOP
    v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, v_mov.lote_id);
    IF NOT (v_mov.producto_id = ANY(v_prods_restaurados)) THEN
      v_prods_restaurados := array_append(v_prods_restaurados, v_mov.producto_id);
    END IF;
  END LOOP;

  IF array_length(v_lotes_a_bloquear, 1) > 0 THEN
    SELECT ARRAY(
      SELECT DISTINCT unnest(v_lotes_a_bloquear) ORDER BY 1
    ) INTO v_lotes_unicos;

    PERFORM 1 FROM existencias_lote
     WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_unicos)
     ORDER BY lote_id
       FOR UPDATE;
  END IF;

  -- ── 3. Compensación de Stock (RN-MV9 / RN-VT4) ───────────────────────────
  -- No borramos movimientos: insertamos entrada_devolucion por cada salida_venta
  FOR v_mov IN
    SELECT ms.*
      FROM movimientos_stock ms
      JOIN ventas_items vi ON vi.id = ms.venta_item_id AND vi.tenant_id = p_tenant_id
     WHERE vi.venta_id = p_venta_id
       AND ms.tenant_id = p_tenant_id
       AND ms.tipo = 'salida_venta'
  LOOP
    INSERT INTO movimientos_stock (
      tenant_id,
      operacion_id,
      tipo,
      producto_id,
      lote_id,
      cantidad,
      costo_unitario,
      costo_total,
      venta_item_id,
      motivo,
      usuario_id,
      mascota_id,
      created_at
    ) VALUES (
      p_tenant_id,
      v_operacion_id,
      'entrada_devolucion',
      v_mov.producto_id,
      v_mov.lote_id,
      v_mov.cantidad,
      v_mov.costo_unitario,
      v_mov.costo_total,
      v_mov.venta_item_id,
      p_motivo,
      p_usuario_id,
      v_mov.mascota_id,
      v_ahora
    );
  END LOOP;

  -- ── 4. Compensación de Caja (RN-VT4 / RN-VT5) ─────────────────────────────
  -- El egreso va a la sesión abierta actual pasada en p_sesion_caja_id
  FOR v_pago IN
    SELECT * FROM ventas_pagos vp
     WHERE vp.venta_id = p_venta_id AND vp.tenant_id = p_tenant_id
  LOOP
    INSERT INTO movimientos_caja (
      tenant_id,
      sesion_caja_id,
      tipo,
      medio_pago_id,
      importe,
      venta_id,
      motivo,
      usuario_id,
      created_at
    ) VALUES (
      p_tenant_id,
      p_sesion_caja_id,
      'egreso_devolucion',
      v_pago.medio_pago_id,
      v_pago.importe,
      p_venta_id,
      p_motivo,
      p_usuario_id,
      v_ahora
    );
  END LOOP;

  -- ── 5. Actualización de estado en ventas ──────────────────────────────────
  UPDATE ventas
     SET estado = 'anulada',
         anulada_at = v_ahora,
         motivo_anulacion = p_motivo,
         anulada_por_usuario_id = p_usuario_id
   WHERE id = p_venta_id AND tenant_id = p_tenant_id;

  -- ── 6. Limpieza de alertas de stock mínimo por flanco ─────────────────────
  FOREACH v_pid IN ARRAY v_prods_restaurados LOOP
    SELECT nombre, stock_minimo INTO v_p_rec
      FROM productos
     WHERE id = v_pid AND tenant_id = p_tenant_id;

    IF v_p_rec.stock_minimo IS NOT NULL AND v_p_rec.stock_minimo > 0 THEN
      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_actual
        FROM existencias_lote
       WHERE tenant_id = p_tenant_id AND producto_id = v_pid;

      IF v_stock_actual >= v_p_rec.stock_minimo THEN
        DELETE FROM notificaciones
         WHERE tenant_id = p_tenant_id
           AND origen = 'stock_minimo'
           AND referencia_id = v_pid;
      END IF;
    END IF;
  END LOOP;

  -- ── 7. Auditoría en la misma transacción ────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values, old_values
  ) VALUES (
    p_tenant_id, p_usuario_id, COALESCE(v_user_name, 'Desconocido'), COALESCE(v_user_role, 'Sin rol'),
    'CANCEL', 'sales', p_venta_id::text,
    jsonb_build_object(
      'estado', 'anulada',
      'anulada_at', v_ahora,
      'motivo_anulacion', p_motivo,
      'operacion_id', v_operacion_id,
      'sesion_caja_egreso_id', p_sesion_caja_id
    ),
    jsonb_build_object(
      'estado', 'registrada',
      'numero_operacion', v_venta.numero_operacion,
      'total', v_venta.total
    )
  );

  RETURN QUERY SELECT p_venta_id, v_operacion_id, 'anulada'::estado_venta, v_ahora;
END;
$$;

REVOKE ALL ON FUNCTION public.anular_venta(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anular_venta(UUID, UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
