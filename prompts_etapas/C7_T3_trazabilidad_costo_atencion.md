# ETAPA C7 · TANDA 3/3 — Trazabilidad lote↔animal, costo por atención y cierre de C7
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C7·T2 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **RN-CC4 es la regla que justifica haber denormalizado `mascota_id` en el libro mayor.** La
> trazabilidad lote→animal es lo que pide el contexto normativo de §3, y es una consulta que
> tiene que responder en las dos direcciones: dado un lote, qué animales lo recibieron; dada una
> mascota, qué lotes recibió. Sin la columna denormalizada serían dos joins más sobre la tabla
> más grande del módulo.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.10 RN-CC4 | Las dos consultas y su caso de test. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §3 y §3.1.c | Por qué la trazabilidad pasó de buena práctica a requisito. |
| `PLAN_ETAPAS_COMERCIAL.md` §Etapa C7 | La decisión provisoria sobre P-04: el reporte de pendientes de regularizar sale de acá. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` | `cadenaTrazabilidad` de C6·T3: el patrón de consulta de trazabilidad ya escrito. |
| `CLAUDE.md` sección de N+1 | Las dos consultas de RN-CC4 devuelven datos relacionados: **una** consulta con embed, nunca un `await` por fila. |
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

1. `supabase/migrations/20261013000002_comercial_vistas_consumo.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/modules/consumo/consumo.service.ts` | `lotesDeMascota`, `mascotasDeLote`, `costoPorAtencion`, `consumosPendientesDeRegularizar`. |
| `supabase/functions/api/src/modules/consumo/consumo.controller.ts` | Cuatro rutas de lectura. |
| `tests/integration/consumo.integration.test.ts` | RN-CC4. |
| `tests/unit/consumo.service.test.ts` | Los casos del reporte de costo y de pendientes. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **RN-CC4, y con eso las cinco RN-CC en ✅. Cierra C7.** |

## 2. Especificación exacta

### 2.1. `v_consumo_clinico`

Vista de lectura que normaliza el consumo con su contexto clínico. Es la base de las cuatro
consultas de esta tanda, y existe para que ninguna de ellas repita el mismo join.

```sql
CREATE OR REPLACE VIEW public.v_consumo_clinico AS
SELECT m.tenant_id,
       m.operacion_id,
       m.id                AS movimiento_id,
       m.created_at        AS consumido_at,
       m.historial_id,
       m.plan_vacunacion_id,
       m.mascota_id,
       ma.name             AS mascota_nombre,
       ma.especie_id,
       hc.professional_id,
       hc.date             AS fecha_evento,
       hc.event_type,
       m.producto_id,
       p.nombre            AS producto_nombre,
       p.familia_id,
       m.lote_id,
       l.codigo_lote,
       l.fecha_vencimiento,
       m.cantidad,
       -- Costo EFECTIVO, congelado cuando ocurrió. No se recalcula (RN-MV6).
       m.costo_unitario,
       m.costo_total,
       m.usuario_id
FROM movimientos_stock m
JOIN mascotas          ma ON ma.id = m.mascota_id    AND ma.tenant_id = m.tenant_id
JOIN historial_clinico hc ON hc.id = m.historial_id  AND hc.tenant_id = m.tenant_id
JOIN productos         p  ON p.id  = m.producto_id   AND p.tenant_id  = m.tenant_id
JOIN lotes             l  ON l.id  = m.lote_id       AND l.tenant_id  = m.tenant_id
WHERE m.tipo = 'consumo_clinico';

COMMENT ON VIEW public.v_consumo_clinico IS
  'Consumos clínicos con su contexto (mascota, evento, profesional, producto, lote). Base de la trazabilidad lote↔animal (RN-CC4) y del costo de insumos por atención. Usa el costo EFECTIVO guardado en el movimiento, nunca productos.costo_reposicion (RN-MV6, D-04).';
