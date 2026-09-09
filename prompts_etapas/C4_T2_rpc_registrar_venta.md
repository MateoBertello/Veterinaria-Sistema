# ETAPA C4 · TANDA 2/5 — RPC `registrar_venta`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T1 en verde, con `ventas.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es el RPC central del módulo y el que más fácil se hace mal.** Tres cosas van a estar
> tentadoras y las tres están prohibidas: calcular el IVA neto e IVA por separado (R-04),
> descontar existencia desde el Service (R-01), y bloquear los lotes en el orden en que
> aparecen en la venta en vez de por `lote_id` (deadlock).

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.1 | **El esqueleto de `registrar_venta`, paso por paso.** Copialo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1 | La regla de redondeo del IVA, con su fórmula. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-05 | FEFO con override motivado y la prohibición de despachar vencido. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6, §6.7 | RN-VT1, VT2, VT6, VT7, VT8, RN-CJ1. |
| `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql` | Tu propio RPC de C2·T3: la forma del bucle, la auditoría interna, el `REVOKE`/`GRANT`/`NOTIFY`. |
| `supabase/migrations/20260629000001_crear_estadia_con_cupo_rpc.sql` | El `FOR UPDATE` como mutex y su doc-comment. |
## O. Seis correcciones a `ESPEC_MODULO_COMERCIAL.md` v1.0

La spec v1.0 tiene seis puntos que se corrigieron en la sesión de planificación. **Estas
correcciones ganan sobre la spec.** Están completas en `PLAN_ETAPAS_COMERCIAL.md` §0; lo que
sigue es lo que necesitás para esta tanda.

```
O-1  NOMBRES EN PLURAL. D-02 de la spec escribe `movimiento_stock` y `existencia_lote`.
     Los nombres correctos son PLURALES, como todo el repo:
       movimientos_stock  existencias_lote  lotes  productos  proveedores
       familias_producto  producto_conversiones  compras  compras_items
       ventas  ventas_items  ventas_pagos  cajas  sesiones_caja
       movimientos_caja   recuentos  recuentos_detalle  contadores_tenant

O-2  LA COLUMNA "Etapa" DE §5 ESTÁ MAL. Usá el corte de §11 y de
     PLAN_ETAPAS_COMERCIAL.md, no la tabla de §5.

O-3  UNIQUE (id, tenant_id) FALTA EN CINCO TABLAS DE PRODUCCIÓN. Las FKs compuestas lo
     necesitan del lado referenciado. Hoy solo lo tienen roles, especies, razas y
     tipos_vacuna. Se agregan: clientes (C1·T3), mascotas / historial_clinico /
     plan_vacunacion (C2·T1), servicios (C4·T1).

O-4  NUEVE ErrorCode QUE §7 NO TIENE. Se suman al enum de shared/errors.ts:
       PRODUCT_NOT_FOUND  PRODUCT_NAME_DUPLICATE  FAMILY_NOT_FOUND  SUPPLIER_NOT_FOUND
       CONVERSION_NOT_FOUND  PURCHASE_NOT_FOUND  SALE_NOT_FOUND  CASH_SESSION_NOT_FOUND
       COUNT_NOT_FOUND
     Y RN-PR12 (nombre duplicado) devuelve PRODUCT_NAME_DUPLICATE, no PRODUCT_CODE_DUPLICATE.

O-5  AGREGAR UN VALOR A modulo_vendible TOCA SEIS ARCHIVOS DE CÓDIGO, no solo
     on_tenant_created(). La lista exacta está en la tanda C1·T2.

O-6  `npm test` NO CORRE INTEGRACIÓN. Es `vitest run tests/unit`. Los tests de integración
     van con `npm run test:integration` y necesitan TEST_SUPABASE_URL,
     TEST_SUPABASE_ANON_KEY y TEST_SUPABASE_SERVICE_ROLE_KEY en `.env`. Sin ellas,
     describeIntegration marca las suites SKIPPED — que no es un rojo, pero tampoco es una
     prueba. Cuando esta tanda tenga tests de integración, la definición de hecho exige
     contar los `passed`, no que la suite termine sin rojo.
```
## R. Reglas transversales — se aplican en TODA tanda, sin excepción

