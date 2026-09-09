-- =====================================================================
-- MIGRACIÓN: Mover numeración de ventas (contadores_tenant) al final del FEFO
-- =====================================================================

-- 1. Permitir que numero_operacion sea asignado al finalizar la asignación de stock
ALTER TABLE public.ventas ALTER COLUMN numero_operacion DROP NOT NULL;
ALTER TABLE public.ventas ALTER COLUMN numero_operacion SET DEFAULT NULL;

-- 2. Redefinir registrar_venta con la numeración posterior al loop de stock
CREATE OR REPLACE FUNCTION public.registrar_venta(
  p_tenant_id      UUID,
  p_usuario_id     UUID,
  p_sesion_caja_id UUID,
  p_cliente_id     UUID,      -- NULL = venta de mostrador anónima
  p_condicion_pago condicion_pago_venta,
  p_items          JSONB,     -- [{tipoItem, productoId, servicioId, cantidad, precioUnitario,
                              --   descuentoPorcentaje, loteId, motivoFefo, mascotaId}]
  p_pagos          JSONB,     -- [{medioPagoId, importe, referencia}]
  p_descuento      NUMERIC DEFAULT 0,
  p_observaciones  TEXT DEFAULT NULL
)
RETURNS TABLE (
  venta_id         UUID,
  numero_operacion BIGINT,
  operacion_id     UUID,
  subtotal_neto    NUMERIC,
  total_iva        NUMERIC,
  total            NUMERIC,
  saldo_pendiente  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operacion_id          UUID;
  v_estado_sesion         estado_sesion_caja;
  v_cond_fiscal           condicion_fiscal;
  v_documento             TEXT;
  
  -- Iteradores y datos temporales
  v_item_json             JSONB;
  v_tipo_item             tipo_item_venta;
  v_prod_id               UUID;
  v_svc_id                UUID;
  v_mascota_id            UUID;
  v_cant                  NUMERIC(14,3);
  v_precio_u              NUMERIC(14,2);
  v_alicuota              NUMERIC(5,2);
  v_desc_pct              NUMERIC(5,2);
  v_neto_u                NUMERIC(14,2);
  v_iva_u                 NUMERIC(14,2);
  v_importe_linea         NUMERIC(14,2);
  v_descr_snap            TEXT;
  
  v_prod                  RECORD;
  v_svc                   RECORD;
  
  -- Arrays para bloqueo y asignaciones
  v_lotes_a_bloquear      UUID[] := ARRAY[]::UUID[];
  v_lotes_unicos          UUID[] := ARRAY[]::UUID[];
  
  -- Para numeración
  v_numero                BIGINT;
  v_venta_id              UUID;
  
  -- Totales
  v_total_venta           NUMERIC(14,2) := 0;
  v_subtotal_neto         NUMERIC(14,2) := 0;
  v_total_iva             NUMERIC(14,2) := 0;
  v_saldo_pend            NUMERIC(14,2) := 0;
  v_suma_pagos            NUMERIC(14,2) := 0;
  
  -- Auditoría
  v_user_name             TEXT;
  v_user_role             TEXT;
  
  -- Variables de loop
  v_item_id               UUID;
  v_lote_cur              RECORD;
  v_cant_restante         NUMERIC(14,3);
  v_cant_tomada           NUMERIC(14,3);
  v_lote_forzado_id       UUID;
  v_motivo_fefo           TEXT;
  v_lote_sugerido         UUID;
  v_fefo_ok               BOOLEAN;
  v_lote_estado           estado_lote;
  v_lote_vencimiento      DATE;
  v_lote_costo            NUMERIC(14,4);
  v_stock_disp            NUMERIC(14,3);
  v_sum_costo_linea       NUMERIC(14,4);
  v_cant_movs_linea       NUMERIC(14,3);
  
  -- Pagos
  v_pago_json             JSONB;
  v_mp_id                 UUID;
  v_pago_imp              NUMERIC(14,2);
  v_pago_ref              TEXT;
  v_mp                    RECORD;
  
  -- Stock mínimo
  v_prods_vendidos        UUID[] := ARRAY[]::UUID[];
  v_pid                   UUID;
  v_stock_actual          NUMERIC(14,3);
  v_p_rec                 RECORD;
BEGIN
  v_operacion_id := gen_random_uuid();

  -- ── 1. Validaciones SIN bloqueo ──────────────────────────────────────────
  -- RN-VT8: toda venta pertenece a una sesión ABIERTA
  SELECT estado INTO v_estado_sesion FROM sesiones_caja
   WHERE id = p_sesion_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
  END IF;
  IF v_estado_sesion <> 'abierta' THEN
    RAISE EXCEPTION 'CASH_SESSION_REQUIRED';
  END IF;

  -- RN-VT7: una venta sin ítems no existe
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'SALE_WITHOUT_ITEMS';
  END IF;

  -- Cliente (si viene)
  IF p_cliente_id IS NOT NULL THEN
    SELECT condicion_fiscal, dni_cuit INTO v_cond_fiscal, v_documento
      FROM clientes
     WHERE id = p_cliente_id AND tenant_id = p_tenant_id AND deleted = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VALIDATION_ERROR';
    END IF;
  END IF;

  -- ── 2. Paso previo: recolectar lotes a bloquear y validar catálogo ───────
  FOR v_item_json IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_tipo_item := (v_item_json->>'tipoItem')::tipo_item_venta;
    v_cant      := (v_item_json->>'cantidad')::NUMERIC;
    v_desc_pct  := COALESCE((v_item_json->>'descuentoPorcentaje')::NUMERIC, 0);

    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR';
    END IF;

    IF v_tipo_item = 'producto' THEN
      v_prod_id := (v_item_json->>'productoId')::UUID;
      IF v_prod_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ITEM_TYPE';
      END IF;

      SELECT activo, es_vendible, precio_venta, alicuota_iva, nombre,
             unidad_medida_id, stock_minimo
        INTO v_prod
        FROM productos
       WHERE id = v_prod_id AND tenant_id = p_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
      END IF;
      IF NOT v_prod.activo THEN
        RAISE EXCEPTION 'PRODUCT_INACTIVE';
      END IF;
      IF NOT v_prod.es_vendible THEN
        RAISE EXCEPTION 'PRODUCT_NOT_SELLABLE';
      END IF;
      IF v_prod.precio_venta IS NULL AND (v_item_json->>'precioUnitario') IS NULL THEN
        RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE';
      END IF;

      -- RN-PR6: escala permitida
      IF NOT cantidad_valida_para_unidad(v_cant, v_prod.unidad_medida_id) THEN
        RAISE EXCEPTION 'UNIT_NO_DECIMALS';
      END IF;

      v_precio_u   := COALESCE((v_item_json->>'precioUnitario')::NUMERIC, v_prod.precio_venta);
      v_alicuota   := v_prod.alicuota_iva;
      v_descr_snap := v_prod.nombre;

      -- Determinar lotes candidatos para este producto
      IF v_item_json->>'loteId' IS NOT NULL AND (v_item_json->>'loteId') <> '' THEN
        v_lote_forzado_id := (v_item_json->>'loteId')::UUID;
        v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, v_lote_forzado_id);
      ELSE
        -- Buscar todos los lotes disponibles con existencia > 0 para este producto
        FOR v_lote_cur IN
          SELECT l.id
            FROM lotes l
            JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = p_tenant_id
           WHERE l.producto_id = v_prod_id AND l.tenant_id = p_tenant_id
             AND l.estado = 'disponible'
             AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
             AND e.cantidad > 0
           ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC, l.id ASC
        LOOP
          v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, v_lote_cur.id);
        END LOOP;
      END IF;

      IF NOT (v_prod_id = ANY(v_prods_vendidos)) THEN
        v_prods_vendidos := array_append(v_prods_vendidos, v_prod_id);
      END IF;

    ELSIF v_tipo_item = 'servicio' THEN
      v_svc_id := (v_item_json->>'servicioId')::UUID;
      IF v_svc_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ITEM_TYPE';
      END IF;

      SELECT activo, precio, alicuota_iva, nombre
        INTO v_svc
        FROM servicios
       WHERE id = v_svc_id AND tenant_id = p_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SERVICE_NOT_FOUND';
      END IF;
      IF NOT v_svc.activo THEN
        RAISE EXCEPTION 'PRODUCT_INACTIVE';
      END IF;
      IF v_svc.precio IS NULL AND (v_item_json->>'precioUnitario') IS NULL THEN
        RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE';
      END IF;

      v_precio_u   := COALESCE((v_item_json->>'precioUnitario')::NUMERIC, v_svc.precio);
      v_alicuota   := v_svc.alicuota_iva;
      v_descr_snap := v_svc.nombre;
    ELSE
      RAISE EXCEPTION 'INVALID_ITEM_TYPE';
    END IF;

    -- RN-VT1: IVA POR DIFERENCIA
    v_neto_u        := round(v_precio_u / (1 + v_alicuota / 100), 2);
    v_iva_u         := v_precio_u - v_neto_u; -- POR DIFERENCIA. SIEMPRE.
    v_importe_linea := round(v_precio_u * v_cant * (1 - v_desc_pct / 100), 2);

    v_total_venta   := v_total_venta + v_importe_linea;
    v_subtotal_neto := v_subtotal_neto + round(v_neto_u * v_cant * (1 - v_desc_pct / 100), 2);
  END LOOP;

  -- RN-VT2: total_iva por diferencia global o suma de líneas
  v_total_iva := v_total_venta - v_subtotal_neto;

  -- ── 3. BLOQUEO FOR UPDATE ordenado por lote_id ───────────────────────────
  IF array_length(v_lotes_a_bloquear, 1) > 0 THEN
    SELECT ARRAY(
      SELECT DISTINCT unnest(v_lotes_a_bloquear) ORDER BY 1
    ) INTO v_lotes_unicos;

    PERFORM 1 FROM existencias_lote
     WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_unicos)
     ORDER BY lote_id
       FOR UPDATE;
  END IF;

  -- ── 4. Validación de pagos ────────────────────────────────────────────────
  v_suma_pagos := 0;
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    FOR v_pago_json IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
      v_pago_imp := (v_pago_json->>'importe')::NUMERIC;
      IF v_pago_imp IS NULL OR v_pago_imp <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR';
      END IF;
      v_suma_pagos := v_suma_pagos + v_pago_imp;
    END LOOP;
  END IF;

  IF p_condicion_pago = 'cuenta_corriente' THEN
    v_saldo_pend := round(v_total_venta - v_suma_pagos, 2);
    IF v_saldo_pend < 0 THEN
      RAISE EXCEPTION 'PAYMENT_MISMATCH';
    END IF;
  ELSE
    v_saldo_pend := 0;
  END IF;

  -- RN-CJ1: SUM(pagos) + saldo_pendiente = total, AL CENTAVO
  IF round(v_suma_pagos + v_saldo_pend, 2) <> round(v_total_venta, 2) THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH';
  END IF;

  IF v_saldo_pend > 0 AND p_condicion_pago = 'contado' THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH';
  END IF;

  -- ── 5. Inserción inicial de la venta (sin numero_operacion para no serializar)
  INSERT INTO ventas (
    tenant_id,
    numero_operacion,
    cliente_id,
    condicion_fiscal_snapshot,
    documento_snapshot,
    sesion_caja_id,
    condicion_pago,
    subtotal_neto,
    total_iva,
    descuento_importe,
    total,
    saldo_pendiente,
    estado,
    observaciones,
    usuario_id,
    created_at
  ) VALUES (
    p_tenant_id,
    NULL,
    p_cliente_id,
    v_cond_fiscal,
    v_documento,
    p_sesion_caja_id,
    p_condicion_pago,
    v_subtotal_neto,
    v_total_iva,
    COALESCE(p_descuento, 0),
    v_total_venta,
    v_saldo_pend,
    'registrada',
    p_observaciones,
    p_usuario_id,
    now()
  )
  RETURNING id INTO v_venta_id;

  -- ── 6. Inserción de ítems, asignación y movimientos de stock (FEFO loop) ──
  FOR v_item_json IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_tipo_item := (v_item_json->>'tipoItem')::tipo_item_venta;
    v_cant      := (v_item_json->>'cantidad')::NUMERIC;
    v_desc_pct  := COALESCE((v_item_json->>'descuentoPorcentaje')::NUMERIC, 0);
    v_mascota_id := CASE WHEN v_item_json->>'mascotaId' IS NOT NULL AND (v_item_json->>'mascotaId') <> ''
                         THEN (v_item_json->>'mascotaId')::UUID ELSE NULL END;

    IF v_tipo_item = 'producto' THEN
      v_prod_id := (v_item_json->>'productoId')::UUID;
      SELECT precio_venta, alicuota_iva, nombre INTO v_prod
        FROM productos WHERE id = v_prod_id AND tenant_id = p_tenant_id;

      v_precio_u   := COALESCE((v_item_json->>'precioUnitario')::NUMERIC, v_prod.precio_venta);
      v_alicuota   := v_prod.alicuota_iva;
      v_descr_snap := v_prod.nombre;
      v_neto_u     := round(v_precio_u / (1 + v_alicuota / 100), 2);
      v_iva_u      := v_precio_u - v_neto_u; -- POR DIFERENCIA
      v_importe_linea := round(v_precio_u * v_cant * (1 - v_desc_pct / 100), 2);

      INSERT INTO ventas_items (
        tenant_id, venta_id, tipo_item, producto_id, servicio_id,
        descripcion_snapshot, cantidad, precio_unitario, alicuota_iva,
        descuento_porcentaje, neto_unitario, iva_unitario, importe_total,
        mascota_id, created_at
      ) VALUES (
        p_tenant_id, v_venta_id, 'producto', v_prod_id, NULL,
        v_descr_snap, v_cant, v_precio_u, v_alicuota,
        v_desc_pct, v_neto_u, v_iva_u, v_importe_linea,
        v_mascota_id, now()
      )
      RETURNING id INTO v_item_id;

      -- Descuento y asignación de stock
      v_cant_restante := v_cant;
      v_sum_costo_linea := 0;
      v_cant_movs_linea := 0;

      IF v_item_json->>'loteId' IS NOT NULL AND (v_item_json->>'loteId') <> '' THEN
        -- Override manual
        v_lote_forzado_id := (v_item_json->>'loteId')::UUID;
        v_motivo_fefo     := v_item_json->>'motivoFefo';

        -- Calcular lote sugerido
        SELECT l.id INTO v_lote_sugerido
          FROM lotes l
          JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = p_tenant_id
         WHERE l.producto_id = v_prod_id AND l.tenant_id = p_tenant_id
           AND l.estado = 'disponible'
           AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
           AND e.cantidad > 0
         ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC, l.id ASC
         LIMIT 1;

        IF v_lote_forzado_id <> v_lote_sugerido OR v_lote_sugerido IS NULL THEN
          IF v_motivo_fefo IS NULL OR length(trim(v_motivo_fefo)) < 10 THEN
            RAISE EXCEPTION 'FEFO_OVERRIDE_WITHOUT_REASON';
          END IF;
          v_fefo_ok := false;
        ELSE
          v_fefo_ok := true;
        END IF;

        -- Validar lote bajo bloqueo
        SELECT l.estado, l.fecha_vencimiento, l.costo_unitario_efectivo, e.cantidad
          INTO v_lote_estado, v_lote_vencimiento, v_lote_costo, v_stock_disp
          FROM existencias_lote e
          JOIN lotes l ON l.id = e.lote_id AND l.tenant_id = p_tenant_id
         WHERE e.lote_id = v_lote_forzado_id AND e.tenant_id = p_tenant_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'INSUFFICIENT_STOCK';
        END IF;
        IF v_lote_estado = 'bloqueado' OR v_lote_estado = 'dado_de_baja' THEN
          RAISE EXCEPTION 'BATCH_BLOCKED';
        END IF;
        IF v_lote_vencimiento IS NOT NULL AND v_lote_vencimiento < CURRENT_DATE THEN
          RAISE EXCEPTION 'BATCH_EXPIRED';
        END IF;
        IF v_stock_disp < v_cant THEN
          RAISE EXCEPTION 'INSUFFICIENT_STOCK';
        END IF;

        INSERT INTO movimientos_stock (
          tenant_id, operacion_id, tipo, producto_id, lote_id,
          cantidad, costo_unitario, costo_total,
          fefo_respetado, motivo, venta_item_id, usuario_id, mascota_id
        ) VALUES (
          p_tenant_id, v_operacion_id, 'salida_venta', v_prod_id, v_lote_forzado_id,
          v_cant, v_lote_costo, round(v_cant * v_lote_costo, 4),
          v_fefo_ok, (CASE WHEN NOT v_fefo_ok THEN v_motivo_fefo ELSE NULL END),
          v_item_id, p_usuario_id, v_mascota_id
        );

        v_sum_costo_linea := round(v_cant * v_lote_costo, 4);
        v_cant_movs_linea := v_cant;

      ELSE
        -- Asignación FEFO automática
        FOR v_lote_cur IN
          SELECT l.id, l.costo_unitario_efectivo, l.estado, l.fecha_vencimiento, e.cantidad AS existencia
            FROM existencias_lote e
            JOIN lotes l ON l.id = e.lote_id AND l.tenant_id = p_tenant_id
           WHERE l.producto_id = v_prod_id AND l.tenant_id = p_tenant_id
             AND l.estado = 'disponible'
             AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
             AND e.cantidad > 0
           ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC, l.id ASC
        LOOP
          v_cant_tomada := LEAST(v_cant_restante, v_lote_cur.existencia);

          INSERT INTO movimientos_stock (
            tenant_id, operacion_id, tipo, producto_id, lote_id,
            cantidad, costo_unitario, costo_total,
            fefo_respetado, venta_item_id, usuario_id, mascota_id
          ) VALUES (
            p_tenant_id, v_operacion_id, 'salida_venta', v_prod_id, v_lote_cur.id,
            v_cant_tomada, v_lote_cur.costo_unitario_efectivo,
            round(v_cant_tomada * v_lote_cur.costo_unitario_efectivo, 4),
            true, v_item_id, p_usuario_id, v_mascota_id
          );

          v_sum_costo_linea := v_sum_costo_linea + round(v_cant_tomada * v_lote_cur.costo_unitario_efectivo, 4);
          v_cant_movs_linea := v_cant_movs_linea + v_cant_tomada;
          v_cant_restante   := v_cant_restante - v_cant_tomada;

          IF v_cant_restante = 0 THEN
            EXIT;
          END IF;
        END LOOP;

        IF v_cant_restante > 0 THEN
          RAISE EXCEPTION 'INSUFFICIENT_STOCK';
        END IF;
      END IF;

      -- Actualizar costo_unitario_efectivo de la línea (promedio ponderado)
      IF v_cant_movs_linea > 0 THEN
        UPDATE ventas_items
           SET costo_unitario_efectivo = round(v_sum_costo_linea / v_cant_movs_linea, 4)
         WHERE id = v_item_id;
      END IF;

    ELSE
      -- Servicio
      v_svc_id := (v_item_json->>'servicioId')::UUID;
      SELECT precio, alicuota_iva, nombre INTO v_svc
        FROM servicios WHERE id = v_svc_id AND tenant_id = p_tenant_id;

      v_precio_u   := COALESCE((v_item_json->>'precioUnitario')::NUMERIC, v_svc.precio);
      v_alicuota   := v_svc.alicuota_iva;
      v_descr_snap := v_svc.nombre;
      v_neto_u     := round(v_precio_u / (1 + v_alicuota / 100), 2);
      v_iva_u      := v_precio_u - v_neto_u;
      v_importe_linea := round(v_precio_u * v_cant * (1 - v_desc_pct / 100), 2);

      INSERT INTO ventas_items (
        tenant_id, venta_id, tipo_item, producto_id, servicio_id,
        descripcion_snapshot, cantidad, precio_unitario, alicuota_iva,
        descuento_porcentaje, neto_unitario, iva_unitario, importe_total,
        mascota_id, created_at
      ) VALUES (
        p_tenant_id, v_venta_id, 'servicio', NULL, v_svc_id,
        v_descr_snap, v_cant, v_precio_u, v_alicuota,
        v_desc_pct, v_neto_u, v_iva_u, v_importe_linea,
        v_mascota_id, now()
      );
    END IF;
  END LOOP;

  -- ── 7. Numeración: contador del tenant bloqueado AL FINAL del loop de stock
  INSERT INTO contadores_tenant (tenant_id, nombre, valor)
  VALUES (p_tenant_id, 'venta', 0)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  UPDATE contadores_tenant
     SET valor = valor + 1
   WHERE tenant_id = p_tenant_id AND nombre = 'venta'
  RETURNING valor INTO v_numero;

  UPDATE ventas
     SET numero_operacion = v_numero
   WHERE id = v_venta_id AND tenant_id = p_tenant_id;

  -- ── 8. Inserción de pagos y movimientos de caja ──────────────────────────
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    FOR v_pago_json IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
      v_mp_id    := (v_pago_json->>'medioPagoId')::UUID;
      v_pago_imp := (v_pago_json->>'importe')::NUMERIC;
      v_pago_ref := v_pago_json->>'referencia';

      SELECT * INTO v_mp FROM medios_pago WHERE id = v_mp_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR';
      END IF;

      -- RN-CJ9: referencia obligatoria según el medio
      IF v_mp.requiere_referencia AND (v_pago_ref IS NULL OR length(trim(v_pago_ref)) = 0) THEN
        RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED';
      END IF;

      INSERT INTO ventas_pagos (
        tenant_id, venta_id, medio_pago_id, importe, referencia, created_at
      ) VALUES (
        p_tenant_id, v_venta_id, v_mp_id, v_pago_imp, v_pago_ref, now()
      );

      INSERT INTO movimientos_caja (
        tenant_id, sesion_caja_id, tipo, medio_pago_id, importe,
        venta_id, usuario_id, created_at
      ) VALUES (
        p_tenant_id, p_sesion_caja_id, 'ingreso_venta', v_mp_id, v_pago_imp,
        v_venta_id, p_usuario_id, now()
      );
    END LOOP;
  END IF;

  -- ── 9. Alerta de stock mínimo por flanco ──────────────────────────────────
  FOREACH v_pid IN ARRAY v_prods_vendidos LOOP
    SELECT nombre, stock_minimo INTO v_p_rec
      FROM productos
     WHERE id = v_pid AND tenant_id = p_tenant_id;

    IF v_p_rec.stock_minimo IS NOT NULL AND v_p_rec.stock_minimo > 0 THEN
      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_actual
        FROM existencias_lote
       WHERE tenant_id = p_tenant_id AND producto_id = v_pid;

      IF v_stock_actual < v_p_rec.stock_minimo THEN
        INSERT INTO notificaciones (
          tenant_id, origen, referencia_id, canal, estado, mensaje
        ) VALUES (
          p_tenant_id,
          'stock_minimo',
          v_pid,
          'email',
          'pendiente',
          'El producto ' || v_p_rec.nombre || ' tiene ' || v_stock_actual || ' unidades (mínimo: ' || v_p_rec.stock_minimo || ').'
        )
        ON CONFLICT (tenant_id, origen, referencia_id, canal) DO NOTHING;
      ELSE
        DELETE FROM notificaciones
         WHERE tenant_id = p_tenant_id
           AND origen = 'stock_minimo'
           AND referencia_id = v_pid;
      END IF;
    END IF;
  END LOOP;

  -- ── 10. Auditoría en la misma transacción ────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, COALESCE(v_user_name, 'Desconocido'), COALESCE(v_user_role, 'Sin rol'),
    'CREATE', 'sales', v_venta_id::text,
    jsonb_build_object(
      'numero_operacion', v_numero,
      'total', v_total_venta,
      'operacion_id', v_operacion_id
    )
  );

  RETURN QUERY SELECT v_venta_id, v_numero, v_operacion_id, v_subtotal_neto, v_total_iva, v_total_venta, v_saldo_pend;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_venta(UUID, UUID, UUID, UUID, condicion_pago_venta, JSONB, JSONB, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_venta(UUID, UUID, UUID, UUID, condicion_pago_venta, JSONB, JSONB, NUMERIC, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
