-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN: Módulo Comercial — RPC anular_compra
-- =====================================================================

CREATE OR REPLACE FUNCTION public.anular_compra(
  p_tenant_id   UUID,
  p_usuario_id  UUID,
  p_compra_id   UUID,
  p_motivo      TEXT
)
RETURNS TABLE (
  compra_id             UUID,
  operacion_id          UUID,
  movimientos_generados INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compra     RECORD;
  v_operacion  UUID;
  v_movs       INTEGER := 0;
  v_user_name  TEXT;
  v_user_role  TEXT;
BEGIN
  -- 1. La compra existe, es de este tenant y está confirmada
  SELECT * INTO v_compra FROM compras c
   WHERE c.id = p_compra_id AND c.tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_NOT_FOUND';
  END IF;

  IF v_compra.estado <> 'confirmada' THEN
    RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED';
  END IF;

  -- 2. Motivo obligatorio (mínimo 10 caracteres)
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- 3. RN-CM3: si CUALQUIER lote de esta compra ya tuvo una salida, la corrección
  -- es un ajuste motivado, no una anulación. Anular con salidas dejaría el
  -- inventario en negativo o borraría una venta real.
  IF EXISTS (
    SELECT 1
    FROM lotes l
    JOIN movimientos_stock m ON m.lote_id = l.id AND m.tenant_id = p_tenant_id
    WHERE l.tenant_id = p_tenant_id
      AND l.compra_item_id IN (
        SELECT ci.id FROM compras_items ci
        WHERE ci.compra_id = p_compra_id AND ci.tenant_id = p_tenant_id
      )
      AND signo_movimiento(m.tipo) = -1
  ) THEN
    RAISE EXCEPTION 'PURCHASE_HAS_EXITS';
  END IF;

  -- 4. RN-MV9: se COMPENSA con contra-asientos. No se borra ni el movimiento
  -- original ni el lote: quedan visibles en el kárdex, con el asiento nuevo al lado.
  -- El contra-asiento es 'salida_ajuste' (sin compra_item_id)
  v_operacion := gen_random_uuid();

  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id,
    cantidad, costo_unitario, costo_total, motivo, usuario_id
  )
  SELECT
    p_tenant_id, v_operacion, 'salida_ajuste', m.producto_id, m.lote_id,
    m.cantidad, m.costo_unitario, m.costo_total, p_motivo, p_usuario_id
  FROM movimientos_stock m
  WHERE m.tenant_id = p_tenant_id
    AND m.tipo = 'entrada_compra'
    AND m.compra_item_id IN (
      SELECT ci.id FROM compras_items ci
      WHERE ci.compra_id = p_compra_id AND ci.tenant_id = p_tenant_id
    );

  GET DIAGNOSTICS v_movs = ROW_COUNT;

  -- 5. Actualizar estado de compra
  UPDATE compras c
     SET estado = 'anulada',
         observaciones = p_motivo,
         updated_at = now()
   WHERE c.id = p_compra_id AND c.tenant_id = p_tenant_id;

  -- 6. Auditoría
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
      'estado', 'anulada',
      'operacion_id', v_operacion,
      'movimientos_generados', v_movs,
      'motivo', p_motivo
    )
  );

  RETURN QUERY SELECT p_compra_id, v_operacion, v_movs;
END;
$$;

REVOKE ALL ON FUNCTION public.anular_compra(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anular_compra(UUID, UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
