# ETAPA C2 · TANDA 3/5 — Compras, configuración y RPC `confirmar_compra`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T2 en verde, con `stock.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Primera escritura transaccional del módulo.** A partir de acá vale la regla que no se
> negocia: **el Service arma la intención y llama al RPC. El Service NO lee existencias para
> decidir.** Si en una revisión aparece un `SELECT` de existencia seguido de una escritura
> desde TypeScript, es un defecto aunque pase las pruebas.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.5, §4.6, §4.11 | Productos sin control de lote, `compras`, `compras_items`, las seis columnas de `configuracion_tenant`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04 | Costo por lote, costo efectivo vs. costo de reposición, y la composición del costo según condición fiscal. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.4 y §6.5 | RN-LO1, LO2, LO3 y RN-CM1…CM5. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.8 | Decisión P-05: **monotributista** → `iva_compras_es_costo` default `true`. |
| `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql` | **El patrón exacto del RPC a copiar.** Mirá: la resolución de `full_name` / `display_name` del usuario, el `INSERT INTO registros_auditoria` dentro de la transacción, el `REVOKE`/`GRANT`, el `NOTIFY pgrst`. |
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | **El patrón de llamada al RPC desde el Service**: `.rpc(nombre, { p_tenant_id: ctx.tenantId, … }).single()` y `mapEstadiaRpcError` para traducir el `RAISE EXCEPTION` a `DomainError`. |
| `supabase/migrations/20260614000002_tables.sql` líneas 30-38 | `configuracion_tenant` tal como está hoy. |
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

1. `supabase/migrations/20260908000003_comercial_compras.sql`
2. `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/compras.integration.test.ts` | **Crealo**: RN-CM1, CM4, CM5, RN-LO1, LO2, LO3, RN-MV7, RN-PRV3. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Las filas de esas ocho RN. |

**Dos migraciones separadas, no una.** La primera crea tablas y columnas; la segunda crea el
RPC. Son dos modos de error distintos y conviene poder revisar el diff del DDL solo.

## 2. Especificación exacta

### 2.1. `20260908000003_comercial_compras.sql`

**Las seis columnas de `configuracion_tenant`.** Columnas tipadas, no `parametros_extra`: todas
se leen en caminos de validación donde un `->>` sin tipo es una fuente de bugs silenciosos.

```sql
ALTER TABLE configuracion_tenant
  -- Decisión P-05: la clínica es MONOTRIBUTISTA. El IVA de compra no se recupera
  -- y es parte del costo real, así que costo_unitario_efectivo = neto + IVA.
  -- Si esto se pusiera en false por error, el inventario quedaría subvaluado un
  -- 21 % y TODOS los márgenes saldrían inflados.
  ADD COLUMN iva_compras_es_costo               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_alerta_vencimiento            INTEGER NOT NULL DEFAULT 60
    CHECK (dias_alerta_vencimiento BETWEEN 1 AND 365),
  ADD COLUMN tolerancia_rendimiento_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN tolerancia_diferencia_arqueo       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN permitir_venta_sin_existencia      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN exigir_receta_bloqueante           BOOLEAN NOT NULL DEFAULT false;
```

Todas con `NOT NULL DEFAULT`, todas aditivas. `on_tenant_created()` **no necesita cambios**: su
`INSERT` existente toma los defaults.

**`compras`:**

```
id, tenant_id,
proveedor_id                    UUID NOT NULL,  -- FK compuesta → proveedores, ON DELETE RESTRICT
fecha                           DATE NOT NULL,
comprobante_proveedor_tipo      TEXT NULL,
comprobante_proveedor_numero    TEXT NULL,
total_neto, total_iva, total    NUMERIC(14,2) NOT NULL DEFAULT 0,
estado                          estado_compra NOT NULL DEFAULT 'borrador',
genera_egreso_caja              BOOLEAN NOT NULL DEFAULT false,
sesion_caja_id                  UUID NULL,   -- sin FK: sesiones_caja llega en C3·T1
observaciones                   TEXT NULL,
usuario_id                      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
created_at, updated_at
```

