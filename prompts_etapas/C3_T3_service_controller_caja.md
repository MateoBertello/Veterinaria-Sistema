# ETAPA C3 · TANDA 3/3 — Service, Controller y rutas de caja
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C3·T2 en verde, con el test concurrente de RN-CJ4 pasando 200 repeticiones.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | **El patrón exacto**: `.rpc(nombre, { p_tenant_id: ctx.tenantId, … }).single()` y `mapEstadiaRpcError` traduciendo el `RAISE EXCEPTION` a `DomainError`. |
| `supabase/functions/api/src/modules/servicios/servicios.controller.ts` | Controller con `use("/*", …)` y un solo permiso. |
| `supabase/functions/api/src/modules/compras/compras.controller.ts` | Tu propio controller de C2·T4. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.7 | RN-CJ1…CJ9, para saber qué NO va acá (CJ1 y CJ3 son de C4). |
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

1. `supabase/functions/api/src/modules/caja/caja.schemas.ts`
2. `supabase/functions/api/src/modules/caja/caja.service.ts`
3. `supabase/functions/api/src/modules/caja/caja.controller.ts`
4. `tests/unit/caja.service.test.ts`
5. `tests/unit/caja.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/caja", cajaRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"caja"` a `MODULOS_COMERCIALES`. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | El cierre de C3: RN-CJ2, CJ4…CJ9 en ✅. |

## 2. Especificación exacta

### 2.1. `caja.service.ts`

`CajaService` con:

| Método | Qué hace |
|---|---|
| `listarCajas(tenantId)` | Listado de `cajas`. |
| `asegurarCajaPrincipal(ctx)` | Si el tenant no tiene ninguna caja, crea `"Caja principal"` y la devuelve. Idempotente: si ya hay una, la devuelve sin crear nada. Audita `CREATE` con `module: "cash_register"` **solo cuando crea**. |
| `abrirSesion(dto, ctx)` | Llama a `abrir_sesion_caja`. Si `dto.cajaId` viene vacío, usa `asegurarCajaPrincipal`. |
| `registrarMovimiento(dto, ctx)` | Llama a `registrar_movimiento_caja`. |
| `cerrarSesion(sesionId, dto, ctx)` | Llama a `cerrar_sesion_caja`. |
| `sesionAbierta(tenantId, cajaId)` | Devuelve la sesión abierta o `null`. **Lectura, no decisión**: quien decide es el RPC. |
| `obtenerSesion(sesionId, tenantId)` | Detalle con sus movimientos, en **una** consulta con embed. |
| `listarSesiones(tenantId, opts)` | Paginado, filtrable por `estado`, `desde`, `hasta`. |
| `resumenSesion(sesionId, tenantId)` | Totales por medio de pago de la sesión: `SUM(importe * signo)` agrupado, con `afecta_arqueo` embebido. **Una consulta, no una por medio.** |

**`mapCajaRpcError(error, contexto)`** — copiá la forma de `mapEstadiaRpcError`:

```ts
/**
 * Traduce el RAISE EXCEPTION del RPC a DomainError. El mensaje que llega de
 * PostgREST contiene el código tal cual lo lanzó el RPC.
 */
function mapCajaRpcError(error: { message: string }, contexto: string): DomainError {
  const msg = error.message ?? "";
  if (msg.includes("CASH_SESSION_ALREADY_OPEN"))
    return new DomainError(ErrorCode.CASH_SESSION_ALREADY_OPEN, 409, "Ya hay una sesión abierta en esta caja");
  if (msg.includes("CASH_SESSION_CLOSED"))
    return new DomainError(ErrorCode.CASH_SESSION_CLOSED, 409, "La sesión de caja está cerrada");
  if (msg.includes("CASH_SESSION_NOT_FOUND"))
    return new DomainError(ErrorCode.CASH_SESSION_NOT_FOUND, 404, "Sesión de caja no encontrada en este tenant");
  if (msg.includes("PAYMENT_REFERENCE_REQUIRED"))
    return new DomainError(ErrorCode.PAYMENT_REFERENCE_REQUIRED, 422, "El medio de pago exige número de operación");
  if (msg.includes("PAYMENT_METHOD_DISABLED"))
    return new DomainError(ErrorCode.PAYMENT_METHOD_DISABLED, 422, "El medio de pago no está disponible");
  if (msg.includes("REASON_REQUIRED"))
    return new DomainError(ErrorCode.REASON_REQUIRED, 422, "La operación exige un motivo de al menos 10 caracteres");
  if (msg.includes("INVALID_OPENING_BALANCE"))
    return new DomainError(ErrorCode.INVALID_OPENING_BALANCE, 422, "El saldo declarado es inválido");
  if (msg.includes("INVALID_QUANTITY"))
    return new DomainError(ErrorCode.INVALID_QUANTITY, 422, "El importe debe ser mayor que cero");
  return new DomainError(ErrorCode.INTERNAL_ERROR, 500, `Error en ${contexto}`);
}
```

