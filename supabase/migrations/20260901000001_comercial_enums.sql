-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN C1·T1: ENUMs del Módulo Comercial
-- =====================================================================

-- ─── 1. Tipos nuevos del módulo (15 CREATE TYPE) ─────────────────────────

CREATE TYPE tipo_movimiento_stock AS ENUM (
  'entrada_compra', 'entrada_ajuste', 'entrada_devolucion', 'entrada_conversion',
  'entrada_inicial', 'sobrante_recuento',
  'salida_venta', 'salida_ajuste', 'salida_conversion', 'salida_devolucion_proveedor',
  'consumo_clinico', 'merma_fraccionamiento', 'merma_vencimiento', 'merma_rotura',
  'faltante_recuento'
);

CREATE TYPE estado_lote            AS ENUM ('disponible','bloqueado','dado_de_baja');
CREATE TYPE origen_lote            AS ENUM ('compra','conversion','ajuste','devolucion','inicial');
CREATE TYPE condicion_fiscal       AS ENUM ('consumidor_final','monotributista',
                                            'responsable_inscripto','exento',
                                            'no_alcanzado','sin_datos');
CREATE TYPE condicion_venta_producto AS ENUM ('libre','bajo_receta',
                                              'bajo_receta_archivada','uso_profesional');
CREATE TYPE tipo_item_venta        AS ENUM ('producto','servicio');
CREATE TYPE estado_venta           AS ENUM ('registrada','anulada');
CREATE TYPE condicion_pago_venta   AS ENUM ('contado','cuenta_corriente','mixto');
CREATE TYPE estado_facturacion     AS ENUM ('no_facturada','pendiente','facturada','anulada');
CREATE TYPE estado_compra          AS ENUM ('borrador','confirmada','anulada');
CREATE TYPE estado_sesion_caja     AS ENUM ('abierta','cerrada');
CREATE TYPE tipo_movimiento_caja   AS ENUM (
  'ingreso_venta','ingreso_cobro_cuenta_corriente','ingreso_manual',
  'egreso_pago_proveedor','egreso_devolucion','egreso_manual','egreso_retiro'
);
CREATE TYPE estado_recuento        AS ENUM ('borrador','aplicado','anulado');
CREATE TYPE estado_trazabilidad    AS ENUM ('no_aplica','pendiente','informado','confirmado');

-- ─── 2. Dos valores nuevos en modulo_vendible ────────────────────────────

ALTER TYPE modulo_vendible ADD VALUE IF NOT EXISTS 'stock';
ALTER TYPE modulo_vendible ADD VALUE IF NOT EXISTS 'ventas';

-- ─── 3. Seis valores nuevos en modulo_auditoria ──────────────────────────

ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'products';       -- catálogo, familias, unidades, conversiones
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'suppliers';      -- proveedores
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'purchases';      -- compras
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'inventory';      -- lotes, movimientos, ajustes, recuentos, fraccionamiento
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'sales';          -- ventas y devoluciones
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'cash_register';  -- caja

-- ─── 4. Dos valores nuevos en origen_notificacion ────────────────────────

ALTER TYPE origen_notificacion ADD VALUE IF NOT EXISTS 'vencimiento_lote';
ALTER TYPE origen_notificacion ADD VALUE IF NOT EXISTS 'stock_minimo';