- `ALTER TABLE compras ADD CONSTRAINT compras_id_tenant_key UNIQUE (id, tenant_id);`
- **RN-CM4** — evita cargar dos veces la misma factura, que es el error de carga más común:
  ```sql
  CREATE UNIQUE INDEX uq_compras_comprobante
    ON compras (tenant_id, proveedor_id, comprobante_proveedor_numero)
    WHERE comprobante_proveedor_numero IS NOT NULL;
  ```
- `CREATE INDEX idx_compras_tenant_estado ON compras (tenant_id, estado, fecha DESC);`
- **El `ON DELETE RESTRICT` de `proveedor_id` es RN-PRV3.** Es la protección dura que C1·T5
  dejó pendiente: recién ahora existe la tabla contra la que probarla.

**`compras_items`:**

```
id, tenant_id,
compra_id             UUID NOT NULL,  -- FK compuesta → compras, ON DELETE CASCADE
producto_id           UUID NOT NULL,  -- FK compuesta → productos, ON DELETE RESTRICT
cantidad              NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
costo_unitario_neto   NUMERIC(14,4) NOT NULL CHECK (costo_unitario_neto >= 0),
alicuota_iva          NUMERIC(5,2) NOT NULL,
codigo_lote           TEXT NULL,
fecha_vencimiento     DATE NULL,
importe_neto, importe_iva, importe_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
created_at
```

- `ALTER TABLE compras_items ADD CONSTRAINT compras_items_id_tenant_key UNIQUE (id, tenant_id);`
- **`ON DELETE CASCADE` en `compra_id` es el ÚNICO CASCADE del módulo**, y es deliberado: un
  ítem de un borrador no tiene vida propia. Todo lo demás es `RESTRICT`.

**Las dos FKs diferidas de C2·T1.** `lotes.compra_item_id` y `movimientos_stock.compra_item_id`
se declararon sin FK porque la tabla no existía. Ahora sí:

```sql
ALTER TABLE lotes
  ADD CONSTRAINT lotes_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;
```

**RLS** de las dos tablas: `FOR SELECT` con `tiene_permiso('manage_suppliers')` —§4.13 asigna
ese permiso a "proveedores y compras"—. Sin `FORCE`, sin políticas de escritura, sin `GRANT`.

### 2.2. `20260908000004_comercial_confirmar_compra_rpc.sql`

**El borrador no mueve existencias (RN-CM1).** Lotes y movimientos se crean **al confirmar**,
en este RPC, en una sola transacción.

```
confirmar_compra(p_tenant_id UUID, p_usuario_id UUID, p_compra_id UUID)
RETURNS TABLE (compra_id UUID, operacion_id UUID, lotes_creados INTEGER, total NUMERIC)
```

Cuerpo, en este orden:

