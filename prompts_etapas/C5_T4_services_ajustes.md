# ETAPA C5 · TANDA 4/4 — Services, Controllers y rutas de ajustes
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5·T3 en verde, con las 7 RN-AJ en ✅.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/ventas/ventas.service.ts` | Tu Service de C4·T4: `mapVentaRpcError` y la forma de llamar RPCs. |
| `supabase/functions/api/src/modules/caja/caja.controller.ts` | El controller sin rutas de edición. |
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | Cómo se parsea el JSON que viaja después de los dos puntos en un `RAISE EXCEPTION 'CODIGO:%'` — es lo que hace falta para `COUNT_STALE`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §8.1 | `manage_stock` cubre ajustes, mermas, recuento y bloqueo de lotes. |
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

1. `supabase/functions/api/src/modules/ajustes/ajustes.schemas.ts`
2. `supabase/functions/api/src/modules/ajustes/ajustes.service.ts`
3. `supabase/functions/api/src/modules/ajustes/ajustes.controller.ts`
4. `tests/unit/ajustes.service.test.ts`
5. `tests/unit/ajustes.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/ajustes", …)`, `app.route("/recuentos", …)`, `app.route("/devoluciones", …)`. |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"ajustes"` a `MODULOS_COMERCIALES`. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | El cierre de C5. |

## 2. Especificación exacta

### 2.1. `ajustes.service.ts`

Tres objetos: `AjusteService`, `RecuentoService`, `DevolucionService`. Los tres llaman a RPCs y
**ninguno lee existencias para decidir**.

| Método | RPC |
|---|---|
| `AjusteService.registrar(dto, ctx)` | `ajustar_existencia` |
| `AjusteService.bloquearLote(loteId, dto, ctx)` | `bloquear_lote` |
| `AjusteService.desbloquearLote(loteId, dto, ctx)` | `desbloquear_lote` |
| `RecuentoService.crear` / `agregarDetalle` / `quitarDetalle` / `obtenerPorId` / `buscarPaginado` | Escritura directa al borrador, con `getServiceDb()` y filtro de tenant. |
| `RecuentoService.aplicar(recuentoId, dto, ctx)` | `aplicar_recuento` |
| `DevolucionService.registrar(dto, ctx)` | `registrar_devolucion` |

**El detalle del recuento se escribe solo en borrador.** Guard `assertRecuentoBorrador`, con la
forma de `assertBorrador` de compras. Y **`cantidad_sistema` nunca se escribe desde el
Service**: la completa el RPC al aplicar. Dejá este comentario:

```ts
// RN-AJ3: `cantidad_sistema` la completa `aplicar_recuento`, con la existencia
// del momento de aplicar. Escribirla desde acá al crear el detalle es
// exactamente el bug que la regla previene: entre el conteo y la aplicación se
// sigue vendiendo, y un ajuste calculado contra el valor viejo BORRA esas ventas.
// Si el frontend manda una cantidadSistema, se IGNORA (es informativa).
```

**`COUNT_STALE` viaja con su JSON.** El mapper tiene que parsearlo y ponerlo en `details`:

```ts
if (msg.includes("COUNT_STALE")) {
  // El RPC adjunta los lotes movidos como JSON después de los dos puntos, igual
  // que CUPO_GUARDERIA_AGOTADO adjunta los días sin cupo. Sin esto, el usuario
  // recibe "algo cambió" y no sabe qué confirmar.
  const raw = msg.slice(msg.indexOf(":", msg.indexOf("COUNT_STALE")) + 1);
  let lotes: unknown[] = [];
  try { lotes = JSON.parse(raw); } catch { /* si no parsea, se responde sin details */ }
  return new DomainError(
    ErrorCode.COUNT_STALE, 409,
    "Hubo movimientos en los lotes contados desde que se abrió el recuento",
    lotes as never,
  );
}
```

