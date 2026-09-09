# ETAPA C1 · TANDA 4/5 — CRUD de productos, familias y conversiones
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C1·T3 está en verde (`npm test` + `npm run typecheck` +
> `npm run test:integration` con 0 skipped en `catalogo-comercial`, `rls` y `aislamiento-api`).
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `CLAUDE.md` | Regla 3 (capas Controller → Service → DB) y la sección "Aislamiento explícito en el camino de la API". |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.1 | El enunciado exacto de RN-PR2, PR3, PR5, PR9, PR10. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | **El patrón a copiar para el Service.** Es el CRUD más limpio del repo: `toPublic()`, pre-query de unicidad, `getServiceDb()`, `.eq("tenant_id", ctx.tenantId)` en cada consulta, `recordAudit()` al final de cada escritura, `buscarPaginado` con `count: "exact"`. Copiá su estructura, sus nombres y su forma de manejar errores. |
| `supabase/functions/api/src/modules/servicios/servicios.controller.ts` | **El patrón a copiar para el Controller.** Zod con `safeParse`, `DomainError(VALIDATION_ERROR, 422, …, parsed.error.issues)`, `callerCtx(c)` con `CALLER_UNRESOLVED`, `c.json(ok(...), 200\|201)`. |
| `supabase/functions/api/src/modules/servicios/servicios.schemas.ts` | **El patrón a copiar para los Schemas.** |
| `supabase/functions/api/src/modules/historial/historial.controller.ts` líneas 19-27 | **El patrón de permisos por método:** un `sharedMiddleware` con el permiso de lectura, y un `const manageX = requirePermission("manage_…")` que se aplica solo a las rutas de escritura. Es exactamente lo que necesitás acá. |
| `tests/unit/servicios.service.test.ts` | **El patrón a copiar para los tests unitarios.** Mock de `getServiceDb` y `recordAudit`, `buildDbChain()` como helper. |
| `supabase/functions/api/src/main.ts` | Cómo se registran las rutas y en qué orden. |
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

1. `supabase/functions/api/src/modules/productos/productos.schemas.ts`
2. `supabase/functions/api/src/modules/productos/productos.service.ts`
3. `supabase/functions/api/src/modules/productos/productos.controller.ts`
4. `tests/unit/productos.service.test.ts`
5. `tests/unit/productos.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | Tres `app.route(...)` — ver 2.5. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Las filas de RN-PR2, PR3, PR5, PR9, PR10. |

**Un solo directorio de módulo para las tres entidades.** Productos, familias y conversiones
comparten el permiso `manage_products` y el módulo de auditoría `products`: son un dominio, no
tres. Es el mismo criterio con el que `historial/` exporta tres routers y `catalogos/` exporta
tres.

**Proveedores NO va acá.** Tiene su propio permiso (`manage_suppliers`) y su propio módulo de
auditoría (`suppliers`), y va en C1·T5.

## 2. Especificación exacta

### 2.1. `productos.schemas.ts`

DTOs en **camelCase**; el mapeo snake↔camel lo hace el Service.

```ts
import { z } from "zod";

// Valores del ENUM condicion_venta_producto (20260901000001_comercial_enums.sql).
export const CONDICION_VENTA_VALUES = [
  "libre", "bajo_receta", "bajo_receta_archivada", "uso_profesional",
] as const;

// RN-PR4: alícuotas admitidas. El CHECK de la base es la defensa real; esto
// devuelve un 422 legible en vez de un 500 con el mensaje de Postgres.
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;

export const CrearProductoSchema = z.object({
  codigo:                    z.string().trim().min(1).max(50),
  nombre:                    z.string().trim().min(3).max(150),
  descripcion:               z.string().max(500).nullish(),
  familiaId:                 z.string().uuid().nullish(),
  unidadMedidaId:            z.string().uuid(),
  marca:                     z.string().max(80).nullish(),
  alicuotaIva:               z.number().refine((v) => (ALICUOTAS_IVA as readonly number[]).includes(v),
                               "La alícuota debe ser 0, 10.50, 21 o 27").default(21),
  condicionVenta:            z.enum(CONDICION_VENTA_VALUES).default("libre"),
  controlaLote:              z.boolean().default(true),
  controlaVencimiento:       z.boolean().default(true),
  vidaUtilPostAperturaDias:  z.number().int().min(1).max(3650).nullish(),
  precioVenta:               z.number().nonnegative().nullish(),
  costoReposicion:           z.number().nonnegative().nullish(),
  margenObjetivo:            z.number().min(0).max(999.99).nullish(),
  stockMinimo:               z.number().nonnegative().nullish(),
  esVendible:                z.boolean().default(true),
  esConsumibleClinico:       z.boolean().default(false),
  requiereFrio:              z.boolean().default(false),
  trazable:                  z.boolean().default(false),
  codigoBarras:              z.string().trim().max(50).nullish(),
});

