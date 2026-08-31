# ETAPA C7 · TANDA 2/3 — Service, Controller y enganche clínico
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C7·T1 en verde, con `consumo.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es la tanda que toca la frontera con el módulo clínico**, que es donde se rompe la
> independencia si alguien se descuida. La regla de §10.3 no admite excepciones: el movimiento
> apunta al evento, nunca al revés, y **ningún archivo de `modules/historial/` ni de
> `modules/vacunacion/` se modifica en esta tanda**.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §10.3 | La dirección de la dependencia y sus tres motivos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §15 P-04 | Las tres opciones para "el insumo no está cargado" y por qué solo una es compatible con el modelo. |
| `PLAN_ETAPAS_COMERCIAL.md` §Etapa C7 | La decisión provisoria sobre P-04. |
| `supabase/functions/api/src/modules/ventas/ventas.service.ts` | Tu Service de C4·T4: `mapVentaRpcError` y la forma de llamar RPCs. |
| `supabase/functions/api/src/modules/historial/historial.controller.ts` | El controller clínico. **Leelo para saber qué NO tocar** y para copiar su patrón de permisos por método. |
| `supabase/functions/api/src/modules/vacunacion/vacunacion.controller.ts` | Ídem. |
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

1. `supabase/functions/api/src/modules/consumo/consumo.schemas.ts`
2. `supabase/functions/api/src/modules/consumo/consumo.service.ts`
3. `supabase/functions/api/src/modules/consumo/consumo.controller.ts`
4. `tests/unit/consumo.service.test.ts`
5. `tests/unit/consumo.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/consumos", consumoRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"consumo"` a `MODULOS_COMERCIALES`. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-CC3 completa (los dos escenarios de la bandera). |

**Archivos que NO se tocan, y esto es un criterio de aceptación:**
`supabase/functions/api/src/modules/historial/*`, `supabase/functions/api/src/modules/vacunacion/*`,
`supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql`,
`supabase/migrations/20260630000002_marcar_dosis_aplicada_rpc.sql`.

## 2. Especificación exacta

### 2.1. `consumo.schemas.ts`

```ts
export const RegistrarConsumoSchema = z.object({
  // El evento clínico YA EXISTE. Se crea por su propio camino y este endpoint
  // recibe su id. Son dos llamadas a propósito: si el descuento fallara, el acto
  // clínico ya ocurrió y tiene que quedar registrado igual (§10.3).
  historialId: z.string().uuid(),
  items: z.array(z.object({
    productoId: z.string().uuid(),
    cantidad:   z.number().positive(),
    // Override de FEFO: si viene, exige motivo (RN-LO6).
    loteId:     z.string().uuid().nullish(),
    motivoFefo: z.string().trim().min(10).max(500).nullish(),
  })).min(1),
  planVacunacionId: z.string().uuid().nullish(),
  // RESERVADAS. Se persisten si vienen y NO se validan: no existe tabla `receta`
  // y no se va a crear (D-14). El día que el negocio la pida, la validación se
  // agrega acá y la columna ya tiene los datos.
  recetaId:                 z.string().uuid().nullish(),
  profesionalPrescriptorId: z.string().uuid().nullish(),
});
```

**No pongas `tenantId` ni `mascotaId` en el schema.** El tenant sale del JWT; la mascota la
resuelve el RPC desde el evento clínico. Aceptar `mascotaId` del body permitiría que la
trazabilidad lote↔animal dijera una cosa distinta de la verdad.

### 2.2. `consumo.service.ts`

| Método | Qué hace |
|---|---|
| `registrar(dto, ctx)` | Llama a `registrar_consumo_clinico`. Devuelve las `advertencias` del RPC tal cual, sin filtrarlas. |
| `porEvento(historialId, ctx)` | Los movimientos de `consumo_clinico` de un evento, con producto y lote embebidos, **en una consulta**. Es lo que alimenta el "qué se le aplicó" de la ficha. |
| `disponibilidad(productoId, ctx)` | Existencia total y candidatos FEFO del producto. **Lectura informativa**, para que la pantalla muestre antes de confirmar. No reserva y no decide. |

