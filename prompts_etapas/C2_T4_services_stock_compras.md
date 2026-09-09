# ETAPA C2 · TANDA 4/5 — Services y Controllers de stock y compras
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T3 en verde, con `compras.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04, D-05 | Costo efectivo vs. reposición; FEFO con override motivado. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.3, §6.4, §6.5 | RN-MV6, MV9, RN-LO4, LO5, LO7, RN-CM2, CM3. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | Tu propio Service de C1·T4: el guard `assertProductoOperable` que se reusa acá. |
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | El patrón de `.rpc()` + `mapEstadiaRpcError` para traducir el `RAISE EXCEPTION` a `DomainError`. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | `buscarPaginado` con `count: "exact"` y `range()`. |
| `CLAUDE.md` sección "Acceso a datos y rendimiento — evitar consultas N+1" | El kárdex y el listado de lotes traen datos de producto: **una sola consulta con embed**, nunca un `await` por fila. |
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

1. `supabase/functions/api/src/modules/stock/stock.schemas.ts`
2. `supabase/functions/api/src/modules/stock/stock.service.ts`
3. `supabase/functions/api/src/modules/stock/stock.controller.ts`
4. `supabase/functions/api/src/modules/compras/compras.schemas.ts`
5. `supabase/functions/api/src/modules/compras/compras.service.ts`
6. `supabase/functions/api/src/modules/compras/compras.controller.ts`
7. `tests/unit/stock.service.test.ts`
8. `tests/unit/compras.service.test.ts`
9. `tests/unit/compras.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/lotes", …)`, `app.route("/movimientos-stock", …)`, `app.route("/existencias", …)`, `app.route("/compras", …)`. |
| `tests/integration/compras.integration.test.ts` | RN-CM3 (anulación) y RN-MV9. |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"stock"` y `"compras"` a `MODULOS_COMERCIALES` (el assert de cobertura de G1). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-MV6, MV9, RN-LO4, LO5, LO7, RN-CM2, CM3. |

**No olvides el paso de `MODULOS_COMERCIALES`.** Si no agregás los dos módulos nuevos a esa
lista, el guardrail G1 los escanea igual (deriva los archivos del directorio), pero **el assert
de cobertura no los exige**: el día que el patrón de directorios cambie, los dos quedan sin red
y nadie se entera.

## 2. Especificación exacta

### 2.1. `stock.service.ts` — cinco RN, ninguna escribe existencia

**Regla que gobierna toda esta tanda:** el Service **lee** existencias para mostrar, y **nunca**
para decidir una escritura. Toda escritura de existencia va por RPC. Acá no hay ningún método
que inserte en `movimientos_stock`.

**`listarCandidatosFefo(productoId, cantidad, tenantId)` — RN-LO4, LO5, LO7.**

Devuelve los lotes elegibles ordenados por FEFO. Es la consulta que el frontend usa para
sugerir, y la misma que el RPC de venta va a replicar en C4. **Que existan las dos no es
duplicación**: la del Service alimenta la UI y la del RPC decide bajo bloqueo. Lo que no puede
pasar es que difieran en el criterio.

```ts
const { data, error } = await db
  .from("existencias_lote")
  .select(`
    lote_id, cantidad,
    lote:lotes!inner(id, codigo_lote, fecha_vencimiento, fecha_ingreso,
                     estado, costo_unitario_efectivo)
  `)
  .eq("tenant_id", tenantId)
  .eq("producto_id", productoId)
  .gt("cantidad", 0)
  .eq("lotes.estado", "disponible")                       // RN-LO7
  .or(`fecha_vencimiento.is.null,fecha_vencimiento.gte.${hoy}`, { foreignTable: "lotes" }) // RN-LO4
  .order("fecha_vencimiento", { foreignTable: "lotes", ascending: true, nullsFirst: false })
  .order("fecha_ingreso",     { foreignTable: "lotes", ascending: true })
  .order("id",                { foreignTable: "lotes", ascending: true });