```
- tenant_id SIEMPRE de ctx.tenantId (que viene del JWT vía tenantContext). Ningún handler
  lo lee del body, query o params.
- Los Services escriben con getServiceDb() y filtran .eq('tenant_id', tenantId) en TODA
  consulta, sin excepción. service_role bypasea RLS: el filtro es el aislamiento.
- Los RPC son SECURITY DEFINER, reciben p_tenant_id como primer parámetro y filtran por él
  en cada lectura y escritura. Cierran con REVOKE ALL ... FROM PUBLIC + GRANT EXECUTE ...
  TO service_role.
- Toda migración que cree o cambie un RPC termina con NOTIFY pgrst, 'reload schema';
- Envelope estándar: ok(data, meta?) / fail(code, message, statusCode, details).
- Los ErrorCode salen del enum central de shared/errors.ts. No inventar códigos.
- Errores de negocio en RPC: RAISE EXCEPTION '<ERROR_CODE>'; el Service los mapea a
  DomainError.
- Auditoría: recordAudit() desde el Service; INSERT INTO registros_auditoria DENTRO del RPC
  para operaciones transaccionales (patrón registrar_eutanasia).
- Toda escritura de existencia va por RPC con SELECT ... FOR UPDATE ordenado por lote_id.
  El Service NUNCA lee existencias para decidir.
- RLS de las tablas nuevas: ENABLE (sin FORCE), política FOR SELECT con usuario_activo() y
  tiene_permiso('<permiso>'). Sin políticas de escritura. Sin GRANT propio.
- NUMERIC con precisión explícita. Nunca float.
- Nada se borra ni se edita: se compensa con un asiento nuevo y motivo.
- Nombres del glosario (§1 de la spec) iguales en base, código, ErrorCode y UI.
```
## M. Marca de migración del módulo — obligatoria en TODA migración comercial

Cada archivo `.sql` que escribas para este módulo **arranca con esta línea exacta**, antes de
cualquier comentario de encabezado:

```sql
-- @modulo: comercial
```

No es decoración. El guardrail **G3** (`tests/integration/grants.integration.test.ts`)
enumera las funciones del módulo **parseando las migraciones que llevan esta marca**, y
verifica que ninguna sea ejecutable por `anon` ni por `authenticated`. Una migración sin la
marca deja sus funciones fuera del alcance del guardrail: el `REVOKE` faltante no se detecta
y el RPC queda invocable desde PostgREST con el token de cualquier usuario, que es
exactamente lo que el aislamiento por `p_tenant_id` no puede frenar por sí solo.

Es el mismo criterio con el que el guardrail de `tenant_id` deriva las tablas del DDL en vez
de una lista escrita a mano: lo que se sostiene solo es lo que sigue funcionando en la tanda
número doce.
## 1. Qué construir

**Archivos a CREAR:**

1. `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | RN-VT6, VT8, RN-LO6, RN-PR9, PR10, y el caso de stock mínimo. |
| `tests/unit/ventas.service.test.ts` | **Crealo**: RN-VT1, VT2, VT7, RN-CJ1 — la aritmética del IVA se prueba en unit, sin base. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas RN. |

## 2. Especificación exacta

### 2.1. Firma

```sql
registrar_venta(
  p_tenant_id      UUID,
  p_usuario_id     UUID,
  p_sesion_caja_id UUID,
  p_cliente_id     UUID,      -- NULL = venta de mostrador anónima
  p_condicion_pago condicion_pago_venta,
  p_items          JSONB,     -- [{tipoItem, productoId, servicioId, cantidad, precioUnitario,
                              --   descuentoPorcentaje, loteId, motivoFefo, mascotaId}]
  p_pagos          JSONB,     -- [{medioPagoId, importe, referencia}]
  p_descuento      NUMERIC DEFAULT 0,
  p_observaciones  TEXT DEFAULT NULL
)
RETURNS TABLE (venta_id UUID, numero_operacion BIGINT, operacion_id UUID,
               subtotal_neto NUMERIC, total_iva NUMERIC, total NUMERIC,
               saldo_pendiente NUMERIC)