```

**Los cinco `JOIN` llevan su `tenant_id` en la condición**, no solo el `id`. Con FKs compuestas
la base ya lo garantiza, pero el filtro documenta el alcance y sobrevive al próximo refactor.

La vista **hereda la RLS de sus tablas base**: no lleva política propia.

### 2.2. Las dos consultas de RN-CC4

**Dado un lote, qué mascotas lo recibieron:**

```ts
/**
 * RN-CC4: trazabilidad lote → animal. Es lo que pide el contexto normativo de §3
 * y la razón por la que `mascota_id` está DENORMALIZADO en el libro mayor: sin
 * esa columna esto serían dos joins más sobre la tabla más grande del módulo,
 * en la consulta que se corre justo cuando hay un retiro de mercadería y hay
 * apuro.
 */
async mascotasDeLote(loteId: string, ctx: CallerContext) {
  const db = getServiceDb();
  const { data, error } = await db
    .from("v_consumo_clinico")
    .select("mascota_id, mascota_nombre, fecha_evento, cantidad, producto_nombre, historial_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("lote_id", loteId)
    .order("consumido_at", { ascending: false });
  …
}
```

**Dada una mascota, qué lotes recibió:** simétrica, `.eq("mascota_id", mascotaId)`, devolviendo
`lote_id`, `codigo_lote`, `fecha_vencimiento`, `producto_nombre`, `fecha_evento`, `cantidad`.

**Una consulta cada una.** Nada de traer los movimientos y después iterar pidiendo la mascota:
eso es el patrón N+1 que `CLAUDE.md` prohíbe explícitamente, y acá sería una request por animal.

### 2.3. Costo de insumos por atención

```ts
/**
 * Cuánto costó en insumos atender a un paciente. Suma `costo_total` del
 * movimiento, que es el costo EFECTIVO congelado: NO se recalcula contra
 * `productos.costo_reposicion`. Un reporte que revaluara hacia atrás inventaría
 * un costo de atención que nunca ocurrió (RN-MV6, D-04).
 */
async costoPorAtencion(opts, ctx): Promise<...>
```

Agrupa por `historial_id`, devolviendo mascota, fecha, profesional, cantidad de insumos y costo
total. Filtros: `mascotaId`, `profesionalId`, `desde`, `hasta`. Paginado.

### 2.4. Consumos pendientes de regularizar — P-04

Es la contrapartida de la decisión provisoria de C7·T2: como el "pendiente" **es la ausencia del
movimiento**, se descubre con una consulta y no con una columna.

```sql
CREATE OR REPLACE VIEW public.v_atenciones_sin_consumo AS
SELECT hc.tenant_id, hc.id AS historial_id, hc.pet_id AS mascota_id,
       ma.name AS mascota_nombre, hc.date AS fecha_evento,
       hc.event_type, hc.professional_id
FROM historial_clinico hc
JOIN mascotas ma ON ma.id = hc.pet_id AND ma.tenant_id = hc.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM movimientos_stock m
   WHERE m.tenant_id    = hc.tenant_id
     AND m.historial_id = hc.id
     AND m.tipo         = 'consumo_clinico'
);

COMMENT ON VIEW public.v_atenciones_sin_consumo IS
  'Eventos clínicos sin ningún consumo de insumos asociado. Es la implementación de la decisión provisoria sobre P-04: el acto clínico se registra igual aunque el insumo no esté cargado, y el consumo queda PENDIENTE DE REGULARIZAR — que es exactamente esta ausencia. No toda fila es un pendiente real: una consulta sin insumos aparece acá y está bien. Es una lista para revisar, no una lista de errores.';
```

**El `COMMENT` importa.** Sin él, alguien va a leer la vista como "atenciones mal cargadas" y va
a querer que el sistema las bloquee, que es exactamente la opción de P-04 que se descartó.

En el Service, `consumosPendientesDeRegularizar(opts, ctx)` la consulta con filtro de tenant,
paginada, con `desde`/`hasta` y `soloTipos` (para acotar a los tipos de evento que normalmente
sí llevan insumo, como vacunación).

### 2.5. Rutas

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/consumos/lote/:loteId/mascotas` | `view_stock` |
| GET | `/api/v1/consumos/mascota/:mascotaId/lotes` | `view_stock` |
| GET | `/api/v1/consumos/costo-por-atencion` | `view_stock` |
| GET | `/api/v1/consumos/pendientes-regularizar` | `view_stock` |