**`mapConsumoRpcError`** con la forma de `mapVentaRpcError`, cubriendo `HISTORIAL_NOT_FOUND`,
`VACCINE_PLAN_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `INSUFFICIENT_STOCK`,
`BATCH_EXPIRED`, `BATCH_BLOCKED`, `FEFO_OVERRIDE_WITHOUT_REASON`, `UNIT_NO_DECIMALS`,
`PRESCRIPTION_REQUIRED`, `VALIDATION_ERROR`. `INTERNAL_ERROR` genérico al final, **sin filtrar
el mensaje crudo**.

### 2.3. P-04 — la decisión provisoria, y dónde vive

> **DECISIÓN PROVISORIA. El dueño todavía no respondió P-04.**
>
> **Qué se aplica:** si el insumo no está cargado en el catálogo, o está cargado pero sin
> existencia, **el acto clínico se registra igual y el consumo queda pendiente de regularizar**.
> No se bloquea el acto clínico y **no** se permite existencia negativa.
>
> **Por qué esta y no otra.** §15 P-04 plantea tres opciones: bloquear el acto clínico, permitir
> existencia negativa, o registrar el acto y marcar el consumo como pendiente. La segunda la
> prohíbe el modelo (RN-MV5, y el `CHECK (cantidad >= 0)` de `existencias_lote` la haría fallar
> igual). La primera pone al sistema de stock a decidir si un animal se atiende, que no es su
> trabajo. **Queda la tercera.**
>
> **Cómo se implementa sin ninguna columna nueva.** El acto clínico y el consumo son dos
> llamadas separadas (§10.3). Si la segunda falla, la primera ya ocurrió y quedó registrada. El
> "pendiente de regularizar" **es la ausencia del movimiento**, y se consulta con un reporte:
> eventos clínicos sin `consumo_clinico` asociado. Ese reporte se escribe en C7·T3.
>
> **Si el dueño responde distinto**, lo que cambia es esto y nada más:
> - **Si pide bloquear el acto clínico:** el guard va en `modules/historial/historial.service.ts`
>   y en `modules/vacunacion/vacunacion.service.ts`, gobernado por una columna nueva
>   `configuracion_tenant.exigir_insumo_cargado BOOLEAN NOT NULL DEFAULT false`. **Eso rompería
>   la independencia de §10.3** y hay que discutirlo antes, no implementarlo.
> - **Si pide que el consumo pendiente quede registrado explícitamente** en vez de derivarse por
>   ausencia: una tabla `consumos_pendientes` nueva, en una migración propia.
>
> **El RPC y el libro mayor no se tocan en ninguno de los dos casos.**

En el Service, el guard es simplemente el mapeo del error, con este comentario:

```ts
// P-04 (decisión provisoria): si el producto no existe en el catálogo o no tiene
// existencia, ESTA llamada falla — y el acto clínico, que se registró por su
// propio camino ANTES, queda intacto. No hay rollback del evento clínico y no
// puede haberlo: son dos transacciones distintas, a propósito.
// El consumo queda "pendiente de regularizar" y se descubre con el reporte de
// C7·T3 (eventos clínicos sin consumo asociado). Ver PLAN_ETAPAS_COMERCIAL.md
// §Etapa C7 para qué cambiar si el dueño responde P-04 distinto.
```

### 2.4. `consumo.controller.ts` y rutas

```ts
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"),
  requirePermission("view_stock"),
];

// consume_stock es un permiso PROPIO (§8.1): descontar desde un acto clínico no
// es lo mismo que ajustar el inventario. Lo tiene el admin y el VETERINARIO;
// la recepcionista NO (§8.2), porque no atiende.
const consumeStock = requirePermission("consume_stock");
```

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/v1/consumos` | **`consume_stock`** — 201 |
| GET | `/api/v1/consumos/evento/:historialId` | `view_stock` |
| GET | `/api/v1/consumos/disponibilidad` | `view_stock` — `?productoId=…` |

**`requireModule("stock")`, no `"ventas"`.** Consumir insumos es control de existencias: un
tenant `profesional` —que tiene `stock` y no `ventas`— tiene que poder descontar lo que aplica.
Ese es exactamente el producto que D-16 describe cuando dice que controlar insumos sin vender al
público es vendible por sí solo.

**No hay `PUT`, `PATCH` ni `DELETE`.** Un consumo mal cargado se corrige con un ajuste motivado
de C5, igual que todo lo demás en este módulo.

En `main.ts`:

```ts
// ─── Consumo clínico (módulo vendible stock — Etapa C7) ───────────────────────
app.route("/consumos", consumoRouter);
```

### 2.5. El enganche, del lado correcto

**El módulo clínico no llama al comercial y el comercial no modifica al clínico.** El enganche lo
hace el frontend, en dos pasos:

```
1. POST /api/v1/historial            → devuelve { id }        (o)
   POST /api/v1/plan-vacunacion/:id/aplicar → devuelve { eventId }
2. POST /api/v1/consumos  { historialId: <ese id>, items: [...] }
```

**No agregues un parámetro `descontarStock` al endpoint clínico**, ni un llamado al RPC comercial
desde `historial.service.ts`. Las dos cosas invierten la flecha de §10.3 y hacen que el historial
deje de funcionar para un tenant sin `stock` contratado.

Si al escribir esto te parece que hacen falta dos llamadas donde una alcanzaría, tenés razón en
la observación y está aceptado a cambio: **la independencia de los módulos vendibles vale más que
un round-trip**, y es lo que `requireModule` protege.

### 2.6. Tests

