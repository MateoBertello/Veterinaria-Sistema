-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C5·T1: Tablas de recuentos físicos y coherencia de libro mayor
-- =====================================================================

-- ─── 1. Tabla recuentos ──────────────────────────────────────────────

CREATE TABLE public.recuentos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
  estado                  estado_recuento NOT NULL DEFAULT 'borrador',
  familia_id              UUID NULL,
  producto_id             UUID NULL,
  usuario_id              UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  aplicado_at             TIMESTAMPTZ NULL,
  aplicado_por_usuario_id UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  observaciones           TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recuentos_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT recuentos_familia_tenant_fkey FOREIGN KEY (familia_id, tenant_id)
    REFERENCES familias_producto (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT recuentos_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT chk_recuento_aplicado_completo CHECK (
    (estado <> 'aplicado' AND aplicado_at IS NULL AND aplicado_por_usuario_id IS NULL)
    OR
    (estado = 'aplicado'  AND aplicado_at IS NOT NULL AND aplicado_por_usuario_id IS NOT NULL)
  )
);

CREATE INDEX idx_recuentos_tenant ON recuentos (tenant_id, estado, fecha DESC);
CREATE UNIQUE INDEX uq_recuento_borrador ON recuentos (tenant_id) WHERE estado = 'borrador';

-- ─── 2. Tabla recuentos_detalle ──────────────────────────────────────

CREATE TABLE public.recuentos_detalle (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recuento_id             UUID NOT NULL,
  lote_id                 UUID NOT NULL,
  cantidad_sistema        NUMERIC(14,3) NULL,
  cantidad_contada        NUMERIC(14,3) NOT NULL CHECK (cantidad_contada >= 0),
  diferencia              NUMERIC(14,3) NULL,
  motivo                  TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recuentos_detalle_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT uq_recuento_lote UNIQUE (recuento_id, lote_id),
  CONSTRAINT recuentos_detalle_recuento_tenant_fkey FOREIGN KEY (recuento_id, tenant_id)
    REFERENCES recuentos (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT recuentos_detalle_lote_tenant_fkey FOREIGN KEY (lote_id, tenant_id)
    REFERENCES lotes (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_recuentos_detalle ON recuentos_detalle (tenant_id, recuento_id);

-- ─── 3. FK diferida en movimientos_stock ─────────────────────────────

ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT movimientos_stock_recuento_tenant_fkey
  FOREIGN KEY (recuento_id, tenant_id) REFERENCES recuentos (id, tenant_id)
  ON DELETE RESTRICT;

-- ─── 4. RLS ──────────────────────────────────────────────────────────

ALTER TABLE public.recuentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_recuentos_lectura ON public.recuentos FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_stock')
  );

ALTER TABLE public.recuentos_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_recuentos_detalle_lectura ON public.recuentos_detalle FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_stock')
  );
