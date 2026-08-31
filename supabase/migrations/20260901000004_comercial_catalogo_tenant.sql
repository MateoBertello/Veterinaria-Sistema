-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C1·T3b: Catálogo del tenant y proveedores
-- =====================================================================

-- ─── Paso 0: UNIQUE (id, tenant_id) en clientes para FKs compuestas ───────

ALTER TABLE clientes ADD CONSTRAINT clientes_id_tenant_key UNIQUE (id, tenant_id);

-- ─── 1. Tabla familias_producto ───────────────────────────────────────────

CREATE TABLE familias_producto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  unidad_base_id UUID NOT NULL REFERENCES unidades_medida(id) ON DELETE RESTRICT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT familias_producto_id_tenant_key UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX uq_familias_tenant_nombre ON familias_producto (tenant_id, lower(nombre));
CREATE INDEX idx_familias_tenant_activo ON familias_producto (tenant_id, activo);

-- ─── 2. Tabla proveedores ─────────────────────────────────────────────────

CREATE TABLE proveedores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  razon_social     TEXT NOT NULL,
  nombre_fantasia  TEXT NULL,
  cuit             TEXT NULL,
  condicion_fiscal condicion_fiscal NULL,
  telefono         TEXT NULL,
  email            TEXT NULL,
  direccion        TEXT NULL,
  contacto_nombre  TEXT NULL,
  observaciones    TEXT NULL,
  cliente_id       UUID NULL,
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT proveedores_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT proveedores_cliente_tenant_fkey FOREIGN KEY (cliente_id, tenant_id)
    REFERENCES clientes(id, tenant_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_proveedores_tenant_razon ON proveedores (tenant_id, lower(razon_social));
CREATE UNIQUE INDEX uq_proveedores_tenant_cuit ON proveedores (tenant_id, cuit) WHERE cuit IS NOT NULL;
CREATE INDEX idx_proveedores_tenant_activo ON proveedores (tenant_id, activo);

-- ─── 3. Tabla productos ───────────────────────────────────────────────────

CREATE TABLE productos (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo                       TEXT NOT NULL,
  nombre                       TEXT NOT NULL,
  descripcion                  TEXT NULL,
  familia_id                   UUID NULL,
  unidad_medida_id             UUID NOT NULL REFERENCES unidades_medida(id) ON DELETE RESTRICT,
  marca                        TEXT NULL,
  alicuota_iva                 NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  condicion_venta              condicion_venta_producto NOT NULL DEFAULT 'libre',
  controla_lote                BOOLEAN NOT NULL DEFAULT true,
  controla_vencimiento         BOOLEAN NOT NULL DEFAULT true,
  vida_util_post_apertura_dias INTEGER NULL,
  precio_venta                 NUMERIC(14,2) NULL,
  costo_reposicion             NUMERIC(14,4) NULL,
  margen_objetivo              NUMERIC(5,2) NULL,
  stock_minimo                 NUMERIC(14,3) NULL,
  es_vendible                  BOOLEAN NOT NULL DEFAULT true,
  es_consumible_clinico        BOOLEAN NOT NULL DEFAULT false,
  requiere_frio                BOOLEAN NOT NULL DEFAULT false,
  trazable                     BOOLEAN NOT NULL DEFAULT false,
  codigo_barras                TEXT NULL,
  activo                       BOOLEAN NOT NULL DEFAULT true,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT productos_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT productos_familia_tenant_fkey FOREIGN KEY (familia_id, tenant_id)
    REFERENCES familias_producto(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT uq_productos_tenant_codigo UNIQUE (tenant_id, codigo),
  CONSTRAINT chk_productos_alicuota_iva CHECK (alicuota_iva IN (0, 10.50, 21, 27))
);

CREATE UNIQUE INDEX uq_productos_tenant_nombre_activo ON productos (tenant_id, lower(nombre)) WHERE activo;
CREATE UNIQUE INDEX uq_productos_tenant_barras ON productos (tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX idx_productos_tenant_activo ON productos (tenant_id, activo);
CREATE INDEX idx_productos_tenant_nombre ON productos (tenant_id, lower(nombre));
CREATE INDEX idx_productos_tenant_familia ON productos (tenant_id, familia_id);

-- ─── 4. Tabla producto_conversiones ───────────────────────────────────────

CREATE TABLE producto_conversiones (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_origen_id         UUID NOT NULL,
  producto_destino_id        UUID NOT NULL,
  factor_teorico             NUMERIC(14,4) NOT NULL,
  merma_esperada_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 0,
  activo                     BOOLEAN NOT NULL DEFAULT true,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT producto_conversiones_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT producto_conversiones_origen_tenant_fkey FOREIGN KEY (producto_origen_id, tenant_id)
    REFERENCES productos(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT producto_conversiones_destino_tenant_fkey FOREIGN KEY (producto_destino_id, tenant_id)
    REFERENCES productos(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT uq_conversiones_tenant_origen_destino UNIQUE (tenant_id, producto_origen_id, producto_destino_id),
  CONSTRAINT chk_conversiones_factor_positivo CHECK (factor_teorico > 0),
  CONSTRAINT chk_conversiones_no_autoreferencia CHECK (producto_origen_id <> producto_destino_id)
);

CREATE INDEX idx_producto_conversiones_tenant ON producto_conversiones (tenant_id);

-- ─── 5. Trigger anti-ciclo en conversiones (RN-FR2) ───────────────────────

CREATE OR REPLACE FUNCTION public.producto_conversiones_sin_ciclo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE alcanzables AS (
      SELECT pc.producto_destino_id AS nodo
      FROM producto_conversiones pc
      WHERE pc.tenant_id = NEW.tenant_id
        AND pc.producto_origen_id = NEW.producto_destino_id
      UNION
      SELECT pc.producto_destino_id
      FROM producto_conversiones pc
      JOIN alcanzables a ON a.nodo = pc.producto_origen_id
      WHERE pc.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM alcanzables WHERE nodo = NEW.producto_origen_id
  ) THEN
    RAISE EXCEPTION 'CONVERSION_CYCLE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_producto_conversiones_sin_ciclo
  BEFORE INSERT OR UPDATE ON producto_conversiones
  FOR EACH ROW EXECUTE FUNCTION public.producto_conversiones_sin_ciclo();

REVOKE ALL ON FUNCTION public.producto_conversiones_sin_ciclo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.producto_conversiones_sin_ciclo() TO service_role;

-- ─── 6. Función cantidad_valida_para_unidad (RN-PR6) ──────────────────────

CREATE OR REPLACE FUNCTION public.cantidad_valida_para_unidad(
  p_cantidad NUMERIC,
  p_unidad_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN um.admite_decimales THEN
      p_cantidad = round(p_cantidad, um.escala_decimal)
    ELSE
      p_cantidad = trunc(p_cantidad)
  END
  FROM unidades_medida um
  WHERE um.id = p_unidad_id;
$$;

REVOKE ALL ON FUNCTION public.cantidad_valida_para_unidad(NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cantidad_valida_para_unidad(NUMERIC, UUID) TO service_role;

-- ─── 7. RLS en las cuatro tablas del tenant ───────────────────────────────

ALTER TABLE familias_producto ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_familias_producto_lectura ON familias_producto FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_proveedores_lectura ON proveedores FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_suppliers')
  );

ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_productos_lectura ON productos FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

ALTER TABLE producto_conversiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_producto_conversiones_lectura ON producto_conversiones FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );

NOTIFY pgrst, 'reload schema';
