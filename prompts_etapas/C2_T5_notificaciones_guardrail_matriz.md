# ETAPA C2 · TANDA 5/5 — Notificaciones de vencimiento, guardrail del libro mayor y matriz
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T4 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> Esta tanda cierra C2 con las dos RN que no son de comportamiento sino de **estructura**:
> RN-MV1 y RN-MV10 dicen que *no existe ningún camino* que cambie una existencia sin insertar
> en el libro mayor. Eso no se prueba con un caso de uso: se prueba recorriendo el código.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §10.6 | La sutileza del `UNIQUE` de `notificaciones` y por qué la alerta de stock mínimo es **por flanco, no por nivel**. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 (`v_lotes_por_vencer`) y §6.4 (RN-LO8) | |
| `supabase/functions/api/src/shared/notificaciones/` | El servicio de notificaciones existente y su contrato. |
| `supabase/migrations/20260614000002_tables.sql` | La tabla `notificaciones` y su `UNIQUE (tenant_id, origen, referencia_id, canal)`. |
| `tests/unit/audit-modulo-enum.test.ts` | **El patrón exacto de guardrail estático a copiar**, incluida su autoverificación por mutación. |
| `tests/unit/tenant-filter-guardrail.test.ts` | El otro guardrail: mirá cómo recorre los archivos de `src/modules/`. |
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

1. `supabase/migrations/20260908000006_comercial_vistas_vencimiento.sql`
2. `tests/unit/stock-ledger-guardrail.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/migrations/20260908000004_…` | **NO.** No se edita una migración aplicada. La notificación va en el archivo nuevo. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` | El método que evalúa vencimientos próximos y emite notificaciones. |
| `tests/integration/stock.integration.test.ts` | RN-LO8. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-MV1, MV10, LO8 — **y el cierre de C2**. |

## 2. Especificación exacta

### 2.1. `v_lotes_por_vencer`

```sql
CREATE OR REPLACE VIEW public.v_lotes_por_vencer AS
SELECT l.tenant_id,
       l.id                AS lote_id,
       l.producto_id,
       p.nombre            AS producto_nombre,
       l.codigo_lote,
       l.fecha_vencimiento,
       (l.fecha_vencimiento - CURRENT_DATE) AS dias_restantes,
       e.cantidad
FROM lotes l
JOIN existencias_lote e ON e.lote_id = l.id AND e.tenant_id = l.tenant_id
JOIN productos p        ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
WHERE l.estado = 'disponible'
  AND l.fecha_vencimiento IS NOT NULL
  AND e.cantidad > 0;

COMMENT ON VIEW public.v_lotes_por_vencer IS
  'Lotes disponibles con existencia y fecha de vencimiento. El umbral de "por vencer" lo pone quien consulta, contra configuracion_tenant.dias_alerta_vencimiento: la vista no lo fija para que un cambio de configuración tenga efecto inmediato sin recrear la vista.';
```

**La vista no filtra por `dias_alerta_vencimiento`.** Si lo hiciera, cambiar la configuración
del tenant no tendría efecto hasta recrear la vista, y el umbral es por tenant.

### 2.2. Notificación de vencimiento próximo — RN-LO8

**Notifica, no bloquea.** Un lote a 30 días con umbral 60 genera aviso **y la venta funciona
igual**.

`origen = 'vencimiento_lote'`, `referencia_id = lote_id`. El
`UNIQUE (tenant_id, origen, referencia_id, canal)` da exactamente lo que se quiere: **una
notificación por lote, para siempre**. Nadie necesita que le avisen dos veces que el mismo lote
está por vencer, así que acá el `UNIQUE` no es un obstáculo a esquivar: es la deduplicación.

En `stock.service.ts`:

```ts
/**
 * RN-LO8: avisa de los lotes que vencen dentro de dias_alerta_vencimiento.
 * NO bloquea nada: el lote sigue siendo candidato FEFO hasta el día que vence.
 *
 * El UNIQUE (tenant_id, origen, referencia_id, canal) de `notificaciones`
 * absorbe los reintentos: una notificación por lote, para siempre. Por eso el
 * insert va con ON CONFLICT DO NOTHING y no con una consulta previa.
 */
