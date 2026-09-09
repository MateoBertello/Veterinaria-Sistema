-- Migración C7·T3: Vistas para trazabilidad y reporte de consumos clínicos

CREATE OR REPLACE VIEW public.v_consumo_clinico AS
SELECT 
  m.id AS movimiento_id,
  m.tenant_id,
  m.historial_id,
  hc.pet_id AS mascota_id,
  ma.name AS mascota_nombre,
  hc.date AS fecha_evento,
  hc.event_type AS tipo_evento,
  hc.professional_id AS profesional_id,
  m.producto_id,
  p.nombre AS producto_nombre,
  m.lote_id,
  l.codigo_lote,
  l.fecha_vencimiento,
  ABS(m.cantidad) AS cantidad,
  m.costo_total,
  m.created_at AS consumido_at
FROM movimientos_stock m
JOIN productos p ON p.id = m.producto_id AND p.tenant_id = m.tenant_id
JOIN historial_clinico hc ON hc.id = m.historial_id AND hc.tenant_id = m.tenant_id
JOIN mascotas ma ON ma.id = hc.pet_id AND ma.tenant_id = hc.tenant_id
LEFT JOIN lotes l ON l.id = m.lote_id AND l.tenant_id = m.tenant_id
WHERE m.tipo = 'consumo_clinico';

COMMENT ON VIEW public.v_consumo_clinico IS
  'Trazabilidad lote-animal y cálculo de costo efectivo. El costo NO se recalcula contra reposición; preserva el valor original de m.costo_total (RN-MV6).';


CREATE OR REPLACE VIEW public.v_atenciones_sin_consumo AS
SELECT hc.tenant_id, hc.id AS historial_id, hc.pet_id AS mascota_id,
       ma.name AS mascota_nombre, hc.date AS fecha_evento,
       hc.event_type, hc.professional_id
FROM historial_clinico hc
JOIN mascotas ma ON ma.id = hc.pet_id AND ma.tenant_id = hc.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM movimientos_stock m
   WHERE m.tenant_id    = hc.tenant_id
     AND m.historial_id = hc.id
     AND m.tipo         = 'consumo_clinico'
);

COMMENT ON VIEW public.v_atenciones_sin_consumo IS
  'Eventos clínicos sin ningún consumo de insumos asociado. Es la implementación de la decisión provisoria sobre P-04: el acto clínico se registra igual aunque el insumo no esté cargado, y el consumo queda PENDIENTE DE REGULARIZAR — que es exactamente esta ausencia. No toda fila es un pendiente real: una consulta sin insumos aparece acá y está bien. Es una lista para revisar, no una lista de errores.';