El resto del mapper cubre `COUNT_ALREADY_APPLIED`, `COUNT_WITHOUT_DETAIL`, `COUNT_NOT_FOUND`,
`REASON_REQUIRED`, `BATCH_NOT_FOUND`, `BATCH_EXPIRED`, `BATCH_BLOCKED`, `INSUFFICIENT_STOCK`,
`UNIT_NO_DECIMALS`, `RETURN_EXCEEDS_SOLD`, `RETURN_WITHOUT_SALE`, `SALE_ALREADY_VOIDED`,
`CASH_SESSION_REQUIRED`. `INTERNAL_ERROR` genérico al final.

### 2.2. Schemas

```ts
// Solo estos cinco tipos son ajustables. La venta, la compra, el consumo y la
// conversión tienen su propio camino con su propio documento.
export const TIPO_AJUSTE_VALUES = [
  "entrada_ajuste", "salida_ajuste", "merma_vencimiento",
  "merma_rotura", "entrada_inicial",
] as const;

// RN-AJ1: el motivo tiene que ser sustantivo. El mínimo de 10 se valida acá para
// dar un 422 con el campo señalado, y otra vez en el RPC porque el Service no es
// el único camino a la base.
const MotivoSchema = z.string().trim().min(10, "El motivo requiere al menos 10 caracteres").max(500);

export const RegistrarAjusteSchema = z.object({
  loteId:   z.string().uuid(),
  tipo:     z.enum(TIPO_AJUSTE_VALUES),
  cantidad: z.number().positive(),
  motivo:   MotivoSchema,
});

export const BloquearLoteSchema   = z.object({ motivo: MotivoSchema });
export const AplicarRecuentoSchema = z.object({ confirmarDesvios: z.boolean().default(false) });

export const RegistrarDevolucionSchema = z.object({
  ventaId: z.string().uuid(),
  items:   z.array(z.object({
    ventaItemId: z.string().uuid(),
    cantidad:    z.number().positive(),
    revendible:  z.boolean(),
  })).min(1),
  motivo:            MotivoSchema,
  reintegraEfectivo: z.boolean().default(true),
});
```

### 2.3. Controller y rutas

```ts
// manage_stock cubre ajustes, mermas, recuento y bloqueo de lotes (§8.1) y solo
// lo tiene el admin (§8.2). La devolución es distinta: la registra quien vende.
const stockMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"), requirePermission("manage_stock"),
];

const ventasMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("ventas"), requirePermission("manage_sales"),
];
```

| Método | Ruta | Middleware |
|---|---|---|
| POST | `/api/v1/ajustes` | `stockMiddleware` |
| POST | `/api/v1/ajustes/lotes/:id/bloquear` | `stockMiddleware` |
| POST | `/api/v1/ajustes/lotes/:id/desbloquear` | `stockMiddleware` |
| GET/POST | `/api/v1/recuentos` | `stockMiddleware` |
| GET | `/api/v1/recuentos/:id` | `stockMiddleware` |
| POST/DELETE | `/api/v1/recuentos/:id/detalle[/:detalleId]` | `stockMiddleware` |
| POST | `/api/v1/recuentos/:id/aplicar` | `stockMiddleware` — 409 `COUNT_STALE` con `details` |
| POST | `/api/v1/devoluciones` | **`ventasMiddleware`** |

**La devolución va con `manage_sales`, no con `manage_stock`.** La registra la persona del
mostrador cuando el cliente vuelve con el producto; exigirle `manage_stock` significaría que
solo el admin puede recibir una devolución, y en la práctica se recibiría igual y se
registraría después o nunca.

**No hay `PUT` ni `PATCH` sobre ajustes, ni ninguna ruta que revierta uno** (RN-AJ2).

### 2.4. Tests