async function notificarLotesPorVencer(tenantId: string): Promise<number> { … }
```

**La notificación de stock mínimo NO va en esta tanda.** Es **por flanco, no por nivel** —se
crea al cruzar hacia abajo el mínimo y **se elimina al cruzar hacia arriba**, para que el
`UNIQUE` deje de bloquear y el próximo faltante vuelva a avisar— y se evalúa **dentro del RPC**
después de cada movimiento. Como el primer RPC que hace bajar la existencia es
`registrar_venta` (C4), la alerta va ahí. Dejá este comentario en `stock.service.ts` para que
no se pierda:

```ts
// TODO C4·T2: alerta de stock mínimo. Es por FLANCO, no por nivel: se crea al
// cruzar el mínimo hacia abajo y se ELIMINA al cruzarlo hacia arriba, de modo
// que el UNIQUE de notificaciones deje de bloquear y el próximo faltante vuelva
// a avisar. Se evalúa DENTRO del RPC, después de cada movimiento, no por tarea
// programada: así la alerta llega cuando pasa y no al día siguiente.
```

### 2.3. `tests/unit/stock-ledger-guardrail.test.ts` — RN-MV1 y RN-MV10

Copiá la estructura de `tests/unit/audit-modulo-enum.test.ts`: funciones exportadas y puras
para el parseo, el chequeo real, y un `describe` de autoverificación por mutación.

**Qué prohíbe:**

```ts
/**
 * BLOQUEANTE — RN-MV1 y RN-MV10: la existencia solo cambia por el libro mayor.
 *
 * `existencias_lote` es una caché derivada, mantenida EXCLUSIVAMENTE por el
 * trigger `existencias_lote_aplicar_movimiento` sobre `movimientos_stock`. Y
 * `movimientos_stock` solo lo escriben los RPC, que validan bajo `FOR UPDATE`.
 *
 * El riesgo que este guardrail cubre es R-02 de la spec: "agregar stock_actual
 * por performance". Aparece cuando una consulta va lenta y materializar es la
 * solución obvia; el atajo natural es un `.update()` sobre existencias_lote
 * desde un Service. Eso funciona perfecto en desarrollo y rompe el inventario
 * en producción, porque salta la validación bajo bloqueo y no deja asiento.
 *
 * Es sintáctico, como los otros dos guardrails del repo: detecta la FORMA de la
 * escritura, no su semántica. Es barato de sostener y atrapa exactamente el
 * atajo que la gente toma cuando tiene apuro.
 */
