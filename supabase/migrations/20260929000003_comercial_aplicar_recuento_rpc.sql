-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C5·T3: RPC aplicar_recuento
-- =====================================================================

CREATE OR REPLACE FUNCTION public.aplicar_recuento(
  p_tenant_id         UUID,
  p_usuario_id        UUID,
  p_recuento_id       UUID,
  p_confirmar_desvios BOOLEAN DEFAULT false
)
RETURNS TABLE (
  recuento_id       UUID,
  operacion_id      UUID,
  ajustes_generados INTEGER,
  lotes_movidos     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recuento      recuentos%ROWTYPE;
  v_lotes_movidos JSONB;
  v_operacion     UUID;
  v_ajustes       INTEGER := 0;
  v_det           RECORD;
  v_diferencia    NUMERIC(14,3);
BEGIN
  -- 1. Buscar y bloquear recuento
  SELECT * INTO v_recuento
    FROM recuentos r
   WHERE r.id = p_recuento_id AND r.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUNT_NOT_FOUND';
  END IF;

  -- RN-AJ6: aplicar un recuento es irreversible. Aplicar dos veces falla.
  IF v_recuento.estado = 'aplicado' OR v_recuento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'COUNT_ALREADY_APPLIED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM recuentos_detalle rd
                  WHERE rd.recuento_id = p_recuento_id AND rd.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'COUNT_WITHOUT_DETAIL';
  END IF;

  -- ── BLOQUEO de todos los lotes del recuento, ORDENADO POR lote_id ─────────
  PERFORM 1 FROM existencias_lote el
   WHERE el.tenant_id = p_tenant_id
     AND el.lote_id IN (SELECT rd.lote_id FROM recuentos_detalle rd
                         WHERE rd.recuento_id = p_recuento_id AND rd.tenant_id = p_tenant_id)
   ORDER BY el.lote_id
     FOR UPDATE;

  -- ── RN-AJ3: la cantidad de sistema se congela AL APLICAR ──────────────────
  SELECT jsonb_agg(jsonb_build_object(
           'loteId', d.lote_id,
           'cantidadVistaPorElUsuario', d.cantidad_sistema,
           'cantidadActual', e.cantidad))
    INTO v_lotes_movidos
    FROM recuentos_detalle d
    JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
   WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
     AND d.cantidad_sistema IS NOT NULL
     AND d.cantidad_sistema <> e.cantidad;

  IF v_lotes_movidos IS NOT NULL AND NOT COALESCE(p_confirmar_desvios, false) THEN
    RAISE EXCEPTION 'COUNT_STALE:%', v_lotes_movidos::text;
  END IF;

  v_operacion := gen_random_uuid();

  -- ── Un ajuste por cada lote con diferencia, EN UNA SOLA OPERACIÓN ─────────
  FOR v_det IN SELECT d.id AS detalle_id, d.lote_id, d.cantidad_contada, d.motivo,
                      e.cantidad AS existencia_actual, l.producto_id,
                      l.costo_unitario_efectivo
                 FROM recuentos_detalle d
                 JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
                 JOIN lotes l            ON l.id = d.lote_id      AND l.tenant_id = p_tenant_id
                WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
                ORDER BY d.lote_id
  LOOP
      v_diferencia := v_det.cantidad_contada - v_det.existencia_actual;

      UPDATE recuentos_detalle rd
         SET cantidad_sistema = v_det.existencia_actual,
             diferencia       = v_diferencia
       WHERE rd.id = v_det.detalle_id AND rd.tenant_id = p_tenant_id;

      CONTINUE WHEN v_diferencia = 0;

      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
        costo_unitario, costo_total, motivo, recuento_id, usuario_id
      ) VALUES (
        p_tenant_id, v_operacion,
        CASE WHEN v_diferencia > 0 THEN 'sobrante_recuento'::tipo_movimiento_stock ELSE 'faltante_recuento'::tipo_movimiento_stock END,
        v_det.producto_id, v_det.lote_id, abs(v_diferencia),
        v_det.costo_unitario_efectivo,
        round(abs(v_diferencia) * v_det.costo_unitario_efectivo, 2),
        COALESCE(v_det.motivo, 'Ajuste por recuento físico'),
        p_recuento_id, p_usuario_id
      );
      v_ajustes := v_ajustes + 1;
  END LOOP;

  -- RN-AJ6: irreversible
  UPDATE recuentos r
     SET estado = 'aplicado', aplicado_at = now(), aplicado_por_usuario_id = p_usuario_id
   WHERE r.id = p_recuento_id AND r.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, details
  ) VALUES (
    p_tenant_id, p_usuario_id,
    COALESCE((SELECT full_name FROM usuarios WHERE id = p_usuario_id AND tenant_id = p_tenant_id), 'Usuario'),
    COALESCE((SELECT r.name FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id), 'admin'),
    'UPDATE', 'inventory', p_recuento_id::text,
    jsonb_build_object('ajustes', v_ajustes, 'operacion_id', v_operacion)
  );

  RETURN QUERY SELECT p_recuento_id, v_operacion, v_ajustes, v_lotes_movidos;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_recuento(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_recuento(UUID, UUID, UUID, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
