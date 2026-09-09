-- @modulo: comercial

CREATE OR REPLACE FUNCTION public.registrar_consumo_clinico(
  p_tenant_id                 UUID,
  p_usuario_id                UUID,
  p_historial_id              UUID,
  p_items                     JSONB,
  p_plan_vacunacion_id        UUID DEFAULT NULL,
  p_receta_id                 UUID DEFAULT NULL,
  p_profesional_prescriptor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  operacion_id      UUID,
  movimientos       INTEGER,
  costo_total       NUMERIC,
  advertencias      JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operacion UUID;
  v_advertencias JSONB;
  v_evento RECORD;
  v_config RECORD;
  v_item RECORD;
  v_prod RECORD;
  v_lotes_a_bloquear UUID[] := ARRAY[]::UUID[];
  v_lotes_unicos UUID[] := ARRAY[]::UUID[];
  v_lote_cur RECORD;
  v_cant_restante NUMERIC(14,3);
  v_cant_tomada NUMERIC(14,3);
  v_movs INTEGER := 0;
  v_costo_total NUMERIC := 0;
  v_fefo_respetado BOOLEAN;
  v_user_name TEXT;
  v_user_role TEXT;
  v_lote_forzado_id UUID;
BEGIN
  v_operacion := gen_random_uuid();
  v_advertencias := '[]'::jsonb;

  -- 1. Validaciones SIN bloqueo
  SELECT hc.id, hc.pet_id, hc.professional_id
    INTO v_evento
    FROM historial_clinico hc
   WHERE hc.id = p_historial_id AND hc.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORIAL_NOT_FOUND'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  IF p_plan_vacunacion_id IS NOT NULL THEN
    PERFORM 1 FROM plan_vacunacion pv
     WHERE pv.id = p_plan_vacunacion_id AND pv.tenant_id = p_tenant_id
       AND pv.pet_id = v_evento.pet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VACCINE_PLAN_NOT_FOUND'; END IF;
  END IF;

  SELECT exigir_receta_bloqueante, dias_alerta_vencimiento
    INTO v_config
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  -- 2. Por ítem: validación sin bloqueo
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
                  "productoId" UUID, cantidad NUMERIC, "loteId" UUID, "motivoFefo" TEXT)
  LOOP
    IF v_item.cantidad <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR';
    END IF;

    SELECT activo, es_consumible_clinico, condicion_venta, unidad_medida_id, nombre
      INTO v_prod
      FROM productos WHERE id = v_item."productoId" AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_prod.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;

    IF NOT v_prod.es_consumible_clinico THEN
      v_advertencias := v_advertencias || jsonb_build_object(
        'tipo', 'producto_no_marcado_como_consumible',
        'productoId', v_item."productoId", 'nombre', v_prod.nombre);
    END IF;

    IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id) THEN
      RAISE EXCEPTION 'UNIT_NO_DECIMALS';
    END IF;

    IF v_prod.condicion_venta IN ('bajo_receta','bajo_receta_archivada') THEN
      IF v_config.exigir_receta_bloqueante AND p_receta_id IS NULL THEN
        RAISE EXCEPTION 'PRESCRIPTION_REQUIRED';
      ELSIF p_receta_id IS NULL THEN
        v_advertencias := v_advertencias || jsonb_build_object(
          'tipo', 'producto_bajo_receta_sin_receta',
          'productoId', v_item."productoId", 'nombre', v_prod.nombre);
      END IF;
    END IF;

    -- Recolectar lotes a bloquear
    IF v_item."loteId" IS NOT NULL THEN
      v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, v_item."loteId");
    ELSE
      FOR v_lote_cur IN
        SELECT l.id
          FROM lotes l
          JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = p_tenant_id
         WHERE l.producto_id = v_item."productoId" AND l.tenant_id = p_tenant_id
           AND l.estado = 'disponible'
           AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
           AND e.cantidad > 0
         ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC, l.id ASC
      LOOP
        v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, v_lote_cur.id);
      END LOOP;
    END IF;
  END LOOP;

  -- 3. BLOQUEO FOR UPDATE ordenado por lote_id
  IF array_length(v_lotes_a_bloquear, 1) > 0 THEN
    SELECT ARRAY(
      SELECT DISTINCT unnest(v_lotes_a_bloquear) ORDER BY 1
    ) INTO v_lotes_unicos;

    PERFORM 1 FROM existencias_lote
     WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_unicos)
     ORDER BY lote_id
       FOR UPDATE;
  END IF;

  -- 4. Asignación y descuento
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
                  "productoId" UUID, cantidad NUMERIC, "loteId" UUID, "motivoFefo" TEXT)
  LOOP
    v_cant_restante := v_item.cantidad;

    IF v_item."loteId" IS NOT NULL THEN
      v_lote_forzado_id := v_item."loteId";
      
      SELECT l.id, l.estado, l.fecha_vencimiento, l.costo_unitario_efectivo, e.cantidad AS existencia
        INTO v_lote_cur
        FROM lotes l
        JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = p_tenant_id
       WHERE l.id = v_lote_forzado_id AND l.tenant_id = p_tenant_id;
       
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK';
      END IF;
      IF v_lote_cur.estado = 'bloqueado' OR v_lote_cur.estado = 'dado_de_baja' THEN
        RAISE EXCEPTION 'BATCH_BLOCKED';
      END IF;
      IF v_lote_cur.fecha_vencimiento IS NOT NULL AND v_lote_cur.fecha_vencimiento < CURRENT_DATE THEN
        RAISE EXCEPTION 'BATCH_EXPIRED';
      END IF;
      IF v_lote_cur.existencia < v_item.cantidad THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK';
      END IF;
      
      -- Verificar si era el mejor FEFO
      v_fefo_respetado := true;
      IF v_item."motivoFefo" IS NOT NULL AND length(trim(v_item."motivoFefo")) > 0 THEN
        v_fefo_respetado := false;
      END IF;

      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id,
        cantidad, costo_unitario, costo_total,
        fefo_respetado, motivo, usuario_id,
        historial_id, mascota_id, plan_vacunacion_id,
        receta_id, profesional_prescriptor_id
      ) VALUES (
        p_tenant_id, v_operacion, 'consumo_clinico', v_item."productoId", v_lote_forzado_id,
        v_item.cantidad, v_lote_cur.costo_unitario_efectivo,
        round(v_item.cantidad * v_lote_cur.costo_unitario_efectivo, 4),
        v_fefo_respetado, CASE WHEN NOT v_fefo_respetado THEN v_item."motivoFefo" ELSE NULL END, p_usuario_id,
        p_historial_id, v_evento.pet_id, p_plan_vacunacion_id,
        p_receta_id, p_profesional_prescriptor_id
      );
      
      v_movs := v_movs + 1;
      v_costo_total := v_costo_total + round(v_item.cantidad * v_lote_cur.costo_unitario_efectivo, 4);

    ELSE
      -- FEFO
      FOR v_lote_cur IN
        SELECT l.id, l.costo_unitario_efectivo, e.cantidad AS existencia
          FROM lotes l
          JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = p_tenant_id
         WHERE l.producto_id = v_item."productoId" AND l.tenant_id = p_tenant_id
           AND l.estado = 'disponible'
           AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
           AND e.cantidad > 0
         ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC, l.id ASC
      LOOP
        v_cant_tomada := LEAST(v_cant_restante, v_lote_cur.existencia);

        INSERT INTO movimientos_stock (
          tenant_id, operacion_id, tipo, producto_id, lote_id,
          cantidad, costo_unitario, costo_total,
          fefo_respetado, usuario_id,
          historial_id, mascota_id, plan_vacunacion_id,
          receta_id, profesional_prescriptor_id
        ) VALUES (
          p_tenant_id, v_operacion, 'consumo_clinico', v_item."productoId", v_lote_cur.id,
          v_cant_tomada, v_lote_cur.costo_unitario_efectivo,
          round(v_cant_tomada * v_lote_cur.costo_unitario_efectivo, 4),
          true, p_usuario_id,
          p_historial_id, v_evento.pet_id, p_plan_vacunacion_id,
          p_receta_id, p_profesional_prescriptor_id
        );

        v_movs := v_movs + 1;
        v_costo_total := v_costo_total + round(v_cant_tomada * v_lote_cur.costo_unitario_efectivo, 4);
        v_cant_restante := v_cant_restante - v_cant_tomada;

        IF v_cant_restante = 0 THEN
          EXIT;
        END IF;
      END LOOP;

      IF v_cant_restante > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK';
      END IF;
    END IF;
  END LOOP;

  -- 5. Auditoría
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, COALESCE(v_user_name, 'Desconocido'), COALESCE(v_user_role, 'Sin rol'),
    'CREATE', 'inventory', v_operacion::text,
    jsonb_build_object('historial_id', p_historial_id, 'mascota_id', v_evento.pet_id,
                       'movimientos', v_movs, 'costo_total', v_costo_total));

  RETURN QUERY SELECT v_operacion, v_movs, v_costo_total, v_advertencias;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_consumo_clinico(UUID, UUID, UUID, JSONB, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_clinico(UUID, UUID, UUID, JSONB, UUID, UUID, UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