```

- Recorre `supabase/functions/api/src/modules/**/*.ts` (todos los `.ts`, no solo
  `.service.ts`: un controller también puede escribir).
- **Falla** si encuentra `.from("existencias_lote")` seguido —en la misma cadena— de
  `.insert(`, `.update(`, `.delete(` o `.upsert(`.
- **Falla** si encuentra lo mismo sobre `.from("movimientos_stock")`.
- **Ignora** las líneas comentadas, igual que hace `usosDeModulo` en el guardrail de auditoría.
- **NO mira las migraciones ni los tests**: el trigger escribe la caché y los tests de
  integración adulteran la caché a propósito (RN-MV11). Restringí el alcance a
  `src/modules/`.

**Assert de cobertura, con el mismo criterio que G1:**

```ts
it("el guardrail está escaneando archivos de verdad", () => {
  // Si el recorrido de directorios se rompe, el chequeo de abajo pasa en verde
  // por no encontrar nada, para siempre.
  expect(archivosEscaneados().length).toBeGreaterThan(10);
});
```

**Autoverificación por mutación**, obligatoria:

```ts
it("MUTACIÓN — una escritura a existencias_lote se detecta", () => {
  const violaciones = escrituraProhibida(
    "stock.service.ts",
    'await db.from("existencias_lote").update({ cantidad: 5 }).eq("lote_id", id);',
  );
  expect(violaciones).toHaveLength(1);
});

it("MUTACIÓN — un insert a movimientos_stock se detecta", () => {
  const violaciones = escrituraProhibida(
    "ventas.service.ts",
    'await db.from("movimientos_stock").insert({ cantidad: 1 });',
  );
  expect(violaciones).toHaveLength(1);
});

it("una LECTURA de existencias_lote no es violación", () => {
  const violaciones = escrituraProhibida(
    "stock.service.ts",
    'const { data } = await db.from("existencias_lote").select("*").eq("tenant_id", t);',
  );
  expect(violaciones).toEqual([]);
});

it("no confunde una escritura que está en un comentario", () => {
  expect(escrituraProhibida("x.ts", '// db.from("existencias_lote").update({})')).toEqual([]);
});
```

El tercer caso es el que importa tanto como los dos primeros: un guardrail que también prohíbe
leer sería inservible y alguien lo desactivaría en la tanda siguiente.

### 2.4. RN-LO8 en `tests/integration/stock.integration.test.ts`

| `it()` | Caso |
|---|---|
| `RN-LO8: el vencimiento próximo notifica y NO bloquea` | Tenant con `dias_alerta_vencimiento = 60`. Lote con existencia que vence en 30 días → `notificarLotesPorVencer` crea **una** fila en `notificaciones` con `origen='vencimiento_lote'` y `referencia_id = lote_id`. **Y el lote sigue apareciendo entre los candidatos FEFO.** |
| `RN-LO8: no se notifica dos veces el mismo lote` | Correr `notificarLotesPorVencer` dos veces → sigue habiendo **una** fila. Lo absorbe el `UNIQUE`, no una consulta previa. |
| `RN-LO8: un lote fuera del umbral no notifica` | Lote que vence en 90 días con umbral 60 → cero notificaciones. |
| `RN-LO8: un lote sin existencia no notifica` | Lote vencido pronto pero con `cantidad = 0` → cero notificaciones. Avisar de un lote que no existe físicamente es ruido que hace que se dejen de leer los avisos. |

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-MV1 | No existe ningún camino que cambie una existencia sin insertar en `movimientos_stock`. | `it('RN-MV1: ningún módulo escribe movimientos_stock fuera de un RPC', …)` |
| RN-MV10 | Ninguna ruta de aplicación modifica `existencias_lote`: solo el trigger. | `it('RN-MV10: ningún módulo escribe existencias_lote', …)` |
| RN-LO8 | Los lotes por vencer generan notificación y **permiten** la venta. | `it('RN-LO8: el vencimiento próximo notifica y NO bloquea', …)` |

## 4. Orden de trabajo

1. Escribí `tests/unit/stock-ledger-guardrail.test.ts` **completo, con su autoverificación**, y
   corrélo. Tiene que pasar: en este punto ningún service escribe esas tablas.
2. **Verificalo por mutación en el código real:** agregá temporalmente un
   `await db.from("existencias_lote").update({ cantidad: 1 });` en `stock.service.ts`, corré el
   guardrail, confirmá que **falla nombrando ese archivo y esa línea**, y sacalo. Reportá el
   mensaje.
3. Escribí `20260908000006_comercial_vistas_vencimiento.sql` (con marca) y aplicala.
4. Implementá `notificarLotesPorVencer` y sus cuatro casos de integración.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Completá `MATRIZ_RN_TESTS_COMERCIAL.md`: **las 25 RN de C2 (RN-MV1…MV12, RN-LO1…LO8,
   RN-CM1…CM5) tienen que quedar todas en ✅.** Si alguna sigue `PENDIENTE`, C2 no está cerrada
   y hay que decirlo en el reporte, no marcarla igual.

## 5. Definición de hecho

```bash
# 1. El guardrail nuevo corre y pasa
npx vitest run tests/unit/stock-ledger-guardrail.test.ts
# → passed, incluidos los cuatro casos de mutación

# 2. Los cuatro guardrails del módulo, juntos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → todos passed, 0 skipped

# 3. La vista existe y tiene su COMMENT
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_lotes_por_vencer'::regclass, 'pg_class');"
# → el texto del COMMENT ON VIEW

# 4. Los dos valores de origen_notificacion están disponibles
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='origen_notificacion';"
# → turno, vacunacion, vencimiento_lote, stock_minimo

# 5. Toda la etapa C2, de una
npx vitest run --config vitest.integration.config.ts \
  tests/integration/stock.integration.test.ts tests/integration/compras.integration.test.ts \
  tests/integration/rls.test.ts tests/integration/aislamiento-api.integration.test.ts \
  tests/integration/grants.integration.test.ts
# → "N passed", "0 skipped"

# 6. Ninguna RN de C2 quedó PENDIENTE
grep -c "PENDIENTE" MATRIZ_RN_TESTS_COMERCIAL.md
# → contá manualmente: no debe quedar ninguna fila de RN-MV, RN-LO ni RN-CM en PENDIENTE

# 7. Suites completas
npm test && npm run typecheck
```

**Al terminar esta tanda, corré el prompt de auditoría `C2_AUDITORIA.md`** antes de empezar C3.
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