```
BEGIN
  v_operacion := gen_random_uuid();

  -- 1. La compra existe, es de este tenant y está en borrador
  SELECT * INTO v_compra FROM compras
   WHERE id = p_compra_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'PURCHASE_NOT_FOUND';        END IF;
  IF v_compra.estado <> 'borrador' THEN RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED'; END IF;

  -- 2. RN-PRV2: el proveedor está activo
  SELECT activo INTO v_prov_activo FROM proveedores
   WHERE id = v_compra.proveedor_id AND tenant_id = p_tenant_id;
  IF NOT FOUND        THEN RAISE EXCEPTION 'SUPPLIER_NOT_FOUND'; END IF;
  IF NOT v_prov_activo THEN RAISE EXCEPTION 'SUPPLIER_INACTIVE'; END IF;

  -- 3. Al menos un ítem
  IF NOT EXISTS (SELECT 1 FROM compras_items
                  WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id)
     THEN RAISE EXCEPTION 'PURCHASE_WITHOUT_ITEMS'; END IF;

  -- 4. Composición del costo: se lee UNA vez, fuera del bucle
  SELECT iva_compras_es_costo INTO v_iva_es_costo
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  -- 5. Un lote y un movimiento por ítem
  FOR v_item IN SELECT * FROM compras_items
                 WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id
                 ORDER BY id
  LOOP
      SELECT activo, controla_lote, controla_vencimiento, unidad_medida_id
        INTO v_prod
        FROM productos
       WHERE id = v_item.producto_id AND tenant_id = p_tenant_id;

      IF NOT FOUND       THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
      IF NOT v_prod.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;   -- RN-PR3

      -- RN-PR6: la cantidad respeta los decimales de la unidad del producto
      IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
         THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

      -- RN-LO2: si el producto controla vencimiento, el lote lo lleva
      IF v_prod.controla_vencimiento AND v_item.fecha_vencimiento IS NULL
         THEN RAISE EXCEPTION 'EXPIRY_REQUIRED'; END IF;

      -- D-04 + P-05. El costo efectivo se CONGELA acá y no se recalcula nunca.
      v_costo_efectivo := CASE
        WHEN v_iva_es_costo
        THEN round(v_item.costo_unitario_neto * (1 + v_item.alicuota_iva / 100), 4)
        ELSE v_item.costo_unitario_neto
      END;

      -- RN-LO1: dos ingresos del mismo codigo_lote a distinto costo generan DOS
      -- lotes. No se busca un lote existente para "sumarle": el lote es el
      -- portador del costo y su costo es inmutable.
      -- RN-LO3: con controla_lote = false, codigo_lote y fecha_vencimiento van
      -- NULL y se crea un lote genérico igual. NO se actualiza el costo de un
      -- lote genérico existente: cada compra a distinto costo crea uno nuevo.
      INSERT INTO lotes (
        tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
        costo_unitario_neto, costo_unitario_efectivo, origen,
        compra_item_id, proveedor_id, estado, usuario_id
      ) VALUES (
        p_tenant_id, v_item.producto_id,
        CASE WHEN v_prod.controla_lote THEN v_item.codigo_lote        ELSE NULL END,
        CASE WHEN v_prod.controla_lote THEN v_item.fecha_vencimiento  ELSE NULL END,
        v_compra.fecha,
        v_item.costo_unitario_neto, v_costo_efectivo, 'compra',
        v_item.id, v_compra.proveedor_id, 'disponible', p_usuario_id
      )
      RETURNING id INTO v_lote_id;

      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
        costo_unitario, costo_total, compra_item_id, usuario_id
      ) VALUES (
        p_tenant_id, v_operacion, 'entrada_compra', v_item.producto_id, v_lote_id,
        v_item.cantidad, v_costo_efectivo,
        round(v_item.cantidad * v_costo_efectivo, 2),
        v_item.id, p_usuario_id
      );

      -- RN-CM5: la compra actualiza el costo de REPOSICIÓN del producto. NO toca
      -- los movimientos anteriores: ese es el punto de D-04 y de RN-MV6.
      UPDATE productos
         SET costo_reposicion = v_costo_efectivo, updated_at = now()
       WHERE id = v_item.producto_id AND tenant_id = p_tenant_id;

      v_lotes := v_lotes + 1;
  END LOOP;

  -- 6. Totales y estado
  SELECT sum(importe_neto), sum(importe_iva), sum(importe_total)
    INTO v_neto, v_iva, v_total
    FROM compras_items WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id;

  UPDATE compras
     SET estado = 'confirmada', total_neto = v_neto, total_iva = v_iva,
         total = v_total, updated_at = now()
   WHERE id = p_compra_id AND tenant_id = p_tenant_id;

  -- 7. Auditoría en la MISMA transacción (patrón registrar_eutanasia)
  SELECT u.full_name, COALESCE(r.display_name, r.name)
    INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'UPDATE', 'purchases', p_compra_id::text,
    jsonb_build_object('estado','confirmada','operacion_id',v_operacion,
                       'lotes_creados',v_lotes,'total',v_total)
  );

  RETURN QUERY SELECT p_compra_id, v_operacion, v_lotes, v_total;
END;
```

**`genera_egreso_caja` NO se implementa en esta tanda.** `sesiones_caja` llega en C3. Si la
compra tiene `genera_egreso_caja = true`, el RPC la confirma igual y **no** genera movimiento
de caja. Dejá este comentario en el cuerpo:

```sql
-- TODO C3: si v_compra.genera_egreso_caja, insertar el egreso en movimientos_caja.
-- La tabla llega en C3·T1; hasta entonces la compra se confirma sin tocar caja.
```

**Cada lectura y cada escritura filtra por `p_tenant_id`.** Es `SECURITY DEFINER`: no hay RLS.
Contá los `WHERE` del cuerpo y verificá que **todos** lo llevan.

