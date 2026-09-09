-- =====================================================================
-- MIGRACIÓN: Fix registrar_devolucion para soportar p_items como string y alias de retorno
-- =====================================================================

DROP FUNCTION IF EXISTS public.registrar_devolucion(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, UUID);

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
  operacion_id          UUID,
  devolucion_id         UUID,
  movimientos_generados INTEGER,
  items_devueltos       INTEGER,
  importe_reintegrado   NUMERIC,
  reintegro_total       NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta               ventas%ROWTYPE;
  v_items_array         JSONB;
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

  -- Desempaquetar si viene doblemente serializado como string JSON
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'string' THEN
    v_items_array := (p_items #>> '{}')::jsonb;
  ELSE
    v_items_array := p_items;
  END IF;

  IF v_items_array IS NULL OR jsonb_array_length(v_items_array) = 0 THEN
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
  FOR v_item_json IN SELECT * FROM jsonb_array_elements(v_items_array) LOOP
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
      'items', v_items_array
    )
  );

  RETURN QUERY SELECT
    v_operacion,
    v_operacion,
    v_movs_count,
    v_movs_count,
    v_importe_total_dev,
    v_importe_total_dev;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_devolucion(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