**`tests/unit/consumo.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-CC3: la bandera de receta cambia el comportamiento sin migración` | Mock con `exigir_receta_bloqueante: false` → el RPC devuelve advertencia y `registrar` la propaga. Con `true` → el RPC devuelve `PRESCRIPTION_REQUIRED` y el Service lo mapea a 422 con ese código. |
| `las advertencias del RPC se propagan sin filtrar` | El mock devuelve dos advertencias → la respuesta las trae las dos. Un Service que se las come deja al usuario sin saber que aplicó un producto bajo receta. |
| `el Service no lee existencias para decidir` | `registrar` no consulta `existencias_lote` antes de llamar al RPC. Verificalo sobre los `.from()` del mock. |
| `el tenantId sale del contexto` | El `.rpc()` recibe `p_tenant_id: ctx.tenantId`. |
| `no se acepta mascotaId del body` | El schema lo rechaza; el `.rpc()` nunca recibe un `p_mascota_id`. |
| `un error desconocido no filtra el mensaje interno` | Mensaje con nombre de constraint → `INTERNAL_ERROR` 500 sin ese texto. |
| `no hay N+1 en porEvento` | Una sola llamada a `.from()` para N movimientos con su producto y su lote. |

**`tests/unit/consumo.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo `stock` |
|---|:--:|:--:|:--:|:--:|
| `POST /consumos` | 201 | 201 | **403** | 403 `MODULE_NOT_LICENSED` |
| `GET /consumos/evento/:id` | 200 | 200 | 200 | 403 |
| `GET /consumos/disponibilidad` | 200 | 200 | 200 | 403 |

**La celda que prueba algo es el 403 de la recepcionista en el POST**: no tiene `consume_stock`
(§8.2), porque no atiende. Y los 200 del veterinario prueban que el permiso está bien asignado.

Agregá además:

| `it()` | Caso |
|---|---|
| `RN-SC1: el tenantId del body se ignora` | POST con `{ …, tenantId: "<otro>" }` → el Service recibe el del JWT. |
| `no existe ninguna ruta que edite o borre un consumo` | Sin handlers `PUT`, `PATCH` ni `DELETE`. |
| `§10.3: el módulo clínico no quedó modificado` | Guardrail estático: `git diff --name-only` sobre esta tanda no toca `modules/historial/` ni `modules/vacunacion/`. Si tu arnés no puede correr git, escribí el chequeo como un test que verifica que `historial.service.ts` **no** contiene `registrar_consumo_clinico` ni `movimientos_stock`. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-CC3 | La receta es opcional hoy y bloqueante por configuración, sin migración. → `422 PRESCRIPTION_REQUIRED` | `it('RN-CC3: la bandera de receta cambia el comportamiento sin migración', …)` — completa lo que C7·T1 probó en la base |
| RN-SC1, SC5, SC7 | Tenant del JWT, auditoría con `module: 'inventory'`, matriz rol × endpoint. | Los casos de 2.6 |

**RN-CC4** sigue en `PENDIENTE`: es de C7·T3.

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo por módulo inexistente.
2. `consumo.schemas.ts` → `consumo.service.ts` → `consumo.controller.ts`.
3. Ruta en `main.ts`.
4. `"consumo"` a `MODULOS_COMERCIALES` en el guardrail G1.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Marcá RN-CC3 en la matriz.

## 5. Definición de hecho

```bash
# 1. NO se tocó el módulo clínico — es criterio de aceptación
git status --short supabase/functions/api/src/modules/historial/ \
                   supabase/functions/api/src/modules/vacunacion/
# → SIN RESULTADOS

# 2. El módulo clínico no conoce el catálogo
grep -rn "movimientos_stock\|registrar_consumo_clinico\|productos" \
  supabase/functions/api/src/modules/historial/ supabase/functions/api/src/modules/vacunacion/
# → sin resultados

# 3. El endpoint clínico no ganó un parámetro de stock
grep -rniE "descontarStock|descontar_stock|consumirInsumo" supabase/functions/api/src/
# → sin resultados

# 4. consume_stock se exige solo en la escritura
grep -n "consume_stock\|view_stock" supabase/functions/api/src/modules/consumo/consumo.controller.ts
# → consume_stock en el POST; view_stock en el shared

# 5. requireModule es "stock", no "ventas"
grep -n 'requireModule(' supabase/functions/api/src/modules/consumo/consumo.controller.ts
# → requireModule("stock")

# 6. Sin rutas de edición
grep -nE '\.(put|patch|delete)\(' supabase/functions/api/src/modules/consumo/consumo.controller.ts
# → sin resultados

# 7. El Service no lee existencias para decidir
grep -n 'from("existencias_lote")' supabase/functions/api/src/modules/consumo/consumo.service.ts
# → solo en `disponibilidad`, que es lectura informativa, nunca en `registrar`

# 8. Tests y guardrails
npx vitest run tests/unit/consumo.service.test.ts tests/unit/consumo.controller.test.ts \
  tests/unit/tenant-filter-guardrail.test.ts
npm test && npm run typecheck
# → todo passed; el it.each de cobertura de G1 corre con 9 módulos
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
