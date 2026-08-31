-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C2·T1: Libro mayor de existencias, lotes y existencias_lote
-- =====================================================================

-- ─── 2.0. UNIQUE (id, tenant_id) en tablas referenciadas ──────────────────────
ALTER TABLE mascotas          ADD CONSTRAINT mascotas_id_tenant_key          UNIQUE (id, tenant_id);
ALTER TABLE historial_clinico ADD CONSTRAINT historial_clinico_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE plan_vacunacion   ADD CONSTRAINT plan_vacunacion_id_tenant_key   UNIQUE (id, tenant_id);

-- ─── 2.1. signo_movimiento() — IMMUTABLE ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_tipo IN (
    'entrada_compra',
    'entrada_ajuste',
    'entrada_devolucion',
    'entrada_conversion',
    'entrada_inicial',
    'sobrante_recuento'
  ) THEN 1 ELSE -1 END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) TO service_role;

-- ─── 2.2. lotes ───────────────────────────────────────────────────────────────
CREATE TABLE public.lotes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id             UUID NOT NULL,
  codigo_lote             TEXT NULL,
  fecha_vencimiento       DATE NULL,
  fecha_ingreso           DATE NOT NULL DEFAULT CURRENT_DATE,
  costo_unitario_neto     NUMERIC(14,4) NOT NULL,
  costo_unitario_efectivo NUMERIC(14,4) NOT NULL,
  lote_padre_id           UUID NULL,
  origen                  origen_lote NOT NULL,
  compra_item_id          UUID NULL, -- FK se agrega en C2·T3 con compras_items
  proveedor_id            UUID NULL,
  estado                  estado_lote NOT NULL DEFAULT 'disponible',
  motivo_bloqueo          TEXT NULL,
  deposito_id             UUID NULL, -- Dimensión reservada P-08
  usuario_id              UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT lotes_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT lotes_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT lotes_padre_tenant_fkey FOREIGN KEY (lote_padre_id, tenant_id)
    REFERENCES lotes(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT lotes_proveedor_tenant_fkey FOREIGN KEY (proveedor_id, tenant_id)
    REFERENCES proveedores(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT chk_lotes_bloqueo_motivo CHECK (estado <> 'bloqueado' OR motivo_bloqueo IS NOT NULL)
);

CREATE INDEX idx_lotes_fefo       ON lotes (tenant_id, producto_id, fecha_vencimiento);
CREATE INDEX idx_lotes_codigo     ON lotes (tenant_id, codigo_lote);
CREATE INDEX idx_lotes_padre      ON lotes (tenant_id, lote_padre_id);
CREATE INDEX idx_lotes_por_vencer ON lotes (tenant_id, fecha_vencimiento) WHERE estado = 'disponible';
CREATE INDEX idx_lotes_proveedor  ON lotes (tenant_id, proveedor_id);

-- ─── 2.3. movimientos_stock — libro mayor append-only ─────────────────────────
CREATE TABLE public.movimientos_stock (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operacion_id                     UUID NOT NULL,
  tipo                             tipo_movimiento_stock NOT NULL,
  producto_id                      UUID NOT NULL,
  lote_id                          UUID NOT NULL,
  cantidad                         NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  cantidad_con_signo               NUMERIC(14,3) GENERATED ALWAYS AS (cantidad * signo_movimiento(tipo)) STORED,
  costo_unitario                   NUMERIC(14,4) NOT NULL DEFAULT 0,
  costo_total                      NUMERIC(14,2) NOT NULL DEFAULT 0,
  motivo                           TEXT NULL,
  fefo_respetado                   BOOLEAN NULL,
  venta_item_id                    UUID NULL, -- FK se agrega en C4·T1 con ventas_items
  compra_item_id                   UUID NULL, -- FK se agrega en C2·T3 con compras_items
  recuento_id                      UUID NULL, -- FK se agrega en C5·T1 con recuentos
  lote_destino_id                  UUID NULL,
  historial_id                     UUID NULL, -- Reservada C7
  plan_vacunacion_id               UUID NULL, -- Reservada C7
  mascota_id                       UUID NULL, -- Reservada C7
  receta_id                        UUID NULL, -- Reservada C7 (sin FK)
  profesional_prescriptor_id       UUID NULL, -- Reservada C7 (sin FK)
  trazabilidad_estado              estado_trazabilidad NOT NULL DEFAULT 'no_aplica',
  trazabilidad_referencia_externa  TEXT NULL,
  deposito_id                      UUID NULL, -- Dimensión reservada P-08
  usuario_id                       UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mov_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT mov_lote_tenant_fkey FOREIGN KEY (lote_id, tenant_id)
    REFERENCES lotes(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT mov_lote_destino_tenant_fkey FOREIGN KEY (lote_destino_id, tenant_id)
    REFERENCES lotes(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT mov_historial_tenant_fkey FOREIGN KEY (historial_id, tenant_id)
    REFERENCES historial_clinico(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT mov_plan_vacunacion_tenant_fkey FOREIGN KEY (plan_vacunacion_id, tenant_id)
    REFERENCES plan_vacunacion(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT mov_mascota_tenant_fkey FOREIGN KEY (mascota_id, tenant_id)
    REFERENCES mascotas(id, tenant_id) ON DELETE RESTRICT,

  CONSTRAINT chk_movimientos_documento_coherente CHECK (
    (CASE WHEN venta_item_id  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN compra_item_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN recuento_id    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN historial_id   IS NOT NULL THEN 1 ELSE 0 END) <= 1
    AND (tipo <> 'salida_venta'    OR venta_item_id  IS NOT NULL)
    AND (tipo <> 'entrada_compra'  OR compra_item_id IS NOT NULL)
    AND (tipo <> 'consumo_clinico' OR historial_id   IS NOT NULL)
    AND (tipo IN ('sobrante_recuento','faltante_recuento') OR recuento_id IS NULL)
  )
);

CREATE INDEX idx_mov_lote      ON movimientos_stock (tenant_id, lote_id, created_at);
CREATE INDEX idx_mov_producto  ON movimientos_stock (tenant_id, producto_id, created_at);
CREATE INDEX idx_mov_operacion ON movimientos_stock (tenant_id, operacion_id);
CREATE INDEX idx_mov_tipo      ON movimientos_stock (tenant_id, tipo, created_at);
CREATE INDEX idx_mov_historial ON movimientos_stock (tenant_id, historial_id) WHERE historial_id IS NOT NULL;

-- Inmutabilidad de movimientos_stock
CREATE OR REPLACE FUNCTION public.movimientos_stock_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_movimientos_stock_inmutable
  BEFORE UPDATE OR DELETE ON movimientos_stock
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_stock_inmutable();

REVOKE ALL ON FUNCTION public.movimientos_stock_inmutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.movimientos_stock_inmutable() TO service_role;

-- ─── 2.4. existencias_lote — caché de existencias por lote ────────────────────
CREATE TABLE public.existencias_lote (
  lote_id        UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL,
  cantidad       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT existencias_lote_tenant_fkey FOREIGN KEY (lote_id, tenant_id)
    REFERENCES lotes(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT existencias_producto_tenant_fkey FOREIGN KEY (producto_id, tenant_id)
    REFERENCES productos(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_existencias_producto ON existencias_lote (tenant_id, producto_id);

-- Trigger de aplicación de movimiento a existencias_lote
CREATE OR REPLACE FUNCTION public.existencias_lote_aplicar_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE existencias_lote
     SET cantidad       = cantidad + NEW.cantidad_con_signo,
         actualizado_at = now()
   WHERE lote_id = NEW.lote_id;

  IF NOT FOUND THEN
    INSERT INTO existencias_lote (lote_id, tenant_id, producto_id, cantidad, actualizado_at)
    VALUES (NEW.lote_id, NEW.tenant_id, NEW.producto_id, NEW.cantidad_con_signo, now());
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_existencias_lote_aplicar
  AFTER INSERT ON movimientos_stock
  FOR EACH ROW EXECUTE FUNCTION public.existencias_lote_aplicar_movimiento();

REVOKE ALL ON FUNCTION public.existencias_lote_aplicar_movimiento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.existencias_lote_aplicar_movimiento() TO service_role;

-- ─── 2.5. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.existencias_lote ENABLE ROW LEVEL SECURITY;

CREATE POLICY lotes_select ON public.lotes
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

CREATE POLICY movimientos_stock_select ON public.movimientos_stock
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

CREATE POLICY existencias_lote_select ON public.existencias_lote
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

NOTIFY pgrst, 'reload schema';