```

- **RN-LO5, orden exacto:** `fecha_vencimiento` ascendente **con nulos al final**, luego
  `fecha_ingreso`, luego `id`. El tercer criterio no es opcional: sin él, dos lotes de igual
  vencimiento e igual ingreso salen en orden distinto entre ejecuciones y la sugerencia deja
  de ser reproducible.
- **RN-LO4, no es overrideable por ningún rol, incluido `admin`.** Un lote vencido no entra en
  esta lista y no hay parámetro que lo haga entrar. La única salida posible de un lote vencido
  es `merma_vencimiento`, que llega en C5.
- **RN-LO7:** un lote `bloqueado` no aparece entre los candidatos.
- **Un solo `select` con embed.** Nada de traer los lotes y después iterar pidiendo el producto:
  eso es el patrón N+1 que `CLAUDE.md` prohíbe explícitamente.

**Ojo con el embed y las FKs compuestas.** `existencias_lote.lote_id` referencia
`lotes (id, tenant_id)`: si PostgREST no resuelve la pista `lotes!inner`, embebé **por nombre de
constraint** (`existencias_lote_lote_tenant_fkey`), igual que el repo ya hace con
`usuarios_rol_tenant_fkey`. Es un costo conocido del patrón, no un bug.

**`kardexPorLote(loteId, tenantId, opts)` — RN-MV6.**

Listado paginado de `movimientos_stock` de un lote, orden `created_at` ascendente, con el saldo
acumulado. **Devuelve `costo_unitario` tal como está guardado.** No lo recalcula, no lo joinea
contra `productos.costo_reposicion`, no lo "actualiza" con nada:

```ts
// RN-MV6: el costo del movimiento es el costo EFECTIVO congelado cuando ocurrió.
// Un join a productos.costo_reposicion acá sería más corto de escribir y estaría
// mal: revaluaría hacia atrás mercadería comprada más barata e inventaría una
// ganancia que no ocurrió. El costo de reposición sirve para FIJAR PRECIOS, no
// para valuar movimientos.
```

**`valorizacionInventario(tenantId, opts)`.** Suma `existencias_lote.cantidad *
lotes.costo_unitario_efectivo` agrupado por producto. Un solo `select` con embed.

**`existenciaPorProducto(tenantId, opts)`.** Listado paginado desde `existencias_lote`
agrupado por producto, con el nombre del producto embebido.

### 2.2. `compras.service.ts` — RN-CM2 y RN-CM3

CRUD del borrador (`crear`, `agregarItem`, `quitarItem`, `actualizarItem`, `obtenerPorId`,
`buscarPaginado`) + `confirmar` (llama al RPC) + `anular`.

**RN-CM2 — una compra confirmada no se edita.** Todo método que modifique la compra o sus ítems
empieza con el mismo guard:

```ts
/** RN-CM2: una compra confirmada no se edita. Se anula con contra-asientos. */
async function assertBorrador(compraId: string, tenantId: string) {
  const db = getServiceDb();
  const { data } = await db
    .from("compras")
    .select("id, estado")
    .eq("id", compraId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Compra no encontrada en este tenant");
  if ((data as { estado: string }).estado !== "borrador") {
    throw new DomainError(
      ErrorCode.PURCHASE_ALREADY_CONFIRMED, 409,
      "Una compra confirmada no se edita: se anula con contra-asientos",
    );
  }
}
```

**RN-CM3 — anulación solo sin salidas.** Va en un RPC nuevo, `anular_compra`, no en el Service:
mira existencias y escribe movimientos, así que por definición es transaccional.

Migración `20260908000005_comercial_anular_compra_rpc.sql`, con marca y `NOTIFY`:

```
anular_compra(p_tenant_id UUID, p_usuario_id UUID, p_compra_id UUID, p_motivo TEXT)
RETURNS TABLE (compra_id UUID, operacion_id UUID, movimientos_generados INTEGER)
```

```
BEGIN
  SELECT * INTO v_compra FROM compras
   WHERE id = p_compra_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                        THEN RAISE EXCEPTION 'PURCHASE_NOT_FOUND'; END IF;
  IF v_compra.estado <> 'confirmada'  THEN RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED'; END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- RN-CM3: si CUALQUIER lote de esta compra ya tuvo una salida, la corrección
  -- es un ajuste motivado, no una anulación. Anular con salidas dejaría el
  -- inventario en negativo o borraría una venta real.
  IF EXISTS (
    SELECT 1
    FROM lotes l
    JOIN movimientos_stock m ON m.lote_id = l.id AND m.tenant_id = p_tenant_id
    WHERE l.tenant_id = p_tenant_id
      AND l.compra_item_id IN (SELECT id FROM compras_items
                                WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id)
      AND signo_movimiento(m.tipo) = -1
  ) THEN RAISE EXCEPTION 'PURCHASE_HAS_EXITS'; END IF;

  -- RN-MV9: se COMPENSA con contra-asientos. No se borra ni el movimiento
  -- original ni el lote: quedan visibles en el kárdex, con el asiento nuevo al lado.
  v_operacion := gen_random_uuid();
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  SELECT p_tenant_id, v_operacion, 'salida_ajuste', m.producto_id, m.lote_id,
         m.cantidad, m.costo_unitario, m.costo_total, p_motivo, p_usuario_id
  FROM movimientos_stock m
  WHERE m.tenant_id = p_tenant_id AND m.tipo = 'entrada_compra'
    AND m.compra_item_id IN (SELECT id FROM compras_items
                              WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id);
  GET DIAGNOSTICS v_movs = ROW_COUNT;

  UPDATE compras SET estado='anulada', observaciones = p_motivo, updated_at = now()
   WHERE id = p_compra_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (...) VALUES (..., 'UPDATE', 'purchases', ...);
  RETURN QUERY SELECT p_compra_id, v_operacion, v_movs;
END;
```

**El contra-asiento va SIN `compra_item_id`.** El CHECK de coherencia documental exige que
`entrada_compra` lo lleve, pero el contra-asiento es `salida_ajuste`, que no admite documento.
Si lo copiás del original, el `INSERT` falla contra el CHECK y el síntoma engaña.

### 2.3. Controllers y rutas

**`stock.controller.ts`** — tres routers: `lotesRouter`, `movimientosRouter`,
`existenciasRouter`. Middleware: `tenantContext, requireActiveTenant, requireModule("stock"),
requirePermission("view_stock")`. **Todo de lectura**: esta tanda no expone ninguna escritura de
existencia.

**`compras.controller.ts`** — `comprasRouter`. Middleware:
`tenantContext, requireActiveTenant, requireModule("stock"), requirePermission("manage_suppliers")`.

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/v1/lotes` | Filtros: `productoId`, `estado`, `venceAntesDe`, `conExistencia`. |
| GET | `/api/v1/lotes/:id/kardex` | Paginado, con saldo acumulado. |
| GET | `/api/v1/lotes/candidatos` | FEFO: `?productoId=…&cantidad=…` |
| GET | `/api/v1/movimientos-stock` | Filtros: `loteId`, `productoId`, `tipo`, `desde`, `hasta`, `operacionId`. |
| GET | `/api/v1/existencias` | Por producto, paginado. |
| GET | `/api/v1/existencias/valorizacion` | Suma `cantidad × costo_unitario_efectivo`. |
| GET/POST/PUT | `/api/v1/compras[/:id]` | Borrador. |
| POST | `/api/v1/compras/:id/items` · DELETE `/items/:itemId` | RN-CM2: rechaza si no es borrador. |
| POST | `/api/v1/compras/:id/confirmar` | Llama al RPC `confirmar_compra`. |
| POST | `/api/v1/compras/:id/anular` | Llama al RPC `anular_compra`. Body: `{ motivo }`. |

**No hay ninguna ruta de escritura sobre `movimientos_stock` ni `existencias_lote`.** Si te dan
ganas de agregar un `POST /movimientos-stock` "para cargar el stock inicial", **no lo hagas**:
eso va a ser `ajustar_existencia` en C5, con motivo obligatorio.

### 2.4. Tests

**`tests/unit/stock.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-LO5: FEFO ordena por vencimiento, ingreso e id` | Mock con lotes de `2026-03-01`, `2026-01-15` y `null` → el primero de la lista es el de enero y el `null` queda **último**. Dos lotes de igual vencimiento e igual ingreso → el orden es estable entre dos llamadas. |
| `RN-LO4: un lote vencido no es candidato, para ningún rol` | Mock con un lote vencido → no aparece. Repetí el caso con `callerRole: "admin"` y verificá que **tampoco** aparece: no hay override. |
| `RN-LO7: un lote bloqueado no es candidato` | Mock con `estado: "bloqueado"` → no aparece. |
| `RN-MV6: el kárdex devuelve el costo guardado` | Mock donde `movimientos_stock.costo_unitario` es 100 y `productos.costo_reposicion` es 130 → el kárdex devuelve **100**. |
| `RN-MV6: cambiar el costo de reposición no altera el kárdex` | Dos llamadas al kárdex con `costo_reposicion` distinto entre medio → el mismo resultado. |
| `no hay N+1 en el listado de candidatos` | El mock cuenta las llamadas a `.from()`: **una sola** para N lotes. |

**`tests/unit/compras.service.test.ts`:** RN-CM2 con las cuatro rutas de edición
(`agregarItem`, `quitarItem`, `actualizarItem`, `actualizar`) sobre una compra confirmada →
las cuatro lanzan `PURCHASE_ALREADY_CONFIRMED`. Probá **las cuatro**: un guard puesto en tres
de cuatro pasa un test que solo prueba una.

**En `tests/integration/compras.integration.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-CM3: anular sin salidas genera contra-asientos` | Confirmar una compra de 2 ítems, anularla con motivo → 2 movimientos `salida_ajuste` nuevos, la existencia volvió a cero, la compra quedó `anulada`, **y los `entrada_compra` originales siguen en la tabla**. |
| `RN-CM3: anular con salidas falla` | Confirmar, generar una salida del lote, anular → `PURCHASE_HAS_EXITS`. La compra sigue `confirmada`. |
| `RN-CM3: anular sin motivo falla` | Sin `motivo` y con `motivo: "error"` (5 caracteres) → `REASON_REQUIRED` en los dos casos. |
| `RN-MV9: nada se borra, se compensa` | Después de anular, contar `movimientos_stock` del lote → **4** (2 entradas + 2 contra-asientos), no 0. |

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-MV6 | El costo se guarda, no se recalcula: cambiar `costo_reposicion` no altera lo registrado. | `it('RN-MV6: el kárdex devuelve el costo guardado', …)` |
| RN-MV9 | Una operación registrada se revierte con contra-asientos visibles, no borrando. | `it('RN-MV9: nada se borra, se compensa', …)` |
| RN-LO4 | Prohibido despachar vencido. **No overrideable por ningún rol, incluido admin.** → `422 BATCH_EXPIRED` | `it('RN-LO4: un lote vencido no es candidato, para ningún rol', …)` |
| RN-LO5 | FEFO determinístico: vencimiento asc con nulos al final, luego ingreso, luego id. | `it('RN-LO5: FEFO ordena por vencimiento, ingreso e id', …)` |
| RN-LO7 | Un lote bloqueado no se despacha. → `422 BATCH_BLOCKED` | `it('RN-LO7: un lote bloqueado no es candidato', …)` |
| RN-CM2 | Una compra confirmada no se edita. → `409 PURCHASE_ALREADY_CONFIRMED` | `it('RN-CM2: una compra confirmada no se edita', …)` |
| RN-CM3 | Anulación solo si ningún lote tuvo salidas. → `409 PURCHASE_HAS_EXITS` | `it('RN-CM3: anular con salidas falla', …)` |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo por módulo inexistente.
2. `stock.schemas.ts` → `stock.service.ts` → `stock.controller.ts`.
3. `20260908000005_comercial_anular_compra_rpc.sql` (con marca y `NOTIFY`).
4. `compras.schemas.ts` → `compras.service.ts` → `compras.controller.ts`.
5. Rutas en `main.ts`.
6. Casos de integración de RN-CM3 y RN-MV9.
7. **Agregá `"stock"` y `"compras"` a `MODULOS_COMERCIALES` en el guardrail G1.**
8. `npm test && npm run typecheck && npm run test:integration`.
9. Filas en `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Ningún service del módulo escribe existencias_lote ni movimientos_stock
grep -rn 'from("existencias_lote")' supabase/functions/api/src/modules/ | grep -E '\.(update|insert|delete|upsert)\('
grep -rn 'from("movimientos_stock")' supabase/functions/api/src/modules/ | grep -E '\.(update|insert|delete|upsert)\('
# → SIN RESULTADOS en los dos. Toda escritura va por RPC.

# 2. No hay N+1: ningún await a la base dentro de un map/for sobre un listado
grep -n -A3 -E '\.(map|forEach)\(' supabase/functions/api/src/modules/stock/stock.service.ts | grep -n "await db"
# → sin resultados

# 3. G1 exige cobertura de los dos módulos nuevos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
# → passed, y el it.each de cobertura corre con 4 módulos
#   (productos, proveedores, stock, compras)

# 4. Los tests de la tanda
npx vitest run tests/unit/stock.service.test.ts tests/unit/compras.service.test.ts \
  tests/unit/compras.controller.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/compras.integration.test.ts
# → todos passed, 0 skipped

# 5. G3 descubrió anular_compra
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con 9 casos

# 6. Suites completas
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
