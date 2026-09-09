-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C6·T1: RPC fraccionar_lote
-- =====================================================================

-- ─── 1. signo_movimiento() — IMMUTABLE (merma_fraccionamiento = 0) ───────────
-- La merma de fraccionamiento se registra sobre el lote hijo para trazabilidad y
-- auditoría en unidades de destino, pero como la entrada_conversion ya ingresa
-- la cantidad realmente obtenida, la merma no reduce la existencia física ni
-- altera la valuación contable (signo 0).
CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_tipo IN (
      'entrada_compra',
      'entrada_ajuste',
      'entrada_devolucion',
      'entrada_conversion',
      'entrada_inicial',
      'sobrante_recuento'
    ) THEN 1
    WHEN p_tipo = 'merma_fraccionamiento' THEN 0
    ELSE -1
  END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) TO service_role;

-- ─── 2. fraccionar_lote() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fraccionar_lote(
  p_tenant_id                 UUID,
  p_usuario_id                UUID,
  p_lote_origen_id            UUID,
  p_producto_destino_id       UUID,
  p_cantidad_origen           NUMERIC,
  p_cantidad_obtenida         NUMERIC,
  p_fecha_vencimiento_destino DATE,
  p_codigo_lote_destino       TEXT,
  p_motivo                    TEXT
)
RETURNS TABLE (
  operacion_id        UUID,
  lote_destino_id     UUID,
  cantidad_teorica    NUMERIC,
  cantidad_obtenida   NUMERIC,
  desvio_porcentaje   NUMERIC,
  costo_unitario_hijo NUMERIC,
  merma_registrada    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operacion         UUID;
  v_lote_hijo         UUID;
  v_conv              RECORD;
  v_lote              RECORD;
  v_destino           RECORD;
  v_existencia        NUMERIC(14,3);
  v_teorico           NUMERIC(14,3);
  v_desvio            NUMERIC(5,2);
  v_tolerancia        NUMERIC(5,2);
  v_vencimiento       DATE;
  v_costo_consumido   NUMERIC(14,4);
  v_costo_hijo        NUMERIC(14,4);
BEGIN
  v_operacion := gen_random_uuid();

  -- ── RN-FR1: solo por conversión DEFINIDA y ACTIVA ────────────────────────
  SELECT * INTO v_conv
    FROM producto_conversiones
   WHERE tenant_id = p_tenant_id
     AND producto_origen_id = (SELECT producto_id FROM lotes WHERE id = p_lote_origen_id AND tenant_id = p_tenant_id)
     AND producto_destino_id = p_producto_destino_id
     AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSION_NOT_DEFINED';
  END IF;

  -- Lote origen
  SELECT l.*, p.unidad_medida_id AS unidad_origen
    INTO v_lote
    FROM lotes l
    JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_origen_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  -- Producto destino
  SELECT * INTO v_destino
    FROM productos
   WHERE id = p_producto_destino_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  IF NOT v_destino.activo THEN
    RAISE EXCEPTION 'PRODUCT_INACTIVE';
  END IF;

  -- ── RN-FR13: decimales validados contra la unidad de CADA producto ────────
  IF NOT cantidad_valida_para_unidad(p_cantidad_origen, v_lote.unidad_origen) THEN
    RAISE EXCEPTION 'UNIT_NO_DECIMALS';
  END IF;
  IF NOT cantidad_valida_para_unidad(p_cantidad_obtenida, v_destino.unidad_medida_id) THEN
    RAISE EXCEPTION 'UNIT_NO_DECIMALS';
  END IF;

  -- ── Bloqueo de existencia del lote origen ────────────────────────────────
  SELECT cantidad INTO v_existencia
    FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_origen_id
     FOR UPDATE;
  IF NOT FOUND OR v_existencia < p_cantidad_origen THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK';
  END IF;

  -- RN-LO4: un lote vencido NO se fracciona
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE THEN
    RAISE EXCEPTION 'BATCH_EXPIRED';
  END IF;
  IF v_lote.estado <> 'disponible' THEN
    RAISE EXCEPTION 'BATCH_BLOCKED';
  END IF;

  -- ── Rendimiento ──────────────────────────────────────────────────────────
  v_teorico := p_cantidad_origen * v_conv.factor_teorico;

  -- RN-FR5: obtener más que el teórico no es rendimiento válido
  IF p_cantidad_obtenida <= 0 OR p_cantidad_obtenida > v_teorico THEN
    RAISE EXCEPTION 'INVALID_YIELD';
  END IF;

  v_desvio := round(((v_teorico - p_cantidad_obtenida) / v_teorico * 100), 2);

  -- ── RN-FR6: desvío sobre tolerancia exige motivo válido ──────────────────
  SELECT tolerancia_rendimiento_porcentaje INTO v_tolerancia
    FROM configuracion_tenant
   WHERE tenant_id = p_tenant_id;

  IF v_desvio > COALESCE(v_tolerancia, 10.00) AND NOT motivo_valido(p_motivo) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- ── RN-FR10 y RN-FR11: vencimiento del hijo ──────────────────────────────
  IF v_lote.fecha_vencimiento IS NOT NULL
     AND p_fecha_vencimiento_destino IS NOT NULL
     AND p_fecha_vencimiento_destino > v_lote.fecha_vencimiento THEN
    RAISE EXCEPTION 'EXPIRY_AFTER_PARENT';
  END IF;

  v_vencimiento := COALESCE(
    p_fecha_vencimiento_destino,
    LEAST(
      v_lote.fecha_vencimiento,
      CURRENT_DATE + COALESCE(v_destino.vida_util_post_apertura_dias, 36500)
    )
  );

  -- ── RN-FR7: COSTO HEREDADO por lo REALMENTE OBTENIDO ─────────────────────
  v_costo_consumido := p_cantidad_origen * v_lote.costo_unitario_efectivo;
  v_costo_hijo      := round(v_costo_consumido / p_cantidad_obtenida, 4);

  -- ── Lote hijo ────────────────────────────────────────────────────────────
  INSERT INTO lotes (
    tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
    costo_unitario_neto, costo_unitario_efectivo,
    lote_padre_id,
    origen, proveedor_id, estado, usuario_id
  ) VALUES (
    p_tenant_id, p_producto_destino_id, p_codigo_lote_destino, v_vencimiento, CURRENT_DATE,
    v_costo_hijo, v_costo_hijo,
    p_lote_origen_id,
    'conversion', v_lote.proveedor_id, 'disponible', p_usuario_id
  )
  RETURNING id INTO v_lote_hijo;

  -- ── Movimientos de stock bajo el mismo operacion_id (RN-FR3) ─────────────
  -- 1. Salida del padre
  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id,
    cantidad, costo_unitario, costo_total,
    lote_destino_id, motivo, usuario_id
  ) VALUES (
    p_tenant_id, v_operacion, 'salida_conversion', v_lote.producto_id, p_lote_origen_id,
    p_cantidad_origen, v_lote.costo_unitario_efectivo, round(v_costo_consumido, 2),
    v_lote_hijo, p_motivo, p_usuario_id
  );

  -- 2. Entrada del hijo
  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id,
    cantidad, costo_unitario, costo_total,
    motivo, usuario_id
  ) VALUES (
    p_tenant_id, v_operacion, 'entrada_conversion', p_producto_destino_id, v_lote_hijo,
    p_cantidad_obtenida, v_costo_hijo,
    round(p_cantidad_obtenida * v_costo_hijo, 2),
    p_motivo, p_usuario_id
  );

  -- 3. Merma de fraccionamiento con costo CERO (RN-FR8)
  IF p_cantidad_obtenida < v_teorico THEN
    INSERT INTO movimientos_stock (
      tenant_id, operacion_id, tipo, producto_id, lote_id,
      cantidad, costo_unitario, costo_total,
      motivo, usuario_id
    ) VALUES (
      p_tenant_id, v_operacion, 'merma_fraccionamiento', p_producto_destino_id, v_lote_hijo,
      v_teorico - p_cantidad_obtenida,
      0, 0,
      p_motivo, p_usuario_id
    );
  END IF;

  -- ── Auditoría transaccional ──────────────────────────────────────────────
  INSERT INTO registros_auditoria (
    tenant_id, user_id, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, 'CREATE', 'inventory', v_operacion::text,
    jsonb_build_object(
      'lote_origen', p_lote_origen_id,
      'lote_destino', v_lote_hijo,
      'cantidad_origen', p_cantidad_origen,
      'cantidad_obtenida', p_cantidad_obtenida,
      'cantidad_teorica', v_teorico,
      'desvio_porcentaje', v_desvio,
      'costo_unitario_hijo', v_costo_hijo
    )
  );

  RETURN QUERY SELECT
    v_operacion,
    v_lote_hijo,
    v_teorico,
    p_cantidad_obtenida,
    v_desvio,
    v_costo_hijo,
    GREATEST(v_teorico - p_cantidad_obtenida, 0::NUMERIC);
END;
$$;

REVOKE ALL ON FUNCTION public.fraccionar_lote(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fraccionar_lote(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
