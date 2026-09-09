-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C3·T1: Cajas, sesiones de caja y libro mayor de movimientos
-- =====================================================================

-- ─── 1. Tabla cajas ───────────────────────────────────────────────────

CREATE TABLE public.cajas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cajas_id_tenant_key UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX uq_cajas_tenant_nombre ON cajas (tenant_id, lower(nombre));
CREATE INDEX idx_cajas_tenant_activa ON cajas (tenant_id, activa);

-- ─── 2. Tabla sesiones_caja ───────────────────────────────────────────

CREATE TABLE public.sesiones_caja (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caja_id                 UUID NOT NULL,
  estado                  estado_sesion_caja NOT NULL DEFAULT 'abierta',
  apertura_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  apertura_usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  saldo_inicial           NUMERIC(14,2) NOT NULL CHECK (saldo_inicial >= 0),
  cierre_at               TIMESTAMPTZ NULL,
  cierre_usuario_id       UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  saldo_teorico_efectivo  NUMERIC(14,2) NULL,
  efectivo_contado        NUMERIC(14,2) NULL,
  diferencia              NUMERIC(14,2) NULL,
  motivo_diferencia       TEXT NULL,
  observaciones           TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sesiones_caja_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT sesiones_caja_caja_tenant_fkey FOREIGN KEY (caja_id, tenant_id)
    REFERENCES cajas (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT chk_sesion_cierre_completo CHECK (
    (estado = 'abierta' AND cierre_at IS NULL AND saldo_teorico_efectivo IS NULL
                        AND efectivo_contado IS NULL AND diferencia IS NULL)
    OR
    (estado = 'cerrada' AND cierre_at IS NOT NULL AND saldo_teorico_efectivo IS NOT NULL
                        AND efectivo_contado IS NOT NULL AND diferencia IS NOT NULL)
  )
);

-- RN-CJ4: una sola sesión abierta por caja, garantizado en la base por índice parcial
CREATE UNIQUE INDEX uq_sesion_caja_abierta
  ON sesiones_caja (tenant_id, caja_id) WHERE estado = 'abierta';

CREATE INDEX idx_sesiones_caja_tenant ON sesiones_caja (tenant_id, apertura_at DESC);
CREATE INDEX idx_sesiones_caja_caja ON sesiones_caja (tenant_id, caja_id);

-- ─── 3. FK diferida de compras hacia sesiones_caja ─────────────────────

ALTER TABLE compras
  ADD CONSTRAINT compras_sesion_caja_tenant_fkey
  FOREIGN KEY (sesion_caja_id, tenant_id) REFERENCES sesiones_caja (id, tenant_id)
  ON DELETE RESTRICT;

-- ─── 4. Tabla movimientos_caja ─────────────────────────────────────────

CREATE TABLE public.movimientos_caja (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_caja_id  UUID NOT NULL,
  tipo            tipo_movimiento_caja NOT NULL,
  medio_pago_id   UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
  importe         NUMERIC(14,2) NOT NULL CHECK (importe > 0),
  venta_id        UUID NULL, -- sin FK: `ventas` llega en C4·T1
  compra_id       UUID NULL,
  motivo          TEXT NULL,
  usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT movimientos_caja_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT movimientos_caja_sesion_tenant_fkey FOREIGN KEY (sesion_caja_id, tenant_id)
    REFERENCES sesiones_caja (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT movimientos_caja_compra_tenant_fkey FOREIGN KEY (compra_id, tenant_id)
    REFERENCES compras (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX idx_mov_caja_sesion ON movimientos_caja (tenant_id, sesion_caja_id, created_at);
CREATE INDEX idx_mov_caja_compra ON movimientos_caja (tenant_id, compra_id) WHERE compra_id IS NOT NULL;

-- ─── 5. Funciones auxiliares y trigger de inmutabilidad ────────────────

CREATE OR REPLACE FUNCTION public.signo_movimiento_caja(p_tipo tipo_movimiento_caja)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_tipo IN (
    'ingreso_venta',
    'ingreso_cobro_cuenta_corriente',
    'ingreso_manual'
  ) THEN 1 ELSE -1 END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) TO service_role;

CREATE OR REPLACE FUNCTION public.movimientos_caja_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_movimientos_caja_inmutable
  BEFORE UPDATE OR DELETE ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_inmutable();

REVOKE ALL ON FUNCTION public.movimientos_caja_inmutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.movimientos_caja_inmutable() TO service_role;

-- ─── 6. Políticas de RLS (solo SELECT) ─────────────────────────────────

ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cajas_select" ON cajas
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_cash')
  );

ALTER TABLE sesiones_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sesiones_caja_select" ON sesiones_caja
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_cash')
  );

ALTER TABLE movimientos_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movimientos_caja_select" ON movimientos_caja
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('manage_cash')
  );

NOTIFY pgrst, 'reload schema';