**El `return` final es `INTERNAL_ERROR` con mensaje genérico**, no el `error.message` crudo:
`CLAUDE.md` regla 7 prohíbe filtrar detalles internos al cliente. Reportá el mensaje real a
Sentry en el error handler global, no en la respuesta.

**El Service NO calcula el saldo teórico.** Eso lo hace `cerrar_sesion_caja` bajo el
`FOR UPDATE` de la sesión. `resumenSesion` es informativo y no decide nada.

### 2.2. `caja.schemas.ts`

```ts
export const AbrirSesionSchema = z.object({
  cajaId:       z.string().uuid().optional(),   // si falta, se usa la caja principal
  saldoInicial: z.number().nonnegative(),
});

export const TIPO_MOVIMIENTO_CAJA_VALUES = [
  "ingreso_venta", "ingreso_cobro_cuenta_corriente", "ingreso_manual",
  "egreso_pago_proveedor", "egreso_devolucion", "egreso_manual", "egreso_retiro",
] as const;

export const RegistrarMovimientoSchema = z.object({
  tipo:        z.enum(TIPO_MOVIMIENTO_CAJA_VALUES),
  medioPagoId: z.string().uuid(),
  importe:     z.number().positive(),
  motivo:      z.string().trim().min(10).max(500).nullish(),
  referencia:  z.string().trim().max(100).nullish(),
});

export const CerrarSesionSchema = z.object({
  efectivoContado: z.number().nonnegative(),
  motivo:          z.string().trim().min(10).max(500).nullish(),
  observaciones:   z.string().trim().max(500).nullish(),
});

export const ListarSesionesQuerySchema = z.object({
  estado: z.enum(["abierta", "cerrada"]).optional(),
  desde:  z.string().date().optional(),
  hasta:  z.string().date().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});
```

El `min(10)` del motivo es la validación amable; la dura la hace el RPC. **Las dos**: el Zod
devuelve un 422 con el campo señalado, el RPC cierra la puerta a cualquier otro camino.

### 2.3. `caja.controller.ts` y rutas

```ts
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("ventas"),
  requirePermission("manage_cash"),
];
```

**`requireModule("ventas")`, no `"stock"`.** La caja es parte del producto que se vende como
`ventas`: un tenant `profesional` tiene stock y compras, pero no mostrador ni arqueo. Es la
consecuencia directa de la decisión P-01b.

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/v1/caja/cajas` | Listado de cajas del tenant. |
| GET | `/api/v1/caja/sesiones` | Paginado. |
| GET | `/api/v1/caja/sesiones/actual` | La sesión abierta o `null`. **No 404 si no hay ninguna**: "no hay caja abierta" es un estado normal de la pantalla, no un error. |
| GET | `/api/v1/caja/sesiones/:id` | Detalle con movimientos embebidos. 404 `CASH_SESSION_NOT_FOUND`. |
| GET | `/api/v1/caja/sesiones/:id/resumen` | Totales por medio de pago. |
| POST | `/api/v1/caja/sesiones` | Abrir. 201. 409 `CASH_SESSION_ALREADY_OPEN`. |
| POST | `/api/v1/caja/sesiones/:id/movimientos` | 201. 409 `CASH_SESSION_CLOSED`. |
| POST | `/api/v1/caja/sesiones/:id/cerrar` | 200. 409 `CASH_SESSION_CLOSED` si ya estaba cerrada. |

**No hay `PUT`, `PATCH` ni `DELETE` en ninguna ruta de caja.** Una sesión no se edita y un
movimiento no se corrige: se compensa con otro movimiento. Si al escribir el controller te sale
una ruta de edición, es la señal de que estás rompiendo RN-CJ5.

En `main.ts`:

```ts
// ─── Caja (módulo vendible ventas — Etapa C3) ─────────────────────────────────
app.route("/caja", cajaRouter);
```

### 2.4. Tests

**`tests/unit/caja.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-CJ9: la referencia obligatoria se valida antes de llamar al RPC` | `registrarMovimiento` con medio `requiere_referencia` y sin referencia → `PAYMENT_REFERENCE_REQUIRED`, y **el `.rpc()` no se llamó**. |
| `RN-CJ5: los errores del RPC se traducen a DomainError` | El mock del `.rpc()` devuelve `{ error: { message: "CASH_SESSION_CLOSED" } }` → `cerrarSesion` lanza `DomainError` con `code: CASH_SESSION_CLOSED` y `statusCode: 409`, **no un 500**. |
| `un error desconocido del RPC no filtra el mensaje interno` | El mock devuelve `{ error: { message: "duplicate key value violates unique constraint \"idx_secreto\"" } }` → el `DomainError` es `INTERNAL_ERROR` 500 y su `message` **no contiene** `idx_secreto`. |
| `el tenantId siempre sale del contexto` | Los tres métodos que llaman `.rpc()` pasan `p_tenant_id: ctx.tenantId`. Verificalo sobre los argumentos del mock. |
| `asegurarCajaPrincipal es idempotente` | Con una caja existente, no llama a `.insert()` ni a `recordAudit`. Sin ninguna, llama a las dos. |
| `no hay N+1 en el resumen de sesión` | `resumenSesion` hace **una** llamada a `.from()`. |

**`tests/unit/caja.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo `ventas` |
|---|:--:|:--:|:--:|:--:|
| `GET /caja/sesiones/actual` | 200 | **403** | 200 | 403 `MODULE_NOT_LICENSED` |
| `POST /caja/sesiones` | 201 | **403** | 201 | 403 |
| `POST /caja/sesiones/:id/movimientos` | 201 | **403** | 201 | 403 |
| `POST /caja/sesiones/:id/cerrar` | 200 | **403** | 200 | 403 |