Cierre: `REVOKE ALL … FROM PUBLIC;`, `GRANT EXECUTE … TO service_role;`,
`NOTIFY pgrst, 'reload schema';`.

### 2.3. `tests/integration/compras.integration.test.ts`

Reusá el helper de siembra de `stock.integration.test.ts`.

| `it()` | Caso |
|---|---|
| `RN-CM1: el borrador no mueve existencias` | Crear compra en borrador con 2 ítems → `existencias_lote` no cambió y `lotes` no tiene filas nuevas. Confirmar → sí. |
| `RN-CM4: el comprobante del proveedor no se carga dos veces` | Dos compras del mismo proveedor con `comprobante_proveedor_numero = 'A-0001-00001234'` → la segunda falla (`23505`). Dos con número `NULL` → funcionan. |
| `RN-CM5: la compra actualiza el costo de reposición sin tocar los movimientos` | Compra 1 a costo 100 → confirmar. Compra 2 del mismo producto a 130 → confirmar. `productos.costo_reposicion` = el de la 2.ª; el `movimientos_stock.costo_unitario` de la 1.ª **sigue en el valor viejo**. |
| `RN-LO1: dos ingresos del mismo código de lote a distinto costo generan dos lotes` | Dos compras con `codigo_lote = 'L-993'` a $100 y $130 → **dos filas** en `lotes`, con sus costos respectivos. |
| `RN-LO2: sin fecha de vencimiento no se confirma` | Producto con `controla_vencimiento = true` y un ítem sin `fecha_vencimiento` → `confirmar_compra` falla con `EXPIRY_REQUIRED`. |
| `RN-LO3: el producto sin control de lote genera un lote genérico` | Producto con `controla_lote = false`: confirmar sin `codigo_lote` funciona, el lote creado tiene `codigo_lote` y `fecha_vencimiento` en `NULL`, y el movimiento tiene `lote_id` **no nulo**. |
| `RN-MV7: la operación es atómica` | Compra de 3 ítems donde el **tercero** es de un producto inactivo → `confirmar_compra` falla con `PRODUCT_INACTIVE`, y **no quedó ningún lote ni ningún movimiento** de los dos primeros. Verificá contando filas antes y después. |
| `RN-MV7: los movimientos de una compra comparten operacion_id` | Compra de 3 ítems confirmada → los 3 movimientos tienen el **mismo** `operacion_id`. |
| `RN-PRV2: un proveedor inactivo no recibe compras` | Desactivar el proveedor y confirmar → `SUPPLIER_INACTIVE`. |
| `RN-PRV3: un proveedor con compras no se borra` | `serviceDb.from("proveedores").delete().eq("id", provId)` con una compra confirmada → falla **por FK** (`23503`), no por validación de aplicación. |
| `RN-SC3: confirmar_compra no la ejecuta anon` | Lo cubre G3 solo. **No escribas este caso a mano**: verificá que el `it.each` de `grants.integration.test.ts` lo incluyó. |

**RN-MV7 es el caso más importante de la tanda.** Un RPC que valida los ítems uno por uno
dentro del bucle deja los dos primeros lotes creados si el tercero falla, salvo que todo corra
en una transacción. En PL/pgSQL corre en una sola por defecto — el test es lo que lo confirma,
y lo que detecta si alguien mete un `COMMIT` o un bloque `EXCEPTION` que se coma el error.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CM1 | Lotes y movimientos se crean al confirmar, no en el borrador. | `it('RN-CM1: el borrador no mueve existencias', …)` |
| RN-CM4 | No se carga dos veces la misma factura del mismo proveedor. → `409 SUPPLIER_INVOICE_DUPLICATE` | `it('RN-CM4: el comprobante del proveedor no se carga dos veces', …)` |
| RN-CM5 | Confirmar actualiza `costo_reposicion` sin tocar los movimientos anteriores. | `it('RN-CM5: la compra actualiza el costo de reposición sin tocar los movimientos', …)` |
| RN-LO1 | Dos ingresos del mismo `codigo_lote` a distinto costo generan dos lotes. | `it('RN-LO1: dos ingresos del mismo código de lote a distinto costo generan dos lotes', …)` |
| RN-LO2 | Si el producto controla vencimiento, ningún lote suyo lo tiene nulo. → `422 EXPIRY_REQUIRED` | `it('RN-LO2: sin fecha de vencimiento no se confirma', …)` |
| RN-LO3 | Con `controla_lote = false` cada compra crea un lote genérico y hay un solo camino de descuento. | `it('RN-LO3: el producto sin control de lote genera un lote genérico', …)` |
| RN-MV7 | Los movimientos de una operación comparten `operacion_id` y transacción; si uno falla, no queda ninguno. | `it('RN-MV7: la operación es atómica', …)` |
| RN-PRV2 | Un proveedor inactivo no recibe compras. → `422 SUPPLIER_INACTIVE` | `it('RN-PRV2: un proveedor inactivo no recibe compras', …)` — cierra lo que C1·T5 dejó parcial |
| RN-PRV3 | Un proveedor con compras no se borra. → `409 SUPPLIER_IN_USE` | `it('RN-PRV3: un proveedor con compras no se borra', …)` — **cierra la fila que C1·T5 dejó PENDIENTE** |