Todas con el `sharedMiddleware` de C7·T2 (`requireModule("stock")` + `requirePermission("view_stock")`).

### 2.6. Tests

**RN-CC4 en `tests/integration/consumo.integration.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-CC4: dado un lote, se listan las mascotas que lo recibieron` | Sembrar **un** lote y hacer **tres** consumos sobre **dos** mascotas distintas (una recibe dos veces). `mascotasDeLote` → 3 filas, con 2 mascotas distintas. Verificá que las dos aparecen y que la que recibió dos veces aparece dos veces con sus fechas. |
| `RN-CC4: dada una mascota, se listan los lotes que recibió` | La misma mascota consumió de **dos lotes distintos** → `lotesDeMascota` devuelve los dos, con su `codigo_lote` y su `fecha_vencimiento`. |
| `RN-CC4: la trazabilidad no cruza tenants` | Un consumo del tenant B sobre un lote homónimo no aparece en la consulta de A. Es la aserción que prueba que el `.eq("tenant_id", …)` está. |
| `RN-CC4: las dos consultas no hacen N+1` | El resultado trae el nombre de la mascota y el del producto **embebidos**; contá las llamadas a `.from()` en el mock del unit test: una. |

**En `tests/unit/consumo.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-MV6: el costo por atención usa el costo guardado` | Mock donde `movimientos_stock.costo_total` es 100 y `productos.costo_reposicion` es 130 → el reporte devuelve **100**. Cambiar el mock de `costo_reposicion` → el reporte **no cambia**. |
| `las atenciones sin consumo no se presentan como errores` | El método devuelve las filas sin marcarlas ni contarlas como fallas; el DTO no tiene ningún campo `error` ni `invalido`. Es la decisión provisoria de P-04 respetada en la capa de presentación. |
| `los cuatro métodos filtran por tenant` | Los cuatro `.eq("tenant_id", ctx.tenantId)`. |

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CC4 | Trazabilidad lote↔animal consultable en las dos direcciones. | Los cuatro `it('RN-CC4: …')` de 2.6 |
| RN-MV6 | El costo se guarda, no se recalcula — verificado sobre el costo por atención. | `it('RN-MV6: el costo por atención usa el costo guardado', …)` |

## 4. Orden de trabajo

1. Tests primero, en rojo.
2. Migración con marca, aplicada. **No lleva `NOTIFY pgrst`**: crea vistas, no funciones. Podés
   incluirlo igual; es barato y no molesta.
3. Los cuatro métodos del Service y sus rutas.
4. `npm test && npm run typecheck && npm run test:integration`.
5. **Cerrá C7 en la matriz: las cinco RN-CC en ✅.** Si alguna quedó `PENDIENTE`, decilo en el
   reporte y no la marques.

## 5. Definición de hecho

```bash
# 1. Las dos vistas existen y tienen su COMMENT
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_consumo_clinico'::regclass,'pg_class');"
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_atenciones_sin_consumo'::regclass,'pg_class');"
# → los dos textos, no NULL

# 2. La vista de consumo NO joinea costo_reposicion
grep -n "costo_reposicion" supabase/migrations/20261013000002_comercial_vistas_consumo.sql
# → SIN RESULTADOS

# 3. Ninguna RN-CC quedó sin cerrar
grep -E "^\| RN-CC[0-9]" MATRIZ_RN_TESTS_COMERCIAL.md
# → las cinco filas en ✅

# 4. No hay N+1 en las consultas de trazabilidad
grep -n -A3 -E '\.(map|forEach)\(' supabase/functions/api/src/modules/consumo/consumo.service.ts | grep -c "await db"
# → 0

# 5. El módulo clínico sigue sin conocer el comercial
grep -rn "movimientos_stock\|v_consumo_clinico" \
  supabase/functions/api/src/modules/historial/ supabase/functions/api/src/modules/vacunacion/
# → sin resultados

# 6. Tests
npx vitest run tests/unit/consumo.service.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/consumo.integration.test.ts
# → "N passed", "0 skipped"

# 7. Toda la suite y los cuatro guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts
# → 0 skipped
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
