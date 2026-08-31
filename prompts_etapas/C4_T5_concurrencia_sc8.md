# ETAPA C4 · TANDA 5/5 — RN-SC8: el descuento concurrente no sobrevende
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T4 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Esta tanda entrega un solo test, y tiene su propia tanda por eso.**
>
> R-01 de la spec dice: *descontar existencia desde el Service —leer, validar en TypeScript,
> escribir— es lo natural viniendo de un CRUD, y funciona perfecto en desarrollo, donde nunca
> hay dos operaciones a la vez.* Y después: **«Sin ese test, esto se va a producción.»**
>
> Es el único test del módulo cuyo valor está en que nadie lo pueda diluir dentro de una tanda
> que entrega otras cinco cosas. Si esta tanda se resuelve rápido y sin ganas, la etapa C4
> queda aprobada con una condición de carrera adentro que va a aparecer el primer sábado a la
> mañana con dos mostradores atendiendo.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `tests/integration/guarderia.integration.test.ts` líneas 160-240 | **El patrón exacto a copiar.** `rpcReallyRan()`, `esExito()`, `Promise.all` de dos `.rpc()`, y la aserción dura contra la base al final. |
| `tests/integration/caja.integration.test.ts` | Tu propio test concurrente de RN-CJ4 en C3·T2: ya tenés el arnés de repeticiones. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.11 RN-SC8 y §12.1 R-01 | |
| `docs/ESPEC_MODULO_COMERCIAL.md` §12.3 punto 1 | Por qué el arnés de repetición va por variable de entorno y no editando el test. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | Tu propio RPC: el bloque de bloqueo que este test verifica. |
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

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | El bloque de concurrencia: RN-SC8, en sus cuatro variantes. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-SC8 **y el cierre de C4**: las 13 RN de la etapa en ✅. |

**No se crea ningún archivo y no se toca ninguna migración.** Si al escribir el test descubrís
que el RPC tiene un defecto, **frená y reportá**: la corrección es una tanda aparte, no un
parche adentro de esta.

## 2. Especificación exacta

### 2.1. El arnés

```ts
type RpcResult = { data: unknown; error: { message: string } | null };

/** Una llamada al RPC ejecutó de verdad (no fue "function not found" / cache). */
function rpcReallyRan(error: { message: string } | null): boolean {
  return !/could not find|schema cache/i.test(error?.message ?? "");
}

function esExito(r: RpcResult): boolean {
  return r.error === null && Array.isArray(r.data) && r.data.length === 1;
}

// El número de ciclos va por variable de entorno, NO editando el test. El final
// clásico de esta historia es que en CI tarda, alguien lo comenta "por ahora", y
// no vuelve nunca. Con la variable, bajarlo en CI es una decisión visible en la
// configuración y no un cambio escondido en un diff de tests.
const REPS = Number(process.env["CONCURRENCY_REPS"] ?? 50);
```

**El guard `rpcReallyRan()` no es opcional.** Si el `NOTIFY pgrst` faltara, las dos llamadas
fallarían con "no se encontró la función", el test contaría *cero éxitos y dos fallos*, y eso
se puede leer como "la exclusión funcionó". Es exactamente el falso verde que ese guard existe
para atrapar, y es la razón por la que el repo ya lo usa en guardería.

### 2.2. Los cuatro casos

**Caso 1 — el central: dos ventas de la última unidad.**

