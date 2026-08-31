-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C4·T1: Tablas de ventas, contadores, pagos y coherencia
-- =====================================================================

-- ─── 1. Extensiones a tablas existentes ────────────────────────────────

-- `servicios` necesita su UNIQUE (id, tenant_id) porque ventas_items.servicio_id
-- es una FK compuesta. El par ya es único por construcción (id es PK).
ALTER TABLE public.servicios
  ADD CONSTRAINT servicios_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE public.servicios
  ADD COLUMN precio       NUMERIC(14,2) NULL,
  ADD COLUMN alicuota_iva NUMERIC(5,2) NOT NULL DEFAULT 21.00
    CHECK (alicuota_iva IN (0, 10.50, 21, 27));

ALTER TABLE public.clientes
  ADD COLUMN condicion_fiscal            condicion_fiscal NOT NULL DEFAULT 'consumidor_final',
  ADD COLUMN cuenta_corriente_habilitada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN limite_credito              NUMERIC(14,2) NULL;

-- ─── 2. Tabla contadores_tenant ────────────────────────────────────────

CREATE TABLE public.contadores_tenant (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  valor      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nombre)
);

-- ─── 3. Tabla ventas ───────────────────────────────────────────────────

CREATE TABLE public.ventas (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero_operacion        BIGINT NOT NULL,
  cliente_id              UUID NULL,
  condicion_fiscal_snapshot condicion_fiscal NULL,
  documento_snapshot      TEXT NULL,
  sesion_caja_id          UUID NOT NULL,
  condicion_pago          condicion_pago_venta NOT NULL DEFAULT 'contado',
  subtotal_neto           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_iva               NUMERIC(14,2) NOT NULL DEFAULT 0,
  descuento_importe       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_pendiente         NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado                  estado_venta NOT NULL DEFAULT 'registrada',
  anulada_at              TIMESTAMPTZ NULL,
  anulada_por_usuario_id  UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  motivo_anulacion        TEXT NULL,
  comprobante_tipo        TEXT NULL,
  comprobante_punto_venta TEXT NULL,
  comprobante_numero      TEXT NULL,
  cae                     TEXT NULL,
  cae_vencimiento         DATE NULL,
  facturacion_estado      estado_facturacion NOT NULL DEFAULT 'no_facturada',
  observaciones           TEXT NULL,
  usuario_id              UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ventas_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT uq_ventas_tenant_numero UNIQUE (tenant_id, numero_operacion),
  CONSTRAINT ventas_cliente_tenant_fkey FOREIGN KEY (cliente_id, tenant_id)
    REFERENCES clientes (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ventas_sesion_caja_tenant_fkey FOREIGN KEY (sesion_caja_id, tenant_id)
    REFERENCES sesiones_caja (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ventas_anulacion_completa CHECK (
    (estado = 'registrada' AND anulada_at IS NULL AND anulada_por_usuario_id IS NULL
                            AND motivo_anulacion IS NULL)
    OR
    (estado = 'anulada' AND anulada_at IS NOT NULL AND anulada_por_usuario_id IS NOT NULL
                         AND motivo_anulacion IS NOT NULL)
  )
);

CREATE INDEX idx_ventas_tenant_fecha   ON ventas (tenant_id, created_at DESC);
CREATE INDEX idx_ventas_tenant_sesion  ON ventas (tenant_id, sesion_caja_id);
CREATE INDEX idx_ventas_tenant_cliente ON ventas (tenant_id, cliente_id);
CREATE INDEX idx_ventas_tenant_usuario ON ventas (tenant_id, usuario_id, created_at DESC);

-- ─── 4. Tabla ventas_items ─────────────────────────────────────────────

CREATE TABLE public.ventas_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id                UUID NOT NULL,
  tipo_item               tipo_item_venta NOT NULL,
  producto_id             UUID NULL,
  servicio_id             UUID NULL,
  descripcion_snapshot    TEXT NOT NULL,
  cantidad                NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario         NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),
  alicuota_iva            NUMERIC(5,2) NOT NULL,
  descuento_porcentaje    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (descuento_porcentaje BETWEEN 0 AND 100),
  neto_unitario           NUMERIC(14,2) NOT NULL,
  iva_unitario            NUMERIC(14,2) NOT NULL,
  importe_total           NUMERIC(14,2) NOT NULL,
  costo_unitario_efectivo NUMERIC(14,4) NULL,
  mascota_id              UUID NULL,
  receta_id               UUID NULL,
  profesional_prescriptor_id UUID NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ventas_items_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT ventas_items_venta_tenant_fkey FOREIGN KEY (venta_id, tenant_id)
    REFERENCES ventas (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ventas_items_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ventas_items_servicio_tenant_fkey FOREIGN KEY (servicio_id, tenant_id)
    REFERENCES servicios (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ventas_items_mascota_tenant_fkey FOREIGN KEY (mascota_id, tenant_id)
    REFERENCES mascotas (id, tenant_id) ON DELETE SET NULL,
  CONSTRAINT chk_ventas_items_tipo CHECK (
    (tipo_item = 'producto' AND producto_id IS NOT NULL AND servicio_id IS NULL)
    OR
    (tipo_item = 'servicio' AND servicio_id IS NOT NULL AND producto_id IS NULL)
  )
);

CREATE INDEX idx_ventas_items_venta ON ventas_items (tenant_id, venta_id);
CREATE INDEX idx_ventas_items_producto ON ventas_items (tenant_id, producto_id);
CREATE INDEX idx_ventas_items_servicio ON ventas_items (tenant_id, servicio_id);

-- ─── 5. Tabla ventas_pagos ─────────────────────────────────────────────

CREATE TABLE public.ventas_pagos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id       UUID NOT NULL,
  medio_pago_id  UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
  importe        NUMERIC(14,2) NOT NULL CHECK (importe > 0),
  referencia     TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ventas_pagos_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT ventas_pagos_venta_tenant_fkey FOREIGN KEY (venta_id, tenant_id)
    REFERENCES ventas (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_ventas_pagos_venta ON ventas_pagos (tenant_id, venta_id);
CREATE INDEX idx_ventas_pagos_medio ON ventas_pagos (tenant_id, medio_pago_id);

-- ─── 6. FKs diferidas de movimientos_stock y movimientos_caja ──────────

ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT movimientos_stock_venta_item_tenant_fkey
  FOREIGN KEY (venta_item_id, tenant_id) REFERENCES ventas_items (id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE public.movimientos_caja
  ADD CONSTRAINT movimientos_caja_venta_tenant_fkey
  FOREIGN KEY (venta_id, tenant_id) REFERENCES ventas (id, tenant_id)
  ON DELETE RESTRICT;

-- ─── 7. Políticas de RLS (solo SELECT) ─────────────────────────────────

ALTER TABLE public.contadores_tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contadores_tenant_select" ON contadores_tenant
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_sales')
  );

ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ventas_select" ON ventas
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_sales')
  );

ALTER TABLE public.ventas_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ventas_items_select" ON ventas_items
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_sales')
  );

ALTER TABLE public.ventas_pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ventas_pagos_select" ON ventas_pagos
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_sales')
  );

NOTIFY pgrst, 'reload schema';
