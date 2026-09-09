-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN: Módulo Comercial — Compras, ítems y configuración
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas de configuración comercial en configuracion_tenant
-- ---------------------------------------------------------------------
ALTER TABLE configuracion_tenant
  ADD COLUMN iva_compras_es_costo               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_alerta_vencimiento            INTEGER NOT NULL DEFAULT 60
    CHECK (dias_alerta_vencimiento BETWEEN 1 AND 365),
  ADD COLUMN tolerancia_rendimiento_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN tolerancia_diferencia_arqueo       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN permitir_venta_sin_existencia      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN exigir_receta_bloqueante           BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 2. Tabla compras
-- ---------------------------------------------------------------------
CREATE TABLE public.compras (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id                  UUID NOT NULL,
  fecha                         DATE NOT NULL,
  comprobante_proveedor_tipo    TEXT NULL,
  comprobante_proveedor_numero  TEXT NULL,
  total_neto                    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_iva                     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                         NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado                        estado_compra NOT NULL DEFAULT 'borrador',
  genera_egreso_caja            BOOLEAN NOT NULL DEFAULT false,
  sesion_caja_id                UUID NULL,
  observaciones                 TEXT NULL,
  usuario_id                    UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compras_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT compras_proveedor_tenant_fkey FOREIGN KEY (proveedor_id, tenant_id)
    REFERENCES proveedores (id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_compras_comprobante
  ON compras (tenant_id, proveedor_id, comprobante_proveedor_numero)
  WHERE comprobante_proveedor_numero IS NOT NULL;

CREATE INDEX idx_compras_tenant_estado ON compras (tenant_id, estado, fecha DESC);
CREATE INDEX idx_compras_proveedor ON compras (tenant_id, proveedor_id);

-- ---------------------------------------------------------------------
-- 3. Tabla compras_items
-- ---------------------------------------------------------------------
CREATE TABLE public.compras_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  compra_id             UUID NOT NULL,
  producto_id           UUID NOT NULL,
  cantidad              NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario_neto   NUMERIC(14,4) NOT NULL CHECK (costo_unitario_neto >= 0),
  alicuota_iva          NUMERIC(5,2) NOT NULL,
  codigo_lote           TEXT NULL,
  fecha_vencimiento     DATE NULL,
  importe_neto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  importe_iva           NUMERIC(14,2) NOT NULL DEFAULT 0,
  importe_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compras_items_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT compras_items_compra_tenant_fkey FOREIGN KEY (compra_id, tenant_id)
    REFERENCES compras (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT compras_items_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_compras_items_compra ON compras_items (tenant_id, compra_id);
CREATE INDEX idx_compras_items_producto ON compras_items (tenant_id, producto_id);

-- ---------------------------------------------------------------------
-- 4. FKs diferidas de lotes y movimientos_stock hacia compras_items
-- ---------------------------------------------------------------------
ALTER TABLE lotes
  ADD CONSTRAINT lotes_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 5. RLS en compras y compras_items
-- ---------------------------------------------------------------------
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compras_select" ON compras
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_suppliers')
  );

ALTER TABLE compras_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compras_items_select" ON compras_items
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_suppliers')
  );