## 4. Orden de trabajo

1. Escribí `20260908000003_comercial_compras.sql` (con marca) y aplicala.
2. **Escribí `compras.integration.test.ts` y corrélo.** Los casos de DDL (RN-CM4, RN-PRV3)
   tienen que pasar ya; los de RPC tienen que fallar con "no se encontró la función
   `confirmar_compra`".
3. Escribí `20260908000004_comercial_confirmar_compra_rpc.sql` (con marca y `NOTIFY`) y
   aplicala.
4. Corré los tests: todos en verde.
5. **Verificá RN-MV7 por mutación:** envolvé el bucle del RPC en un bloque
   `BEGIN … EXCEPTION WHEN OTHERS THEN NULL; END`, corré el test de atomicidad, confirmá que se
   pone **rojo** porque quedaron lotes huérfanos, y sacalo. Reportá que lo hiciste.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`, **incluida RN-PRV3, que pasa de
   `PENDIENTE` a ✅**.

## 5. Definición de hecho

```bash
# 1. Las seis columnas de configuracion_tenant, con sus defaults
psql "$DATABASE_URL" -c "SELECT column_name, column_default, is_nullable
  FROM information_schema.columns WHERE table_name='configuracion_tenant'
  AND column_name IN ('iva_compras_es_costo','dias_alerta_vencimiento',
  'tolerancia_rendimiento_porcentaje','tolerancia_diferencia_arqueo',
  'permitir_venta_sin_existencia','exigir_receta_bloqueante');"
# → las seis, is_nullable = NO. iva_compras_es_costo default = true (decisión P-05)

# 2. El ÚNICO CASCADE del módulo es compras_items.compra_id
psql "$DATABASE_URL" -c "SELECT conname, confdeltype FROM pg_constraint
  WHERE contype='f' AND conrelid::regclass::text IN
  ('lotes','movimientos_stock','existencias_lote','compras','compras_items',
   'productos','proveedores','producto_conversiones','familias_producto');"
# → confdeltype = 'c' (cascade) SOLO en la FK de compras_items→compras y en las
#   de tenant_id→tenants. Todo lo demás 'r' (restrict) o 'n' (set null).

# 3. El RPC existe con la firma correcta y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, pg_get_function_identity_arguments(oid),
  has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE proname='confirmar_compra';"
# → confirmar_compra(uuid, uuid, uuid), anon = f

# 4. TODA consulta del RPC filtra por p_tenant_id
grep -c "p_tenant_id" supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
grep -c "WHERE" supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
# → el primer número tiene que ser >= al segundo. Si hay un WHERE de más,
#   encontralo y verificá que sea sobre una tabla sin tenant_id.

# 5. Las dos migraciones llevan su marca y la del RPC su NOTIFY
head -1 supabase/migrations/20260908000003_comercial_compras.sql
head -1 supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
tail -3 supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
# → "-- @modulo: comercial" en las dos; "NOTIFY pgrst, 'reload schema';" al final del RPC

# 6. Los tests pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts tests/integration/compras.integration.test.ts
# → "N passed", "0 skipped"

# 7. G3 descubrió el RPC nuevo sin que nadie tocara el guardrail
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con 8 casos e incluye confirmar_compra

# 8. Suites completas
npm test && npm run typecheck
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
