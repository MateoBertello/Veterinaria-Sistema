-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C4·T4: Vistas de reporte v_items_vendidos y v_margen_venta
-- =====================================================================

CREATE OR REPLACE VIEW public.v_items_vendidos AS
SELECT vi.tenant_id, vi.venta_id, v.numero_operacion, v.created_at AS vendido_at,
       v.estado AS venta_estado, v.usuario_id,
       'producto'::tipo_item_venta AS tipo_item,
       vi.producto_id AS item_id, p.nombre AS item_nombre, p.familia_id,
       vi.cantidad, vi.precio_unitario, vi.neto_unitario, vi.iva_unitario,
       vi.importe_total, vi.costo_unitario_efectivo
FROM ventas_items vi
JOIN ventas v    ON v.id = vi.venta_id  AND v.tenant_id = vi.tenant_id
JOIN productos p ON p.id = vi.producto_id AND p.tenant_id = vi.tenant_id
WHERE vi.tipo_item = 'producto'
UNION ALL
SELECT vi.tenant_id, vi.venta_id, v.numero_operacion, v.created_at,
       v.estado, v.usuario_id,
       'servicio'::tipo_item_venta,
       vi.servicio_id, s.nombre, NULL::uuid,
       vi.cantidad, vi.precio_unitario, vi.neto_unitario, vi.iva_unitario,
       vi.importe_total, NULL::numeric
FROM ventas_items vi
JOIN ventas v     ON v.id = vi.venta_id AND v.tenant_id = vi.tenant_id
JOIN servicios s  ON s.id = vi.servicio_id AND s.tenant_id = vi.tenant_id
WHERE vi.tipo_item = 'servicio';

CREATE OR REPLACE VIEW public.v_margen_venta AS
SELECT iv.tenant_id, iv.venta_id, iv.vendido_at, iv.tipo_item, iv.item_id,
       iv.item_nombre, iv.cantidad, iv.importe_total,
       iv.neto_unitario * iv.cantidad                            AS neto_total,
       COALESCE(iv.costo_unitario_efectivo, 0) * iv.cantidad     AS costo_total,
       (iv.neto_unitario * iv.cantidad)
         - (COALESCE(iv.costo_unitario_efectivo, 0) * iv.cantidad) AS margen
FROM v_items_vendidos iv
WHERE iv.venta_estado = 'registrada';

COMMENT ON VIEW public.v_margen_venta IS
  'Margen por línea, usando el costo efectivo GUARDADO en ventas_items. No recalcula el costo contra productos.costo_reposicion: el margen histórico se valúa con lo que la mercadería costó, no con lo que costaría reponerla hoy (D-04, RN-MV6).';