```ts
it("RN-SC8: dos ventas SIMULTÁNEAS de la última unidad → gana exactamente una", async () => {
  if (skipIfNoCredentials() || !tenantA.jwt) return;

  for (let i = 0; i < REPS; i++) {
    // Producto y lote nuevos en cada repetición: reusar el mismo lote haría que
    // la iteración 2 arrancara con existencia 0 y las dos llamadas fallaran por
    // INSUFFICIENT_STOCK, que es un verde que no prueba nada.
    const { productoId, loteId } = await sembrarProductoConExistencia(tenantA, 1);
    const sesion = await abrirSesion(tenantA);

    const [r1, r2] = await Promise.all([
      serviceDb.rpc("registrar_venta", ventaRpcParams(tenantA, sesion, productoId, 1)),
      serviceDb.rpc("registrar_venta", ventaRpcParams(tenantA, sesion, productoId, 1)),
    ]) as [RpcResult, RpcResult];

    // Las dos llamadas ejecutaron el RPC real.
    expect(rpcReallyRan(r1.error)).toBe(true);
    expect(rpcReallyRan(r2.error)).toBe(true);

    const exitos = [r1, r2].filter(esExito);
    const fallos = [r1, r2].filter((r) => r.error !== null);

    expect(exitos, `repetición ${i}: se esperaba exactamente 1 éxito`).toHaveLength(1);
    expect(fallos, `repetición ${i}: se esperaba exactamente 1 fallo`).toHaveLength(1);
    expect(fallos[0].error?.message ?? "").toContain("INSUFFICIENT_STOCK");

    // GARANTÍA DURA contra la base: no se vendió una unidad que no existía.
    const { data: exist } = await serviceDb
      .from("existencias_lote").select("cantidad")
      .eq("tenant_id", tenantA.tenantId).eq("lote_id", loteId).single();
    expect(Number(exist?.cantidad), `repetición ${i}: existencia negativa o mal`).toBe(0);

    // Y exactamente UNA venta registrada.
    const { count } = await serviceDb
      .from("ventas").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId).eq("sesion_caja_id", sesion);
    expect(count, `repetición ${i}: se registraron ${count} ventas`).toBe(1);

    await cerrarYLimpiar(tenantA, sesion);
  }
}, 300_000);   // timeout amplio: con REPS=200 son 400 llamadas al RPC
```

La aserción de existencia **contra la base** es lo que hace que el test valga. Contar éxitos y
fallos verifica el contrato del RPC; leer `existencias_lote` verifica que el inventario no
quedó mintiendo. Las dos, no una.

**Caso 2 — el deadlock: dos ventas que tocan los mismos lotes en orden inverso.**

Es el caso que verifica el `ORDER BY lote_id` del `FOR UPDATE`, y **no lo cubre el caso 1**.

```ts
it("RN-SC8: dos ventas que tocan los mismos lotes en orden inverso no se deadlockean", async () => {
  for (let i = 0; i < REPS; i++) {
    const { productoA, loteA } = await sembrarProductoConExistencia(tenantA, 10);
    const { productoB, loteB } = await sembrarProductoConExistencia(tenantA, 10);
    const sesion = await abrirSesion(tenantA);

    // Venta 1 pide [A, B]; venta 2 pide [B, A]. Sin ORDER BY lote_id en el
    // FOR UPDATE, cada transacción bloquea el primero de SU lista y espera el
    // segundo, que la otra ya tiene: deadlock, y Postgres mata a una con
    // 40P01. Con el ORDER BY, las dos piden los lotes en el MISMO orden y la
    // segunda simplemente espera.
    const [r1, r2] = await Promise.all([
      serviceDb.rpc("registrar_venta", ventaMultiItem(tenantA, sesion, [productoA, productoB])),
      serviceDb.rpc("registrar_venta", ventaMultiItem(tenantA, sesion, [productoB, productoA])),
    ]) as [RpcResult, RpcResult];

    expect(rpcReallyRan(r1.error)).toBe(true);
    expect(rpcReallyRan(r2.error)).toBe(true);

    // Hay existencia de sobra: las DOS tienen que tener éxito.
    expect([r1, r2].filter(esExito), `repetición ${i}`).toHaveLength(2);

    // Y ninguna murió por deadlock.
    for (const r of [r1, r2]) {
      expect(r.error?.message ?? "", `repetición ${i}: deadlock detectado`)
        .not.toMatch(/deadlock|40P01/i);
    }
    await cerrarYLimpiar(tenantA, sesion);
  }
}, 300_000);
```

**Caso 3 — N simultáneas sobre existencia M.**

```ts
it("RN-SC8: 10 ventas simultáneas sobre existencia 3 → exactamente 3 tienen éxito", async () => {
  const { productoId, loteId } = await sembrarProductoConExistencia(tenantA, 3);
  const sesion = await abrirSesion(tenantA);

  const resultados = await Promise.all(
    Array.from({ length: 10 }, () =>
      serviceDb.rpc("registrar_venta", ventaRpcParams(tenantA, sesion, productoId, 1))),
  ) as RpcResult[];

  resultados.forEach((r, i) => expect(rpcReallyRan(r.error), `llamada ${i}`).toBe(true));
  expect(resultados.filter(esExito)).toHaveLength(3);
  expect(resultados.filter((r) => r.error !== null)).toHaveLength(7);

  const { data } = await serviceDb.from("existencias_lote").select("cantidad")
    .eq("tenant_id", tenantA.tenantId).eq("lote_id", loteId).single();
  expect(Number(data?.cantidad)).toBe(0);
}, 120_000);
```

