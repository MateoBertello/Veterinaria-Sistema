-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN: Módulo Comercial — RPC confirmar_compra
-- =====================================================================

CREATE OR REPLACE FUNCTION public.confirmar_compra(
  p_tenant_id   UUID,
  p_usuario_id  UUID,
  p_compra_id   UUID
)
RETURNS TABLE (
  compra_id     UUID,
  operacion_id  UUID,
  lotes_creados INTEGER,
  total         NUMERIC(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operacion      UUID;
  v_compra         RECORD;
  v_prov_activo    BOOLEAN;
  v_iva_es_costo   BOOLEAN;
  v_item           RECORD;
  v_prod           RECORD;
  v_costo_efectivo NUMERIC(14,4);
  v_lote_id        UUID;
  v_lotes          INTEGER := 0;
  v_neto           NUMERIC(14,2);
  v_iva            NUMERIC(14,2);
  v_total          NUMERIC(14,2);
  v_user_name      TEXT;
  v_user_role      TEXT;
BEGIN
  v_operacion := gen_random_uuid();

  -- 1. La compra existe, es de este tenant y está en borrador
  SELECT * INTO v_compra FROM compras c
   WHERE c.id = p_compra_id AND c.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_NOT_FOUND';
  END IF;
  IF v_compra.estado <> 'borrador' THEN
    RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED';
  END IF;

  -- 2. RN-PRV2: el proveedor está activo
  SELECT pr.activo INTO v_prov_activo FROM proveedores pr
   WHERE pr.id = v_compra.proveedor_id AND pr.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND';
  END IF;
  IF NOT v_prov_activo THEN
    RAISE EXCEPTION 'SUPPLIER_INACTIVE';
  END IF;

  -- 3. Al menos un ítem
  IF NOT EXISTS (
    SELECT 1 FROM compras_items ci
     WHERE ci.compra_id = p_compra_id AND ci.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'PURCHASE_WITHOUT_ITEMS';
  END IF;

  -- 4. Composición del costo: se lee UNA vez, fuera del bucle
  SELECT ct.iva_compras_es_costo INTO v_iva_es_costo
    FROM configuracion_tenant ct
   WHERE ct.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    v_iva_es_costo := true;
  END IF;

  -- 5. Un lote y un movimiento por ítem
  FOR v_item IN
    SELECT * FROM compras_items ci
     WHERE ci.compra_id = p_compra_id AND ci.tenant_id = p_tenant_id
     ORDER BY ci.id
  LOOP
    SELECT p.activo, p.controla_lote, p.controla_vencimiento, p.unidad_medida_id
      INTO v_prod
      FROM productos p
     WHERE p.id = v_item.producto_id AND p.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
    END IF;
    IF NOT v_prod.activo THEN
      RAISE EXCEPTION 'PRODUCT_INACTIVE';
    END IF;

    -- RN-PR6: la cantidad respeta los decimales de la unidad del producto
    IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id) THEN
      RAISE EXCEPTION 'UNIT_NO_DECIMALS';
    END IF;

    -- RN-LO2: si el producto controla vencimiento, el lote lo lleva
    IF v_prod.controla_vencimiento AND v_item.fecha_vencimiento IS NULL THEN
      RAISE EXCEPTION 'EXPIRY_REQUIRED';
    END IF;

    -- D-04 + P-05. El costo efectivo se CONGELA acá y no se recalcula nunca.
    v_costo_efectivo := CASE
      WHEN v_iva_es_costo
      THEN round(v_item.costo_unitario_neto * (1 + v_item.alicuota_iva / 100), 4)
      ELSE v_item.costo_unitario_neto
    END;

    -- RN-LO1: dos ingresos del mismo codigo_lote a distinto costo generan DOS lotes.
    -- RN-LO3: con controla_lote = false, codigo_lote y fecha_vencimiento van NULL y se crea lote genérico.
    INSERT INTO lotes (
      tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
      costo_unitario_neto, costo_unitario_efectivo, origen,
      compra_item_id, proveedor_id, estado, usuario_id
    ) VALUES (
      p_tenant_id, v_item.producto_id,
      CASE WHEN v_prod.controla_lote THEN v_item.codigo_lote ELSE NULL END,
      CASE WHEN v_prod.controla_lote THEN v_item.fecha_vencimiento ELSE NULL END,
      v_compra.fecha,
      v_item.costo_unitario_neto, v_costo_efectivo, 'compra',
      v_item.id, v_compra.proveedor_id, 'disponible', p_usuario_id
    )
    RETURNING id INTO v_lote_id;

    INSERT INTO movimientos_stock (
      tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
      costo_unitario, costo_total, compra_item_id, usuario_id
    ) VALUES (
      p_tenant_id, v_operacion, 'entrada_compra', v_item.producto_id, v_lote_id,
      v_item.cantidad, v_costo_efectivo,
      round(v_item.cantidad * v_costo_efectivo, 2),
      v_item.id, p_usuario_id
    );

    -- RN-CM5: la compra actualiza el costo de REPOSICIÓN del producto. NO toca los movimientos anteriores.
    UPDATE productos p
       SET costo_reposicion = v_costo_efectivo, updated_at = now()
     WHERE p.id = v_item.producto_id AND p.tenant_id = p_tenant_id;

    v_lotes := v_lotes + 1;
  END LOOP;

  -- TODO C3: si v_compra.genera_egreso_caja, insertar el egreso en movimientos_caja.
  -- La tabla llega en C3·T1; hasta entonces la compra se confirma sin tocar caja.

  -- 6. Totales y estado
  SELECT sum(ci.importe_neto), sum(ci.importe_iva), sum(ci.importe_total)
    INTO v_neto, v_iva, v_total
    FROM compras_items ci
   WHERE ci.compra_id = p_compra_id AND ci.tenant_id = p_tenant_id;

  UPDATE compras c
     SET estado = 'confirmada',
         total_neto = COALESCE(v_neto, 0),
         total_iva = COALESCE(v_iva, 0),
         total = COALESCE(v_total, 0),
         updated_at = now()
   WHERE c.id = p_compra_id AND c.tenant_id = p_tenant_id;

  -- 7. Auditoría en la MISMA transacción
  SELECT u.full_name, COALESCE(r.display_name, r.name)
    INTO v_user_name, v_user_role
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id AND r.tenant_id = u.tenant_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'UPDATE', 'purchases', p_compra_id::text,
    jsonb_build_object(
      'estado', 'confirmada',
      'operacion_id', v_operacion,
      'lotes_creados', v_lotes,
      'total', COALESCE(v_total, 0)
    )
  );

  RETURN QUERY SELECT p_compra_id, v_operacion, v_lotes, COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_compra(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_compra(UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
