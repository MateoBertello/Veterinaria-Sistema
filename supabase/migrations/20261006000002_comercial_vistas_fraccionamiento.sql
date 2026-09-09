-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C6·T3: Vistas de fraccionamiento y cadena de trazabilidad
-- =====================================================================

-- ─── 1. Vista v_costo_fraccionamiento ───────────────────────────────────────
CREATE OR REPLACE VIEW public.v_costo_fraccionamiento AS
WITH operaciones AS (
  SELECT m.tenant_id, m.operacion_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.producto_id::text END)::uuid AS producto_origen_id,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.producto_id::text END)::uuid AS producto_destino_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.cantidad END)    AS cantidad_origen,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.cantidad END)    AS cantidad_obtenida,
         COALESCE(max(CASE WHEN m.tipo = 'merma_fraccionamiento' THEN m.cantidad END), 0) AS merma,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.costo_total END) AS costo_consumido,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.costo_unitario END) AS costo_unitario_hijo,
         min(m.created_at) AS fraccionado_at
  FROM movimientos_stock m
  WHERE m.tipo IN ('salida_conversion','entrada_conversion','merma_fraccionamiento')
  GROUP BY m.tenant_id, m.operacion_id
)
SELECT o.tenant_id,
       o.operacion_id,
       o.producto_origen_id,
       o.producto_destino_id,
       po.nombre AS producto_origen_nombre,
       pd.nombre AS producto_destino_nombre,
       o.cantidad_origen,
       pc.factor_teorico,
       o.cantidad_origen * pc.factor_teorico AS cantidad_teorica,
       o.cantidad_obtenida,
       o.merma,
       o.costo_consumido,
       o.costo_unitario_hijo,
       CASE WHEN pc.factor_teorico > 0 AND o.cantidad_obtenida > 0
            THEN (o.costo_unitario_hijo
                  - (o.costo_consumido / NULLIF(o.cantidad_origen * pc.factor_teorico, 0)))
                 * o.cantidad_obtenida
       END AS sobrecosto,
       o.fraccionado_at
FROM operaciones o
JOIN productos po ON po.id = o.producto_origen_id  AND po.tenant_id = o.tenant_id
JOIN productos pd ON pd.id = o.producto_destino_id AND pd.tenant_id = o.tenant_id
LEFT JOIN producto_conversiones pc
       ON pc.tenant_id = o.tenant_id
      AND pc.producto_origen_id  = o.producto_origen_id
      AND pc.producto_destino_id = o.producto_destino_id;

-- ─── 2. Vista v_stock_familia_unidad_base ───────────────────────────────────
CREATE OR REPLACE VIEW public.v_stock_familia_unidad_base AS
SELECT f.tenant_id, f.id AS familia_id, f.nombre AS familia_nombre,
       f.unidad_base_id, um.abreviatura AS unidad_base,
       sum(
         e.cantidad * COALESCE(
           (SELECT 1 / NULLIF(pc.factor_teorico, 0)
              FROM producto_conversiones pc
             WHERE pc.tenant_id = e.tenant_id
               AND pc.producto_destino_id = e.producto_id
               AND pc.activo
             LIMIT 1),
           1)
       ) AS cantidad_en_unidad_base
FROM existencias_lote e
JOIN productos p         ON p.id = e.producto_id AND p.tenant_id = e.tenant_id
JOIN familias_producto f ON f.id = p.familia_id  AND f.tenant_id = p.tenant_id
JOIN unidades_medida um  ON um.id = f.unidad_base_id
WHERE e.cantidad > 0
GROUP BY f.tenant_id, f.id, f.nombre, f.unidad_base_id, um.abreviatura;

COMMENT ON VIEW public.v_stock_familia_unidad_base IS
  'SOLO REPORTE. Agrega existencias de una familia en su unidad base usando factor_teorico. CUALQUIER USO DE ESTA VISTA EN UN CAMINO DE ESCRITURA ES UN BUG (RN-FR12): descontar atravesando el factor rompe la trazabilidad de lote y es exactamente el modelo que D-06 descartó. Si falta existencia del derivado, el sistema OFRECE FRACCIONAR; no descuenta de la caja.';

-- ─── 3. RPC cadena_trazabilidad_lote ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cadena_trazabilidad_lote(p_tenant_id UUID, p_lote_id UUID)
RETURNS TABLE (
  lote_id UUID,
  producto_id UUID,
  producto_nombre TEXT,
  codigo_lote TEXT,
  fecha_vencimiento DATE,
  costo_unitario_efectivo NUMERIC,
  nivel INTEGER,
  direccion TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE ancestros AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, a.nivel - 1
    FROM lotes l JOIN ancestros a ON a.lote_padre_id = l.id
    WHERE l.tenant_id = p_tenant_id
  ),
  descendientes AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, d.nivel + 1
    FROM lotes l JOIN descendientes d ON l.lote_padre_id = d.id
    WHERE l.tenant_id = p_tenant_id
  )
  SELECT x.id, x.producto_id, p.nombre, x.codigo_lote, x.fecha_vencimiento,
         x.costo_unitario_efectivo, x.nivel,
         CASE WHEN x.nivel < 0 THEN 'ancestro'
              WHEN x.nivel > 0 THEN 'derivado'
              ELSE 'origen' END
  FROM (SELECT * FROM ancestros UNION SELECT * FROM descendientes) x
  JOIN productos p ON p.id = x.producto_id AND p.tenant_id = p_tenant_id
  ORDER BY x.nivel;
$$;

REVOKE ALL ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