**El veterinario no maneja caja** (no tiene `manage_cash`, §8.2). Las celdas en negrita son las
que prueban algo.

Agregá además:

| `it()` | Caso |
|---|---|
| `RN-SC1: el tenantId del body se ignora` | POST con `{ …, tenantId: "<otro>" }` → el Service recibe el del JWT. |
| `no existe ninguna ruta que edite una sesión o un movimiento` | Recorré el router y verificá que no hay handlers registrados para `PUT`, `PATCH` ni `DELETE`. Es RN-CJ5 escrita como test estructural. |

## 3. RN que cubre esta tanda

Ninguna RN nueva se abre acá: C3·T2 ya cerró RN-CJ2 y CJ4…CJ9 contra la base. Esta tanda
**completa** su cobertura del lado de la aplicación (traducción de errores, permisos,
licenciamiento) y cierra la etapa.

| RN | Qué agrega esta tanda |
|---|---|
| RN-CJ5 | El test estructural de que no existe ninguna ruta de edición ni de reapertura. |
| RN-CJ9 | La validación en el Service, antes del round-trip al RPC. |
| RN-SC1 | El `tenantId` del body ignorado en los cuatro POST. |
| RN-SC5 | `asegurarCajaPrincipal` audita con `module: "cash_register"`; los RPC auditan solos, adentro de la transacción. |
| RN-SC7 | La matriz rol × endpoint de los ocho endpoints de caja. |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo por módulo inexistente.
2. `caja.schemas.ts` → `caja.service.ts` → `caja.controller.ts`.
3. Ruta en `main.ts`.
4. **Agregá `"caja"` a `MODULOS_COMERCIALES` en el guardrail G1.**
5. `npm test && npm run typecheck && npm run test:integration`.
6. Cerrá C3 en `MATRIZ_RN_TESTS_COMERCIAL.md`: **RN-CJ2 y RN-CJ4…CJ9 tienen que quedar en ✅.**
   RN-CJ1 y RN-CJ3 siguen `PENDIENTE`: son de C4.

## 5. Definición de hecho

```bash
# 1. Los tests de la tanda
npx vitest run tests/unit/caja.service.test.ts tests/unit/caja.controller.test.ts
# → passed, 0 skipped

# 2. No hay rutas de edición en caja
grep -nE '\.(put|patch|delete)\(' supabase/functions/api/src/modules/caja/caja.controller.ts
# → SIN RESULTADOS. Una sesión no se edita y un movimiento no se corrige.

# 3. El Service no calcula el saldo teórico por su cuenta
grep -n "saldo_teorico\|saldoTeorico" supabase/functions/api/src/modules/caja/caja.service.ts
# → solo lecturas del resultado del RPC o del campo de la fila. Ningún cálculo
#   con sum() ni reduce() sobre movimientos: eso lo hace cerrar_sesion_caja bajo
#   el FOR UPDATE.

# 4. La caja usa requireModule("ventas"), no "stock"
grep -n 'requireModule(' supabase/functions/api/src/modules/caja/caja.controller.ts
# → requireModule("ventas")

# 5. G1 cubre el módulo nuevo
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
# → el it.each de cobertura corre con 5 módulos

# 6. Etapa C3 completa
npx vitest run --config vitest.integration.config.ts tests/integration/caja.integration.test.ts
npm test && npm run typecheck
# → todo en verde, 0 skipped
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
