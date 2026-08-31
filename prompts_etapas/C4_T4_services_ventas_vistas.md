# ETAPA C4 · TANDA 4/5 — Services, Controllers, rutas y vistas de venta
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T3 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 | `v_items_vendidos` y `v_margen_venta`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §8.2 decisión 3 | Por qué la recepcionista maneja caja pero **no** tiene `view_sales`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-08 | La cuenta corriente reservada y por qué no rompe el arqueo. |
| `supabase/functions/api/src/modules/caja/caja.service.ts` | Tu propio Service de C3·T3: `mapCajaRpcError` y la forma de llamar RPCs. |
| `CLAUDE.md` sección de N+1 | El listado de ventas trae cliente, usuario y sesión: **una** consulta con embed. |
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

1. `supabase/migrations/20260922000004_comercial_vistas_venta.sql`
2. `supabase/functions/api/src/modules/ventas/ventas.schemas.ts`
3. `supabase/functions/api/src/modules/ventas/ventas.service.ts`
4. `supabase/functions/api/src/modules/ventas/ventas.controller.ts`
5. `tests/unit/ventas.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/ventas", ventasRouter);` |
| `tests/unit/ventas.service.test.ts` | RN-MV6 y el listado filtrado por usuario. |
| `tests/unit/caja.service.test.ts` | **RN-CJ3**: la venta en cuenta corriente no altera el arqueo. |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"ventas"` a `MODULOS_COMERCIALES`. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-CJ3, RN-MV6 (parte de ventas). |

`ventas.calculo.ts` ya existe desde C4·T2. **No lo reescribas**: importalo desde el Service.

## 2. Especificación exacta

### 2.1. Las dos vistas

```sql
-- Es TODO el costo de no fusionar los catálogos de productos y servicios (D-10):
-- los reportes de "lo más vendido" atraviesan los dos, y se resuelven con este
-- UNION ALL en vez de con una tabla ancha llena de NULLs.
CREATE OR REPLACE VIEW public.v_items_vendidos AS
SELECT vi.tenant_id, vi.venta_id, v.numero_operacion, v.created_at AS vendido_at,
       v.estado AS venta_estado, v.usuario_id,
       'producto'::tipo_item_venta AS tipo_item,
       vi.producto_id AS item_id, p.nombre AS item_nombre, p.familia_id,
       vi.cantidad, vi.precio_unitario, vi.neto_unitario, vi.iva_unitario,
       vi.importe_total, vi.costo_unitario_efectivo
FROM ventas_items vi
JOIN ventas v    ON v.id = vi.venta_id  AND v.tenant_id = vi.tenant_id
JOIN productos p ON p.id = vi.producto_id AND p.tenant_id = vi.tenant_id
WHERE vi.tipo_item = 'producto'
UNION ALL
SELECT vi.tenant_id, vi.venta_id, v.numero_operacion, v.created_at,
       v.estado, v.usuario_id,
       'servicio'::tipo_item_venta,
       vi.servicio_id, s.nombre, NULL::uuid,
       vi.cantidad, vi.precio_unitario, vi.neto_unitario, vi.iva_unitario,
       vi.importe_total, NULL::numeric
FROM ventas_items vi
JOIN ventas v     ON v.id = vi.venta_id AND v.tenant_id = vi.tenant_id
JOIN servicios s  ON s.id = vi.servicio_id AND s.tenant_id = vi.tenant_id
WHERE vi.tipo_item = 'servicio';

-- El margen usa el costo EFECTIVO GUARDADO en la línea. Nunca recalcula el costo
-- ni lo joinea contra productos.costo_reposicion: eso revaluaría hacia atrás
-- mercadería comprada más barata e inventaría una ganancia que no ocurrió (D-04).
CREATE OR REPLACE VIEW public.v_margen_venta AS
SELECT iv.tenant_id, iv.venta_id, iv.vendido_at, iv.tipo_item, iv.item_id,
       iv.item_nombre, iv.cantidad, iv.importe_total,
       iv.neto_unitario * iv.cantidad                            AS neto_total,
       COALESCE(iv.costo_unitario_efectivo, 0) * iv.cantidad     AS costo_total,
       (iv.neto_unitario * iv.cantidad)
         - (COALESCE(iv.costo_unitario_efectivo, 0) * iv.cantidad) AS margen
FROM v_items_vendidos iv
WHERE iv.venta_estado = 'registrada';