export const ActualizarProductoSchema = CrearProductoSchema.partial();
export const CambiarEstadoProductoSchema = z.object({ activo: z.boolean() });

export const ListarProductosQuerySchema = z.object({
  search:    z.string().trim().min(1).max(100).optional(),
  familiaId: z.string().uuid().optional(),
  activo:    z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  vendible:  z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

export const CrearFamiliaSchema = z.object({
  nombre:       z.string().trim().min(2).max(100),
  unidadBaseId: z.string().uuid(),   // RN-PR8: obligatorio, sin default
});
export const ActualizarFamiliaSchema = CrearFamiliaSchema.partial();

export const CrearConversionSchema = z.object({
  productoOrigenId:        z.string().uuid(),
  productoDestinoId:       z.string().uuid(),
  factorTeorico:           z.number().positive(),
  mermaEsperadaPorcentaje: z.number().min(0).max(100).default(0),
});
export const ActualizarConversionSchema = CrearConversionSchema.partial();
```

**No pongas `tenantId` en ningún schema.** Si aparece en un DTO, está mal: el tenant sale del
JWT vía `tenantContext` y ningún handler lo lee del body.

### 2.2. `productos.service.ts` — las cinco RN que implementa

Tres objetos exportados: `ProductoService`, `FamiliaService`, `ConversionService`. Cada uno con
`crear`, `actualizar`, `cambiarEstado`, `obtenerPorId`, `buscarPaginado`, copiando la forma de
`ServicioService`.

**Toda consulta lleva `.eq("tenant_id", ctx.tenantId)`.** Corre con `getServiceDb()`
(service role), que bypasea RLS: el filtro es el único aislamiento que hay. También las
consultas que filtran por un id que *parece* seguro porque salió de una fila ya validada.

**RN-PR2 — un producto no se borra.**
No existe método `eliminar` ni ruta `DELETE`. La baja es lógica (`cambiarEstado(id, false)`).
Si igual llegara un `DELETE` a la base, el `ON DELETE RESTRICT` de `movimientos_stock` (C2) lo
frena. → `409 PRODUCT_IN_USE` si alguna vez se intenta.

**RN-PR3 — un producto inactivo no opera.**
`cambiarEstado(id, false)` funciona siempre: dar de baja un producto **con existencia** está
permitido, porque el motivo típico es dejar de comprarlo. Lo que no está permitido es
*operarlo*: el guard `assertProductoOperable(productoId, tenantId)` lo verifica y lo van a
llamar los RPC de C2 en adelante. Acá se escribe el guard y su test; su aplicación real llega
con la primera compra.

```ts
/** RN-PR3: un producto inactivo no se vende, no se compra, no se consume y no se fracciona. */
async function assertProductoOperable(productoId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("productos")
    .select("id, activo")
    .eq("id", productoId)
    .eq("tenant_id", tenantId)   // service role: sin esto, el producto de otra clínica pasa
    .maybeSingle();

  if (!data) {
    throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado en este tenant");
  }
  if (!(data as { activo: boolean }).activo) {
    throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto está inactivo");
  }
}
```

Exportala: los services de C2 a C6 la reusan y **no la reimplementan**.

**RN-PR5 — la unidad de medida es inmutable tras el primer movimiento.**
Cambiar de "unidad" a "kg" con existencias reinterpreta silenciosamente todo el historial.
En `actualizar`, si el DTO trae `unidadMedidaId` distinto del actual:

```ts
const { count } = await db
  .from("movimientos_stock")
  .select("id", { count: "exact", head: true })
  .eq("tenant_id", ctx.tenantId)
  .eq("producto_id", id);

if ((count ?? 0) > 0) {
  throw new DomainError(
    ErrorCode.UNIT_IMMUTABLE, 409,
    "No se puede cambiar la unidad de medida de un producto que ya tiene movimientos",
  );
}
```

**La tabla `movimientos_stock` no existe hasta C2·T1.** En C1 la consulta va a fallar contra la
base real. Escribila igual, con este comentario arriba:

```ts
// La tabla llega en C2·T1. Hasta entonces esta consulta no tiene contra qué correr
// en integración; el unit test la mockea con y sin movimientos para cubrir las dos
// ramas de RN-PR5. Mismo criterio que el guard de turnos futuros de
// ServicioService.cambiarEstado, que se escribió en E4 con la tabla `turnos` vacía.
```

Es exactamente lo que ya hizo `ServicioService.cambiarEstado` con `turnos` en la Etapa 4:
leé ese comentario en `servicios.service.ts` y copiá el criterio.

**RN-PR9 — un producto sin `precio_venta` no se puede vender.**
**RN-PR10 — un producto con `es_vendible = false` no se puede vender.**

Los dos son guards que consume la venta de C4. Se escriben acá en una sola función exportada:

```ts
/** RN-PR9 y RN-PR10: guard de vendibilidad. Lo llama el RPC de venta en C4. */
async function assertProductoVendible(productoId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("productos")
    .select("id, activo, es_vendible, precio_venta")
    .eq("id", productoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado en este tenant");
  const p = data as { activo: boolean; es_vendible: boolean; precio_venta: number | null };

  if (!p.activo)       throw new DomainError(ErrorCode.PRODUCT_INACTIVE,      422, "El producto está inactivo");
  if (!p.es_vendible)  throw new DomainError(ErrorCode.PRODUCT_NOT_SELLABLE,  422, "El producto no es vendible al público");
  if (p.precio_venta === null)
    throw new DomainError(ErrorCode.PRODUCT_WITHOUT_PRICE, 422, "El producto no tiene precio de venta");
}
```

El listado de venta también los filtra (`es_vendible = true AND precio_venta IS NOT NULL`),
pero **el filtro del listado no es la regla**: la regla es el guard, porque el id puede llegar
por API sin pasar por el buscador.

**RN-PR1 y RN-PR12 — pre-query de unicidad.**
La base ya las hace cumplir (T3). El Service igual hace la pre-query, con el mismo criterio que
`ServicioService.crear`: convierte un `23505` con el mensaje de Postgres en un
`409 PRODUCT_CODE_DUPLICATE` / `409 PRODUCT_NAME_DUPLICATE` legible. **La pre-query no
reemplaza al índice**: entre la consulta y el `INSERT` hay una ventana, y el índice es lo que
la cierra. Capturá también el `23505` del `INSERT` y mapealo al mismo `DomainError`.

**Auditoría.** Toda escritura de los tres services llama a `recordAudit()` con
`module: "products"` y `action: "CREATE" | "UPDATE"`. El valor `products` existe en el ENUM
desde C1·T1 y en el tipo `AuditModule` desde la misma tanda; el guardrail G2 lo verifica.

### 2.3. `productos.controller.ts`

Tres routers exportados: `productosRouter`, `familiasRouter`, `conversionesRouter`.

Middleware, copiando el patrón de `historial.controller.ts` líneas 19-27:

```ts
// Lectura: view_stock. El veterinario y la recepcionista lo tienen.
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("stock"),
  requirePermission("view_stock"),
];

// Escritura: manage_products, que solo tiene el admin (§8.2).
const manageProducts = requirePermission("manage_products");
```

```ts
export const productosRouter = new Hono();
productosRouter.use("/*", ...sharedMiddleware);

productosRouter.get("/", async (c) => { … });              // view_stock
productosRouter.get("/:id", async (c) => { … });           // view_stock
productosRouter.post("/", manageProducts, async (c) => { … });          // 201
productosRouter.put("/:id", manageProducts, async (c) => { … });        // 200
productosRouter.patch("/:id/estado", manageProducts, async (c) => { … });// 200
```

Ídem `familiasRouter` y `conversionesRouter`.

**`requireModule("stock")` va en los tres.** Un tenant que no contrató `stock` recibe
`403 MODULE_NOT_LICENSED` en todo el módulo, incluidas las lecturas.

### 2.4. Endpoints

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/v1/productos` | `view_stock` | `ok(items, { page, limit, total })` |
| GET | `/api/v1/productos/:id` | `view_stock` | `ok(producto)` · 404 `PRODUCT_NOT_FOUND` |
| POST | `/api/v1/productos` | `manage_products` | 201 `ok(producto)` |
| PUT | `/api/v1/productos/:id` | `manage_products` | 200 `ok(producto)` |
| PATCH | `/api/v1/productos/:id/estado` | `manage_products` | 200 `ok(producto)` |
| GET | `/api/v1/familias-producto` | `view_stock` | listado |
| GET | `/api/v1/familias-producto/:id` | `view_stock` | 404 `FAMILY_NOT_FOUND` |
| POST/PUT/PATCH | `/api/v1/familias-producto[/:id][/estado]` | `manage_products` | |
| GET | `/api/v1/producto-conversiones` | `view_stock` | listado, filtrable por `productoOrigenId` |
| GET | `/api/v1/producto-conversiones/:id` | `view_stock` | 404 `CONVERSION_NOT_FOUND` |
| POST/PUT/PATCH | `/api/v1/producto-conversiones[/:id][/estado]` | `manage_products` | 409 `CONVERSION_CYCLE` si el trigger rebota |

El `RAISE EXCEPTION 'CONVERSION_CYCLE'` del trigger llega al Service como un error de
PostgREST. Mapealo a `DomainError(ErrorCode.CONVERSION_CYCLE, 409, …)` buscando la cadena
`CONVERSION_CYCLE` en `error.message`, igual que `guarderia.service.ts` hace en
`mapEstadiaRpcError`.

### 2.5. Rutas en `main.ts`

Importá y registrá, después del bloque de Catálogos clínicos y antes de Doctores:

```ts
import {
  productosRouter,
  familiasRouter,
  conversionesRouter,
} from "./modules/productos/productos.controller.ts";
```

```ts
// ─── Catálogo comercial (módulo vendible stock — Etapa C1) ─────────────────────
app.route("/productos", productosRouter);
app.route("/familias-producto", familiasRouter);
app.route("/producto-conversiones", conversionesRouter);
```

### 2.6. Tests

**`tests/unit/productos.service.test.ts`** — copiá el arnés de `tests/unit/servicios.service.test.ts`
(mock de `getServiceDb` y `recordAudit`, helper `buildDbChain`).

| `it()` | Caso |
|---|---|
| `RN-PR2: no existe método de borrado; la baja es lógica` | `expect((ProductoService as Record<string, unknown>).eliminar).toBeUndefined()` y `cambiarEstado(id, false)` deja `activo: false` y audita `UPDATE`. |
| `RN-PR3: un producto inactivo no opera` | `assertProductoOperable` con `activo: false` → `PRODUCT_INACTIVE`. Con `activo: true` → no lanza. Con producto de otro tenant (la consulta devuelve `null`) → `PRODUCT_NOT_FOUND`. |
| `RN-PR5: la unidad no cambia si hay movimientos` | Mock con `count: 1` → `actualizar` con `unidadMedidaId` distinto lanza `UNIT_IMMUTABLE`. Con `count: 0` → funciona. **Y con `unidadMedidaId` igual al actual y `count: 1` → funciona**: la regla es "no cambia", no "no se puede editar el producto". |
| `RN-PR9: un producto sin precio no se vende` | `assertProductoVendible` con `precio_venta: null` → `PRODUCT_WITHOUT_PRICE`. |
| `RN-PR10: un producto no vendible no se vende` | `assertProductoVendible` con `es_vendible: false` → `PRODUCT_NOT_SELLABLE`. |
| `RN-PR1: el código duplicado se rechaza con 409` | Pre-query devuelve una fila → `PRODUCT_CODE_DUPLICATE`. **Y** pre-query vacía pero el `INSERT` devuelve `23505` → el mismo `PRODUCT_CODE_DUPLICATE`, no un 500. |
| `RN-PR12: el nombre duplicado se rechaza con 409` | Ídem con `PRODUCT_NAME_DUPLICATE`. |
| `RN-SC5: toda escritura deja asiento con module products` | Las tres escrituras de cada service llaman a `recordAudit` con `module: "products"`. Y si el `INSERT` falla, `recordAudit` **no** se llamó: no queda asiento huérfano. |

**`tests/unit/productos.controller.test.ts`** — copiá el arnés de
`tests/unit/guarderia.controller.test.ts`.

| `it()` | Caso |
|---|---|
| `RN-SC1: el tenantId del body se ignora` | POST con `{ …, tenantId: "<otro>" }` → el Service recibe el tenant del JWT, no el del body. |
| `RN-SC7: las lecturas exigen view_stock` | Sin `view_stock` → 403. |
| `RN-SC7: las escrituras exigen manage_products` | Con `view_stock` pero sin `manage_products` → GET 200 y POST 403. **Este es el caso que prueba que el permiso por método funciona**: si `manage_products` se aplicara al router entero, el GET también daría 403 y el test lo detecta. |
| `RN-SC7: sin el módulo stock contratado, 403 MODULE_NOT_LICENSED` | Tenant sin `stock` habilitado → 403 con ese código, en GET y en POST. |

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-PR2 | Un producto con movimientos, lotes o líneas de venta no se elimina; la baja es lógica. → `409 PRODUCT_IN_USE` | `it('RN-PR2: no existe método de borrado; la baja es lógica', …)` |
| RN-PR3 | Un producto inactivo no se vende, no se compra, no se consume y no se fracciona; su historia sigue intacta. → `422 PRODUCT_INACTIVE` | `it('RN-PR3: un producto inactivo no opera', …)` |
| RN-PR5 | La unidad de medida no cambia después del primer movimiento. → `409 UNIT_IMMUTABLE` | `it('RN-PR5: la unidad no cambia si hay movimientos', …)` |
| RN-PR9 | Un producto sin `precio_venta` no puede incluirse en una venta. → `422 PRODUCT_WITHOUT_PRICE` | `it('RN-PR9: un producto sin precio no se vende', …)` |
| RN-PR10 | Un producto con `es_vendible = false` se rechaza si llega por API. → `422 PRODUCT_NOT_SELLABLE` | `it('RN-PR10: un producto no vendible no se vende', …)` |

RN-PR9 y RN-PR10 quedan **parcialmente** cubiertas: acá se prueba el guard con mocks, y en
C4·T2 se prueba contra una venta real. Marcalas ✅ igual — el guard es la regla — y dejá la
nota en la columna "Caso" de la matriz.

## 4. Orden de trabajo

1. **Escribí `tests/unit/productos.service.test.ts` primero y corrélo.** Tiene que fallar
   porque `productos.service.ts` no existe. Verificá que el mensaje de error es "cannot find
   module" y no un error de sintaxis del test.
2. Escribí `productos.schemas.ts`.
3. Escribí `productos.service.ts` hasta que los unit tests pasen.
4. Escribí `productos.controller.ts` y `tests/unit/productos.controller.test.ts`.
5. Registrá las tres rutas en `main.ts`.
6. `npm test && npm run typecheck` en verde.
7. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Los tests de la tanda pasan
npx vitest run tests/unit/productos.service.test.ts tests/unit/productos.controller.test.ts
# → todos passed, 0 skipped

# 2. NINGUNA consulta del módulo quedó sin filtro de tenant.
#    El guardrail estático deriva las tablas del DDL, así que las cuatro tablas
#    nuevas ya están en su alcance.
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
# → passed

# 3. Contá los filtros a mano, como control cruzado del guardrail:
grep -c 'from("productos")' supabase/functions/api/src/modules/productos/productos.service.ts
grep -c 'eq("tenant_id"' supabase/functions/api/src/modules/productos/productos.service.ts
# → el segundo número tiene que ser MAYOR O IGUAL que la suma de .from() sobre
#   tablas con tenant_id. Si hay un .from() de más, encontralo y ponele el filtro.

# 4. Ningún schema acepta tenantId
grep -n "tenantId" supabase/functions/api/src/modules/productos/productos.schemas.ts
# → sin resultados

# 5. El módulo audita con un valor que la base acepta
npx vitest run tests/unit/audit-modulo-enum.test.ts
# → passed

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