```

### 2.2. Cuerpo, en este orden exacto

```
BEGIN
  v_operacion := gen_random_uuid();

  -- ── 1. Validaciones SIN bloqueo ──────────────────────────────────────────
  -- RN-VT8: toda venta pertenece a una sesión ABIERTA, aunque no mueva efectivo.
  SELECT estado INTO v_estado_sesion FROM sesiones_caja
   WHERE id = p_sesion_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;
  IF v_estado_sesion <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;

  -- RN-VT7: una venta sin ítems no existe.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0
     THEN RAISE EXCEPTION 'SALE_WITHOUT_ITEMS'; END IF;

  -- El cliente, si viene, es de este tenant. Un cliente_id de otra clínica entra
  -- sin que la base diga nada hasta el INSERT: se resuelve acá.
  IF p_cliente_id IS NOT NULL THEN
    SELECT condicion_fiscal, dni_cuit INTO v_cond_fiscal, v_documento
      FROM clientes WHERE id = p_cliente_id AND tenant_id = p_tenant_id AND deleted = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;

  -- ── 2. Ítems: validación, IVA y asignación FEFO ──────────────────────────
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(...) LOOP

    IF v_item.tipoItem = 'producto' THEN
      SELECT activo, es_vendible, precio_venta, alicuota_iva, nombre,
             unidad_medida_id, controla_lote
        INTO v_prod
        FROM productos WHERE id = v_item.productoId AND tenant_id = p_tenant_id;

      IF NOT FOUND              THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND';     END IF;
      IF NOT v_prod.activo      THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';      END IF;  -- RN-PR3
      IF NOT v_prod.es_vendible THEN RAISE EXCEPTION 'PRODUCT_NOT_SELLABLE';  END IF;  -- RN-PR10
      IF v_prod.precio_venta IS NULL AND v_item.precioUnitario IS NULL
                                THEN RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE'; END IF;  -- RN-PR9

      -- RN-PR6: la cantidad respeta los decimales de la unidad.
      IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
         THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

      -- RN-LO5: candidatos FEFO. MISMO criterio que stock.service.ts:
      -- fecha_vencimiento ASC con NULLS LAST, luego fecha_ingreso, luego id.
      -- RN-LO4: los vencidos NO entran, y no hay override. RN-LO7: los
      -- bloqueados tampoco.
      --
      -- RN-LO6: si el usuario forzó un lote distinto del sugerido, exige motivo
      -- y el movimiento va a guardar fefo_respetado = false.
      IF v_item.loteId IS NOT NULL AND v_item.loteId <> v_lote_sugerido THEN
        IF v_item.motivoFefo IS NULL OR length(trim(v_item.motivoFefo)) < 10
           THEN RAISE EXCEPTION 'FEFO_OVERRIDE_WITHOUT_REASON'; END IF;
        v_fefo_ok := false;
      ELSE
        v_fefo_ok := true;
      END IF;

    ELSE  -- servicio
      SELECT activo, precio, alicuota_iva, nombre INTO v_svc
        FROM servicios WHERE id = v_item.servicioId AND tenant_id = p_tenant_id;
      IF NOT FOUND         THEN RAISE EXCEPTION 'SERVICE_NOT_FOUND';   END IF;
      IF NOT v_svc.activo  THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';    END IF;
      IF v_svc.precio IS NULL AND v_item.precioUnitario IS NULL
                           THEN RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE'; END IF;
    END IF;

    -- ── IVA POR DIFERENCIA. NO calcules neto e IVA por separado. ──────────
    -- El precio que llega es el FINAL, con IVA incluido.
    v_precio  := COALESCE(v_item.precioUnitario, v_prod.precio_venta, v_svc.precio);
    v_alicuota := COALESCE(v_prod.alicuota_iva, v_svc.alicuota_iva);
    v_neto_u  := round(v_precio / (1 + v_alicuota / 100), 2);
    v_iva_u   := v_precio - v_neto_u;              -- POR DIFERENCIA. SIEMPRE.
    v_importe := round(v_precio * v_item.cantidad * (1 - v_item.descuentoPorcentaje/100), 2);

    v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, <los lotes asignados>);
  END LOOP;

  -- ── 3. BLOQUEO. TODOS los lotes en UN SOLO SELECT, ORDENADOS POR lote_id ──
  -- Esto no es un detalle de estilo. Dos ventas simultáneas que toquen los lotes
  -- A y B en orden inverso se bloquean mutuamente y una muere por deadlock.
  -- Ordenar SIEMPRE por la misma clave lo elimina. Es la línea que se olvida.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_a_bloquear)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── 4. Validaciones SOBRE EL VALOR YA BLOQUEADO ──────────────────────────
  -- RN-MV5: existencia suficiente POR LOTE. Esta validación va DESPUÉS del
  -- bloqueo, no antes: leer antes de bloquear es exactamente la ventana por la
  -- que dos ventas de la última unidad pasan las dos.
  --   existencia insuficiente -> INSUFFICIENT_STOCK
  --   lote vencido            -> BATCH_EXPIRED
  --   lote bloqueado          -> BATCH_BLOCKED

  -- ── 5. Numeración: contador del tenant, bloqueado ─────────────────────────
  INSERT INTO contadores_tenant (tenant_id, nombre, valor) VALUES (p_tenant_id, 'venta', 0)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  UPDATE contadores_tenant SET valor = valor + 1
   WHERE tenant_id = p_tenant_id AND nombre = 'venta'
  RETURNING valor INTO v_numero;

  -- ── 6. Escrituras ─────────────────────────────────────────────────────────
  -- RN-VT2: el total es la SUMA DE LOS IMPORTES DE LÍNEA YA REDONDEADOS.
  -- Nunca un recálculo desde los netos.
  INSERT INTO ventas (..., numero_operacion = v_numero,
                      condicion_fiscal_snapshot = v_cond_fiscal,   -- RN-VT6
                      documento_snapshot        = v_documento);

  -- RN-VT6: descripcion_snapshot, precio_unitario y alicuota_iva se CONGELAN.
  -- Cambios posteriores del catálogo no alteran ventas registradas.
  INSERT INTO ventas_items (...);

  -- N movimientos por línea, uno por lote asignado. Todos con el mismo
  -- operacion_id y con fefo_respetado / motivo.
  INSERT INTO movimientos_stock (tipo = 'salida_venta', venta_item_id = ..., ...);

  -- costo_unitario_efectivo de la línea: promedio ponderado de los movimientos
  -- que la resolvieron. Se GUARDA (RN-MV6), no se recalcula después.
  UPDATE ventas_items SET costo_unitario_efectivo = ...;

  INSERT INTO ventas_pagos (...);

  -- RN-CJ1: SUM(pagos) + saldo_pendiente = total, AL CENTAVO.
  IF round(v_suma_pagos + v_saldo_pendiente, 2) <> round(v_total, 2)
     THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;

  -- saldo_pendiente > 0 solo si la condición de pago lo admite.
  IF v_saldo_pendiente > 0 AND p_condicion_pago = 'contado'
     THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;

  -- RN-CJ9: referencia obligatoria según el medio.
  -- Un movimiento de caja POR CADA PAGO, incluidos los que no afectan arqueo:
  -- hacen falta para el total vendido. Solo el efectivo entra al arqueo, y eso
  -- lo resuelve cerrar_sesion_caja filtrando por afecta_arqueo.
  INSERT INTO movimientos_caja (tipo = 'ingreso_venta', ...);

  -- ── 6b. Alerta de stock mínimo, POR FLANCO ────────────────────────────────
  -- Se crea al cruzar el mínimo HACIA ABAJO y se ELIMINA al cruzarlo hacia
  -- arriba, de modo que el UNIQUE (tenant_id, origen, referencia_id, canal) de
  -- `notificaciones` deje de bloquear y el próximo faltante vuelva a avisar.
  -- Con referencia_id = producto_id y sin el borrado, el segundo faltante NO
  -- avisaría NUNCA. Se evalúa acá, después de los movimientos, no por tarea
  -- programada: así la alerta llega cuando pasa y no al día siguiente.
  --   existencia total del producto < stock_minimo -> INSERT ... ON CONFLICT DO NOTHING
  --   existencia total >= stock_minimo             -> DELETE de la notificación

  -- ── 7. Auditoría, misma transacción ───────────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'CREATE', 'sales', v_venta_id::text, ...);

  RETURN QUERY SELECT ...;