COMMENT ON VIEW public.v_margen_venta IS
  'Margen por línea, usando el costo efectivo GUARDADO en ventas_items. No recalcula el costo contra productos.costo_reposicion: el margen histórico se valúa con lo que la mercadería costó, no con lo que costaría reponerla hoy (D-04, RN-MV6).';
```

Las vistas **heredan la RLS de sus tablas base**, así que no llevan política propia.

### 2.2. `ventas.service.ts`

| Método | Notas |
|---|---|
| `registrar(dto, ctx)` | Llama a `registrar_venta` con `p_tenant_id: ctx.tenantId`. Arma `p_items` y `p_pagos` como JSONB. |
| `anular(ventaId, dto, ctx)` | Llama a `anular_venta`. |
| `obtenerPorId(id, ctx)` | Detalle con ítems, pagos y cliente **en una consulta con embed**. |
| `buscarPaginado(opts, ctx)` | Ver abajo: el filtro por `view_sales`. |
| `resumenPorSesion(sesionId, ctx)` | Totales de la sesión desde `v_items_vendidos`. |
| `margenPorProducto(opts, ctx)` | Desde `v_margen_venta`. |

**El listado depende del permiso, no solo del tenant.** §8.2 decisión 3: la recepcionista ve
**las ventas que registró ella**; auditar el turno de otro es `view_sales`, que va solo al admin.

```ts
/**
 * §8.2: `view_sales` habilita ver las ventas de TODOS los usuarios. Sin ese
 * permiso, el listado se acota a las propias. El controller ya dejó los permisos
 * efectivos en el contexto (`c.get("permisos")`), así que esto no cuesta una
 * consulta más.
 */
let query = db.from("ventas")
  .select("*, cliente:clientes(full_name), usuario:usuarios(full_name)", { count: "exact" })
  .eq("tenant_id", ctx.tenantId);

if (!ctx.permisos.has("view_sales")) {
  query = query.eq("usuario_id", ctx.callerUserId);
}
```

`mapVentaRpcError` con la forma de `mapCajaRpcError`, cubriendo: `SALE_NOT_FOUND`,
`SALE_ALREADY_VOIDED`, `SALE_WITHOUT_ITEMS`, `PAYMENT_MISMATCH`,
`PAYMENT_REFERENCE_REQUIRED`, `CASH_SESSION_REQUIRED`, `INSUFFICIENT_STOCK`,
`BATCH_EXPIRED`, `BATCH_BLOCKED`, `FEFO_OVERRIDE_WITHOUT_REASON`, `PRODUCT_NOT_FOUND`,
`PRODUCT_INACTIVE`, `PRODUCT_NOT_SELLABLE`, `PRODUCT_WITHOUT_PRICE`, `UNIT_NO_DECIMALS`,
`REASON_REQUIRED`. El `return` final es `INTERNAL_ERROR` con mensaje genérico.

**El Service no descuenta nada.** No hay ninguna consulta a `existencias_lote` ni ningún
`insert` a `movimientos_stock` en este archivo. Lo hace el RPC.

### 2.3. Controller y rutas

```ts
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("ventas"), requirePermission("manage_sales"),
];
const voidSales = requirePermission("void_sales");
```

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/ventas` | `manage_sales` (el Service acota por `view_sales`) |
| GET | `/api/v1/ventas/:id` | `manage_sales` |
| POST | `/api/v1/ventas` | `manage_sales` — 201 |
| POST | `/api/v1/ventas/:id/anular` | **`void_sales`** — solo el admin |
| GET | `/api/v1/ventas/reportes/margen` | `view_sales` |
| GET | `/api/v1/ventas/reportes/items-vendidos` | `view_sales` |

**No hay `PUT`, `PATCH` ni `DELETE`.** Una venta registrada no se edita (RN-VT4).

**Búsqueda de catálogo por familia (decisión P-09).** El listado de productos que alimenta la
pantalla de venta ya existe (`GET /productos?familiaId=…&search=…` de C1·T4). No agregues un
endpoint nuevo: verificá que el existente filtra por `familiaId`, por `search` sobre nombre
**y por `codigoBarras` exacto**, y agregá lo que falte a `productos.service.ts`. Un catálogo con
cientos de derivados necesita esos tres filtros desde el primer día.

### 2.4. Tests

