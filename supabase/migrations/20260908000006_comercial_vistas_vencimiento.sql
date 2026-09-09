-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN: Módulo Comercial — Vista v_lotes_por_vencer
-- =====================================================================

CREATE OR REPLACE VIEW public.v_lotes_por_vencer AS
SELECT l.tenant_id,
       l.id                AS lote_id,
       l.producto_id,
       p.nombre            AS producto_nombre,
       l.codigo_lote,
       l.fecha_vencimiento,
       (l.fecha_vencimiento - CURRENT_DATE) AS dias_restantes,
       e.cantidad
FROM lotes l
JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = l.tenant_id
JOIN productos p        ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
WHERE l.estado = 'disponible'
  AND l.fecha_vencimiento IS NOT NULL
  AND e.cantidad > 0;

COMMENT ON VIEW public.v_lotes_por_vencer IS
  'Lotes disponibles con existencia y fecha de vencimiento. El umbral de "por vencer" lo pone quien consulta, contra configuracion_tenant.dias_alerta_vencimiento: la vista no lo fija para que un cambio de configuración tenga efecto inmediato sin recrear la vista.';