**Caso 4 — la anulación concurrente.**

```ts
it("RN-SC8: dos anulaciones simultáneas de la misma venta → una sola compensa", async () => {
  // Sin esto, dos anulaciones concurrentes generarían dos juegos de
  // contra-asientos y el lote terminaría con MÁS existencia de la que tenía.
  const ventaId = await venderUnaUnidad(tenantA);
  const [r1, r2] = await Promise.all([
    serviceDb.rpc("anular_venta", anularParams(tenantA, ventaId)),
    serviceDb.rpc("anular_venta", anularParams(tenantA, ventaId)),
  ]) as [RpcResult, RpcResult];

  expect(rpcReallyRan(r1.error)).toBe(true);
  expect(rpcReallyRan(r2.error)).toBe(true);
  expect([r1, r2].filter(esExito)).toHaveLength(1);
  expect([r1, r2].filter((r) => r.error !== null)[0].error?.message).toContain("SALE_ALREADY_VOIDED");

  // La existencia volvió al valor original UNA vez, no dos.
  // …asertá el valor exacto del lote.
});
```

### 2.3. Los helpers

Escribí `sembrarProductoConExistencia(tenant, cantidad)` y `abrirSesion(tenant)` como funciones
del archivo, reusando lo que ya tenés de C2 y C3. **Cada repetición siembra datos nuevos**: si
reusás el mismo lote, la segunda iteración arranca con existencia 0 y las dos llamadas fallan
con `INSUFFICIENT_STOCK` — dos fallos, cero éxitos, y el `expect(exitos).toHaveLength(1)` se
pone rojo por la razón equivocada, o peor, alguien lo "arregla" relajando la aserción.

`cerrarYLimpiar` borra las ventas, los movimientos y los lotes de la repetición. Con `REPS=200`
y sin limpieza, el test deja miles de filas en la base de pruebas.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| **RN-SC8** | Dos operaciones simultáneas sobre la última unidad: una tiene éxito y la otra falla con `INSUFFICIENT_STOCK`. **Nunca las dos.** | Los cuatro `it('RN-SC8: …')` de 2.2 |

## 4. Orden de trabajo

1. Escribí los helpers y el **caso 1**. Corrélo con `CONCURRENCY_REPS=50`.
2. **Verificá el test por mutación — este paso es la tanda.** Editá temporalmente
   `registrar_venta` moviendo la validación de existencia **antes** del `FOR UPDATE` (es decir,
   leer-validar-escribir, que es el patrón que R-01 describe). Corré el caso 1 con
   `CONCURRENCY_REPS=200`. **Tiene que fallar**, y tenés que anotar en qué repetición. Después
   volvé al RPC original.
   - Si con la mutación el test **no falla en 200 repeticiones**, el test no está probando
     nada: la carrera no se está produciendo. Revisá que `Promise.all` dispare de verdad en
     paralelo y que cada repetición siembre datos nuevos. **Frená y reportá antes de seguir.**
3. Escribí los casos 2, 3 y 4.
4. **Verificá el caso 2 por mutación:** sacá el `ORDER BY lote_id` del `FOR UPDATE`, corré con
   `CONCURRENCY_REPS=200`, confirmá que aparece un `40P01`, y volvé a ponerlo. Anotá en qué
   repetición apareció.
5. `npm run test:integration` completo.
6. Cerrá C4 en `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Los cuatro casos, con 50 repeticiones
npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts -t "RN-SC8"
# → 4 passed, 0 skipped

# 2. Con 200 repeticiones, al menos una vez
CONCURRENCY_REPS=200 npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts -t "RN-SC8"
# → 4 passed. Si falla UNA sola repetición de 200, hay una condición de carrera
#   real y la etapa NO está cerrada.

# 3. El ORDER BY del bloqueo sigue en su lugar
grep -n -B4 "FOR UPDATE" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
# → ORDER BY lote_id

# 4. Etapa C4 completa
npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts tests/integration/caja.integration.test.ts
npm test && npm run typecheck
# → todo en verde, 0 skipped

# 5. Ninguna RN de C4 quedó PENDIENTE
#    RN-VT1…VT8, RN-CJ1, RN-CJ3, RN-LO6, RN-SC8 → las 12 en ✅
```

**En el reporte, obligatorio:** las dos verificaciones por mutación con **el número de
repetición en el que falló cada una**. Sin ese número, no se sabe si el test detecta la
condición de carrera o si simplemente nunca se produjo.
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