**`tests/unit/ajustes.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-AJ2: no existe ningún método de reversión` | `expect(AjusteService.revertir).toBeUndefined()` y lo mismo para `deshacer`, `anular`. |
| `RN-AJ3: el Service no escribe cantidad_sistema` | `agregarDetalle` con `{ cantidadSistema: 10 }` en el body → el `insert` **no** incluye esa columna. Verificalo sobre los argumentos del mock. |
| `COUNT_STALE llega con los lotes en details` | El mock del `.rpc()` devuelve `{ error: { message: 'COUNT_STALE:[{"loteId":"abc","cantidadActual":7}]' } }` → el `DomainError` tiene `code: COUNT_STALE`, `statusCode: 409` y `details` con el arreglo parseado. |
| `un COUNT_STALE con JSON corrupto no rompe` | El mock devuelve `COUNT_STALE:{no es json}` → el `DomainError` sale igual, con `details` vacío y **sin lanzar**. |
| `un error desconocido no filtra el mensaje interno` | Mensaje con nombre de constraint → `INTERNAL_ERROR` 500 sin ese texto. |
| `RN-AJ1: el motivo corto se rechaza antes del RPC` | `motivo: "error"` → 422 de Zod, y el `.rpc()` **no se llamó**. |

**`tests/unit/ajustes.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo |
|---|:--:|:--:|:--:|:--:|
| `POST /ajustes` | 201 | **403** | **403** | 403 (`stock`) |
| `POST /ajustes/lotes/:id/bloquear` | 200 | **403** | **403** | 403 (`stock`) |
| `POST /recuentos` | 201 | **403** | **403** | 403 (`stock`) |
| `POST /recuentos/:id/aplicar` | 200 | **403** | **403** | 403 (`stock`) |
| `POST /devoluciones` | 201 | 201 | 201 | 403 (`ventas`) |

Más `RN-SC1` (el `tenantId` del body se ignora) y el test estructural de que no hay rutas de
reversión de ajuste.

## 3. RN que cubre esta tanda

Ninguna RN nueva: C5·T2 y C5·T3 ya cerraron las siete RN-AJ contra la base. Esta tanda completa
la cobertura del lado de la aplicación y cierra la etapa.

| RN | Qué agrega |
|---|---|
| RN-AJ1 | La validación de Zod antes del round-trip, con el campo señalado. |
| RN-AJ2 | El test estructural de que no existe ningún método ni ruta de reversión. |
| RN-AJ3 | El test de que el Service no escribe `cantidad_sistema`, y el parseo de `COUNT_STALE`. |
| RN-SC1, SC5, SC7 | El `tenantId` del JWT, la auditoría y la matriz rol × endpoint. |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo.
2. `ajustes.schemas.ts` → `ajustes.service.ts` → `ajustes.controller.ts`.
3. Rutas en `main.ts`.
4. `"ajustes"` a `MODULOS_COMERCIALES` en G1.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Cerrá C5 en la matriz: **RN-AJ1…AJ7 y RN-LO7 en ✅.**

## 5. Definición de hecho

```bash
# 1. No hay métodos ni rutas de reversión
grep -niE "revertir|deshacer|undo" supabase/functions/api/src/modules/ajustes/
# → sin resultados (salvo dentro de un comentario que explique por qué no existen)

# 2. El Service no escribe cantidad_sistema
grep -n "cantidad_sistema\|cantidadSistema" supabase/functions/api/src/modules/ajustes/ajustes.service.ts
# → solo en LECTURAS o en el comentario que explica por qué no se escribe

# 3. La devolución usa manage_sales, no manage_stock
grep -n -B2 "devoluciones" supabase/functions/api/src/modules/ajustes/ajustes.controller.ts
# → ventasMiddleware

# 4. Ningún service del módulo escribe el libro mayor
npx vitest run tests/unit/stock-ledger-guardrail.test.ts
# → passed

# 5. Tests y guardrails
npx vitest run tests/unit/ajustes.service.test.ts tests/unit/ajustes.controller.test.ts \
  tests/unit/tenant-filter-guardrail.test.ts
npm test && npm run typecheck
# → todo passed; el it.each de cobertura de G1 corre con 7 módulos
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