**En `tests/unit/caja.service.test.ts` — RN-CJ3, que es la que verifica que D-08 funciona:**

| `it()` | Caso |
|---|---|
| `RN-CJ3: una venta en cuenta corriente no altera el arqueo` | Saldo inicial 1.000. Venta íntegra con `condicion_pago = 'cuenta_corriente'` y `saldo_pendiente = total` → el cálculo del teórico da **1.000** y la diferencia **0**. Es el requisito de D-08 verificado como test y no como intención: el arqueo cierra porque el medio `cuenta_corriente` tiene `afecta_arqueo = false`, no porque alguien se acordó de restarlo. |

**En `tests/unit/ventas.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-MV6: el reporte de margen usa el costo guardado` | Mock donde `ventas_items.costo_unitario_efectivo` es 100 y `productos.costo_reposicion` es 130 → el margen se calcula con **100**. Cambiar el mock de `costo_reposicion` a 200 → el margen **no cambia**. |
| `sin view_sales el listado se acota al usuario` | `ctx.permisos` sin `view_sales` → la consulta lleva `.eq("usuario_id", callerUserId)`. Con `view_sales` → **no** lo lleva. Verificalo sobre los argumentos del mock. |
| `el Service no lee existencias` | `grep` estructural: el archivo no contiene `from("existencias_lote")`. Escribilo como test para que quede en la suite. |
| `no hay N+1 en el listado` | Una sola llamada a `.from()` para N ventas con sus clientes y usuarios. |

**`tests/unit/ventas.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo `ventas` |
|---|:--:|:--:|:--:|:--:|
| `GET /ventas` | 200 | 200 | 200 | 403 `MODULE_NOT_LICENSED` |
| `POST /ventas` | 201 | 201 | 201 | 403 |
| `POST /ventas/:id/anular` | 200 | **403** | **403** | 403 |
| `GET /ventas/reportes/margen` | 200 | **403** | **403** | 403 |

Más: `RN-SC1` (el `tenantId` del body se ignora) y el test estructural de que no hay handlers
`PUT`/`PATCH`/`DELETE`.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-CJ3 | La cuenta corriente no altera el arqueo. | `it('RN-CJ3: una venta en cuenta corriente no altera el arqueo', …)` |
| RN-MV6 | El costo se guarda, no se recalcula — verificado sobre el reporte de margen. | `it('RN-MV6: el reporte de margen usa el costo guardado', …)` |
| RN-SC7 | Cada endpoint exige su permiso y su módulo. | La matriz de 2.4 |

## 4. Orden de trabajo

1. Migración de vistas (con marca), aplicada.
2. Tests unitarios primero, en rojo.
3. `ventas.schemas.ts` → `ventas.service.ts` → `ventas.controller.ts`.
4. Ruta en `main.ts`. Filtros faltantes en `productos.service.ts`.
5. `"ventas"` a `MODULOS_COMERCIALES` en G1.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Matriz.

## 5. Definición de hecho

```bash
# 1. Las vistas existen y v_margen_venta tiene su COMMENT
psql "$DATABASE_URL" -c "SELECT viewname FROM pg_views WHERE schemaname='public'
  AND viewname IN ('v_items_vendidos','v_margen_venta');"
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_margen_venta'::regclass,'pg_class');"

# 2. La vista de margen NO joinea costo_reposicion
grep -n "costo_reposicion" supabase/migrations/20260922000004_comercial_vistas_venta.sql
# → SIN RESULTADOS

# 3. El Service de ventas no toca existencias ni el libro mayor
grep -n 'existencias_lote\|movimientos_stock' supabase/functions/api/src/modules/ventas/ventas.service.ts
# → sin resultados

# 4. No hay rutas de edición de venta
grep -nE '\.(put|patch|delete)\(' supabase/functions/api/src/modules/ventas/ventas.controller.ts
# → sin resultados

# 5. La anulación exige void_sales
grep -n "void_sales" supabase/functions/api/src/modules/ventas/ventas.controller.ts
# → aparece en la ruta de anular

# 6. Tests y guardrails
npx vitest run tests/unit/ventas.service.test.ts tests/unit/ventas.controller.test.ts \
  tests/unit/caja.service.test.ts tests/unit/tenant-filter-guardrail.test.ts
npm test && npm run typecheck
# → todo passed, y el it.each de cobertura de G1 corre con 6 módulos
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