END;
```

**Cada lectura y cada escritura filtra por `p_tenant_id`**, salvo la de `medios_pago`, que es
catálogo global. Contá los `WHERE` y verificalo.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.3. Tests unitarios de la aritmética — `tests/unit/ventas.service.test.ts`

**La descomposición del IVA se prueba en unit, sin base.** Extraé la fórmula a una función pura
exportada desde `ventas.service.ts` (que se escribe en C4·T4; adelantá **solo esa función** acá,
en un archivo `supabase/functions/api/src/modules/ventas/ventas.calculo.ts`) y probala:

```ts
export function descomponerLinea(precioUnitario: number, alicuota: number, cantidad: number) {
  const netoUnitario = redondear2(precioUnitario / (1 + alicuota / 100));
  const ivaUnitario  = redondear2(precioUnitario - netoUnitario);  // POR DIFERENCIA
  const importeTotal = redondear2(precioUnitario * cantidad);
  return { netoUnitario, ivaUnitario, importeTotal };
}
```

| `it()` | Caso |
|---|---|
| `RN-VT1: el IVA se calcula por diferencia y neto + iva = precio` | $1.000 al 21 % → neto **826,45**, IVA **173,55**. Tres líneas así → total exacto **3.000,00**. |
| `RN-VT1: barrido de precios verificando la identidad` | Para cada precio de **$0,01 a $10.000 en pasos de $0,01** y cada alícuota de `[0, 10.5, 21, 27]`: `neto + iva === precio`, exacto. Sin excepciones, sin tolerancia de centavo. Si el barrido completo tarda demasiado, usá pasos de $0,01 hasta $100 y después de $0,13 hasta $10.000 — pero **no bajes de 100.000 combinaciones probadas**. |
| `RN-VT2: el total es la suma de las líneas redondeadas` | Cinco líneas con alícuotas mixtas (0, 10.5, 21, 27, 21) → `total === suma de importe_total`, al centavo. **Y comprobá que NO coincide** con el recálculo desde los netos en al menos un caso: eso es lo que prueba que la regla importa. |
| `RN-VT7: una venta sin ítems no existe` | Arreglo vacío → `SALE_WITHOUT_ITEMS`. |
| `RN-CJ1: los pagos cubren el total` | $1.000 con pagos por $900 al contado → `PAYMENT_MISMATCH`. $600 efectivo + $400 transferencia → OK. $900 en cuenta corriente con `condicion_pago='cuenta_corriente'` → OK, `saldo_pendiente = 100`. |

### 2.4. Tests de integración

| `it()` | Caso |
|---|---|
| `RN-VT8: sin sesión de caja abierta, la venta falla` | Sin sesión → `CASH_SESSION_REQUIRED`. Con sesión **cerrada** → también. |
| `RN-VT6: la línea congela descripción, precio y alícuota` | Vender; después renombrar el producto **y** cambiarle la alícuota de 21 a 10,5; releer la línea → conserva los tres valores viejos. |
| `RN-LO6: el override de FEFO exige motivo` | Con dos lotes (uno vence antes), forzar el segundo **sin** motivo → `FEFO_OVERRIDE_WITHOUT_REASON`. Con motivo → funciona, y el movimiento queda con `fefo_respetado = false` y el texto en `motivo`. Vender sin forzar → `fefo_respetado = true` y sale del lote que vence primero. |
| `RN-LO4: un lote vencido no se vende, ni siendo admin` | Único lote disponible vencido → `BATCH_EXPIRED`, con el JWT de admin. |
| `RN-PR9 y RN-PR10 contra una venta real` | Producto sin `precio_venta` → `PRODUCT_WITHOUT_PRICE`. Producto con `es_vendible = false` → `PRODUCT_NOT_SELLABLE`. **Cierra lo que C1·T4 dejó probado solo con mocks.** |
| `la venta genera un movimiento de caja por CADA pago` | Pago mixto de 2 medios → 2 filas en `movimientos_caja`, las dos con `venta_id`. |
| `la alerta de stock mínimo es por flanco` | Producto con `stock_minimo = 10` y existencia 12. Vender 5 → existencia 7, **una** notificación `stock_minimo`. Vender 1 más → existencia 6, **sigue habiendo una** (el `UNIQUE` la absorbe). Comprar 10 → existencia 16, la notificación **se borró**. Vender 8 → existencia 8, **vuelve a haber una**. Los cuatro pasos, en orden: es el único test que prueba que la alerta es por flanco y no por nivel. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-VT1 | IVA por línea, calculado por diferencia; `neto + iva = precio` siempre. | `it('RN-VT1: el IVA se calcula por diferencia y neto + iva = precio', …)` |
| RN-VT2 | El total es la suma de las líneas redondeadas, nunca un recálculo. | `it('RN-VT2: el total es la suma de las líneas redondeadas', …)` |
| RN-VT6 | Snapshot de la línea: descripción, precio y alícuota se congelan. | `it('RN-VT6: la línea congela descripción, precio y alícuota', …)` |
| RN-VT7 | Una venta sin ítems no existe. → `422 SALE_WITHOUT_ITEMS` | `it('RN-VT7: una venta sin ítems no existe', …)` |
| RN-VT8 | Toda venta pertenece a una sesión abierta. → `409 CASH_SESSION_REQUIRED` | `it('RN-VT8: sin sesión de caja abierta, la venta falla', …)` |
| RN-CJ1 | `SUM(pagos) + saldo_pendiente = total`, al centavo. → `422 PAYMENT_MISMATCH` | `it('RN-CJ1: los pagos cubren el total', …)` |
| RN-LO6 | Override de FEFO con motivo obligatorio y `fefo_respetado = false`. → `422 FEFO_OVERRIDE_WITHOUT_REASON` | `it('RN-LO6: el override de FEFO exige motivo', …)` |
| RN-PR9, RN-PR10 | Sin precio no se vende; no vendible no se vende. | Se completan contra una venta real. |

## 4. Orden de trabajo

1. **Escribí `ventas.calculo.ts` y `tests/unit/ventas.service.test.ts` primero.** El barrido de
   RN-VT1 tiene que correr y **fallar** antes de que la función exista. Es la parte más barata
   de verificar y la que más plata cuesta si sale mal.
2. Migración del RPC, con marca y `NOTIFY`, aplicada.
3. Tests de integración en verde.
4. **Verificá RN-VT1 por mutación:** cambiá `v_iva_u := v_precio - v_neto_u` por
   `v_iva_u := round(v_precio * v_alicuota / (100 + v_alicuota), 2)` —que es el cálculo
   "por separado", intuitivo y equivocado—, corré el barrido, confirmá que **falla** y anotá
   con qué precio falló. Volvé al original. Reportalo: ese precio es la prueba de que R-04 es
   real y no una precaución teórica.
5. **Verificá el orden del bloqueo por lectura del código**: el `ORDER BY lote_id` tiene que
   estar en el `FOR UPDATE`. Sin él no hay test que lo detecte de forma confiable, así que la
   verificación es visual y va en el reporte.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe, no lo ejecuta anon, y su migración lleva NOTIFY
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='registrar_venta';"
tail -3 supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql

# 2. EL BLOQUEO ESTÁ ORDENADO POR lote_id
grep -n -B4 -A2 "FOR UPDATE" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
# → tiene que aparecer "ORDER BY lote_id" inmediatamente antes del FOR UPDATE.
#   Si no está, hay un deadlock esperando a dos ventas simultáneas.

# 3. El IVA se calcula POR DIFERENCIA
grep -n "iva_u\|iva_unitario" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
# → la línea del IVA tiene que ser una RESTA (v_precio - v_neto_u), no una
#   multiplicación por la alícuota.

# 4. Ningún service lee existencias para decidir
grep -rn 'from("existencias_lote")' supabase/functions/api/src/modules/ | grep -v "select"
# → sin resultados

# 5. El barrido de RN-VT1
npx vitest run tests/unit/ventas.service.test.ts -t "RN-VT1"
# → passed. Reportá cuántas combinaciones probó.

# 6. Integración
npx vitest run --config vitest.integration.config.ts tests/integration/ventas.integration.test.ts
# → "N passed", "0 skipped"

# 7. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
```
## 6. Qué NO hacer

- **No toques ningún archivo fuera de las listas de la sección 1.**
- No refactorices código existente. Si ves algo mejorable, anotalo en el reporte.
- No agregues dependencias.
- No modifiques migraciones ya aplicadas: creá una nueva.
- No modifiques `docs/ESPEC_MODULO_COMERCIAL.md` ni `PLAN_ETAPAS_COMERCIAL.md`.
- No escribas tests E2E de Playwright: están fuera del alcance de este plan.
- Si algo de la spec no se puede implementar como está escrito, **frená y reportá**. No
  improvises una alternativa.

## 7. Reporte final (obligatorio, va al chat)

- Archivos creados y archivos modificados, con ruta completa.
- RN cubiertas, con el resultado exacto de los tests (`N passed`, `M skipped`).
- Qué quedó pendiente.
- Qué contradicción o duda apareció.
