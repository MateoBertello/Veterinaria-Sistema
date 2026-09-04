-- @modulo: comercial
-- =====================================================================
-- MIGRACIÓN 20261029000002: signo_movimiento() y signo_movimiento_caja()
-- sin ELSE genérico — enumeración exhaustiva del enum
-- =====================================================================
--
-- POR QUÉ
--
-- Ambas funciones cerraban con un `ELSE -1`. Eso convierte cualquier valor del
-- enum que nadie contempló en una salida silenciosa:
--
--   * En `signo_movimiento`, agregar `entrada_donacion` al enum
--     `tipo_movimiento_stock` sin tocar la función le asignaba -1. Una entrada
--     de 5 unidades RESTABA 5 de `existencias_lote` vía el trigger
--     `existencias_lote_aplicar_movimiento`, y las 66 suites unitarias y las 4
--     de integración quedaban en verde: ningún test podía verlo, porque el
--     valor nuevo no existía cuando se escribieron.
--   * En `signo_movimiento_caja` pasa lo mismo con cualquier `ingreso_*`
--     futuro: entraría al arqueo teórico de `cerrar_sesion_caja` (RN-CJ2)
--     restando en vez de sumando.
--
-- El `ELSE` es lo que hace que el defecto sea silencioso: la función siempre
-- tiene una respuesta, aunque sea la equivocada. Enumerando los 15 valores de
-- `tipo_movimiento_stock` y los 7 de `tipo_movimiento_caja` uno por uno, un
-- valor no contemplado cae fuera de todos los WHEN y el CASE devuelve NULL.
--
-- NULL es la respuesta correcta acá: significa "esta función no sabe qué signo
-- tiene este movimiento", que es exactamente la verdad. Y NULL, a diferencia de
-- -1, no se puede confundir con una respuesta.
--
-- LANGUAGE sql IMMUTABLE se mantiene sin cambios: la columna generada
-- `movimientos_stock.cantidad_con_signo` exige una función IMMUTABLE y necesita
-- que sea inlineable; pasar a plpgsql penalizaría cada INSERT del libro mayor.
--
-- El guardrail que cierra la clase —que un valor nuevo en el enum sin su rama
-- en la función ponga la suite en rojo— es `tests/unit/signo-movimiento.test.ts`.
-- Este archivo sólo saca el ELSE; el guardrail es lo que impide que vuelva.

-- ─── 1. signo_movimiento() — los 15 valores de tipo_movimiento_stock ─────────
-- +1 entradas (6) · 0 neutro (1) · -1 salidas (8) = 15. Sin ELSE.
CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tipo
    -- Entradas: incrementan la existencia física del lote (RN-MV4).
    WHEN 'entrada_compra'              THEN  1
    WHEN 'entrada_ajuste'              THEN  1
    WHEN 'entrada_devolucion'          THEN  1
    WHEN 'entrada_conversion'          THEN  1
    WHEN 'entrada_inicial'             THEN  1
    WHEN 'sobrante_recuento'           THEN  1
    -- Neutro: la merma de fraccionamiento se asienta para trazabilidad, pero la
    -- entrada_conversion ya ingresó sólo las unidades realmente obtenidas, así
    -- que descontarla dejaría existencias negativas (C6·T1).
    WHEN 'merma_fraccionamiento'       THEN  0
    -- Salidas: disminuyen la existencia física del lote (RN-MV4).
    WHEN 'salida_venta'                THEN -1
    WHEN 'salida_ajuste'               THEN -1
    WHEN 'salida_conversion'           THEN -1
    WHEN 'salida_devolucion_proveedor' THEN -1
    WHEN 'consumo_clinico'             THEN -1
    WHEN 'merma_vencimiento'           THEN -1
    WHEN 'merma_rotura'                THEN -1
    WHEN 'faltante_recuento'           THEN -1
    -- Sin ELSE, a propósito: un valor del enum que no esté acá devuelve NULL.
  END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) TO service_role;

-- ─── 2. El NULL tiene que doler en el INSERT, no más adelante ────────────────
-- Sin esta restricción, un signo NULL se guardaba como `cantidad_con_signo`
-- NULL y el error recién aparecía en el trigger de `existencias_lote`
-- (`cantidad + NULL` → NOT NULL violation en otra tabla), o directamente no
-- aparecía si alguna vez ese trigger cambiara. Con NOT NULL sobre la columna
-- generada, el movimiento de un tipo sin signo definido lo rechaza la propia
-- fila, con la tabla y la columna en el mensaje.
ALTER TABLE public.movimientos_stock
  ALTER COLUMN cantidad_con_signo SET NOT NULL;

-- ─── 3. signo_movimiento_caja() — los 7 valores de tipo_movimiento_caja ──────
-- +1 ingresos (3) · -1 egresos (4) = 7. Sin ELSE.
CREATE OR REPLACE FUNCTION public.signo_movimiento_caja(p_tipo tipo_movimiento_caja)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tipo
    WHEN 'ingreso_venta'                   THEN  1
    WHEN 'ingreso_cobro_cuenta_corriente'  THEN  1
    WHEN 'ingreso_manual'                  THEN  1
    WHEN 'egreso_pago_proveedor'           THEN -1
    WHEN 'egreso_devolucion'               THEN -1
    WHEN 'egreso_manual'                   THEN -1
    WHEN 'egreso_retiro'                   THEN -1
    -- Sin ELSE, a propósito: un valor del enum que no esté acá devuelve NULL.
  END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) TO service_role;

-- ─── 4. En caja, el NULL sería MÁS silencioso que el -1 ──────────────────────
-- `cerrar_sesion_caja` calcula el teórico con
-- `COALESCE(sum(mov.importe * signo_movimiento_caja(mov.tipo)), 0)`, y `sum()`
-- ignora los NULL: un movimiento de tipo sin signo no restaría mal el arqueo,
-- simplemente no contaría, y el faltante aparecería como diferencia de caja de
-- un cajero. Por eso el rechazo va en el INSERT: `movimientos_caja` es
-- append-only (trigger `movimientos_caja_inmutable`), así que validar en la
-- entrada alcanza para que ninguna fila sin signo llegue al arqueo.
ALTER TABLE public.movimientos_caja
  ADD CONSTRAINT chk_mov_caja_signo_definido
  CHECK (signo_movimiento_caja(tipo) IS NOT NULL);

NOTIFY pgrst, 'reload schema';
