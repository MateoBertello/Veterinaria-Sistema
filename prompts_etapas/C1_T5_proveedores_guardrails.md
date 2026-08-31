# ETAPA C1 · TANDA 5/5 — Proveedores, guardrails G1 y G3, matriz de permisos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C1·T4 está en verde (`npm test` + `npm run typecheck`).
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Esta es la tanda que arma la red para las cinco etapas siguientes.** Los dos guardrails
> que escribís acá corren en **toda** tanda posterior y son lo que reemplaza a una auditoría
> por juicio al cierre de cada etapa. Escribilos con el mismo cuidado que el código de
> producción: un guardrail que no se sabe si detecta algo no es un guardrail, es decoración
> que da confianza falsa.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.3 (`proveedores`), §6.2, §6.11 | Proveedores y las RN de seguridad. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | **El patrón a copiar para el Service de proveedores.** |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | El patrón de permisos por método que escribiste en T4. |
| `tests/unit/tenant-filter-guardrail.test.ts` | **Guardrail G1.** Leelo entero, incluido el doc-comment de arriba: explica por qué es sintáctico y no semántico. Vas a agregarle un assert de cobertura, **sin tocar el motor**. |
| `tests/unit/_helpers/tenantFilterAnalysis.ts` | Las funciones `extractSchemaFromMigrations` y `scanSourceForViolations` que G1 usa. |
| `tests/integration/grants.integration.test.ts` | **Guardrail G3.** Hoy verifica funciones nombradas a mano. Vas a agregarle un bloque que las **enumera** desde las migraciones marcadas. |
| `supabase/migrations/20260710000001_revoke_execute_funciones.sql` | Por qué toda función nueva necesita su `REVOKE`/`GRANT`. |
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

1. `supabase/functions/api/src/modules/proveedores/proveedores.schemas.ts`
2. `supabase/functions/api/src/modules/proveedores/proveedores.service.ts`
3. `supabase/functions/api/src/modules/proveedores/proveedores.controller.ts`
4. `tests/unit/proveedores.service.test.ts`
5. `tests/unit/proveedores.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/proveedores", proveedoresRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | **G1**: el assert de cobertura del módulo comercial. |
| `tests/integration/grants.integration.test.ts` | **G3**: el bloque enumerador de funciones del módulo. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Las filas de RN-PRV2, PRV3, SC1, SC3, SC5, SC7. |

## 2. Especificación exacta

### 2.1. `proveedores.schemas.ts`

```ts
import { z } from "zod";

// Valores del ENUM condicion_fiscal (20260901000001_comercial_enums.sql).
export const CONDICION_FISCAL_VALUES = [
  "consumidor_final", "monotributista", "responsable_inscripto",
  "exento", "no_alcanzado", "sin_datos",
] as const;

export const CrearProveedorSchema = z.object({
  razonSocial:     z.string().trim().min(2).max(150),
  nombreFantasia:  z.string().trim().max(150).nullish(),
  // Sin validación de dígito verificador en esta etapa: solo formato y longitud.
  cuit:            z.string().trim().max(20).nullish(),
  condicionFiscal: z.enum(CONDICION_FISCAL_VALUES).nullish(),
  telefono:        z.string().trim().max(40).nullish(),
  email:           z.string().trim().email().max(150).nullish(),
  direccion:       z.string().trim().max(200).nullish(),
  contactoNombre:  z.string().trim().max(120).nullish(),
  observaciones:   z.string().max(500).nullish(),
  // Vincula la ficha de proveedor con la de cliente cuando son el mismo sujeto
  // real (decisión P-10, opción A). No las fusiona.
  clienteId:       z.string().uuid().nullish(),
});

export const ActualizarProveedorSchema = CrearProveedorSchema.partial();
export const CambiarEstadoProveedorSchema = z.object({ activo: z.boolean() });

export const ListarProveedoresQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  activo: z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});
```

### 2.2. `proveedores.service.ts`

`ProveedorService` con `crear`, `actualizar`, `cambiarEstado`, `obtenerPorId`,
`buscarPaginado`, copiando la forma de `ServicioService`. Auditoría con
`module: "suppliers"`.

**El `clienteId` que llega en el body NO está validado por venir de una FK.** Antes de
escribirlo, resolvé la fila destino filtrando por tenant:

```ts
// Un id de cliente de otra clínica entra sin que la base diga nada hasta el
// INSERT (donde la FK compuesta sí lo frena, pero con un 23503 ilegible).
// Se resuelve acá para devolver un 422 claro y para no confirmar por el
// mensaje de error que ese cliente existe en otro tenant.
if (data.clienteId) {
  const { data: cli } = await db
    .from("clientes")
    .select("id")
    .eq("id", data.clienteId)
    .eq("tenant_id", ctx.tenantId)
    .eq("deleted", false)
    .maybeSingle();

  if (!cli) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR, 422,
      "El cliente indicado no existe en esta clínica",
      [{ field: "clienteId", message: "Cliente no encontrado" }],
    );
  }
}
```

**RN-PRV1 — pre-query de unicidad**, con el mismo criterio que productos: pre-query por
`lower(razon_social)` y por `cuit` cuando viene, más captura del `23505` del `INSERT`, los dos
mapeados a `409 SUPPLIER_DUPLICATE`.

**RN-PRV2 — un proveedor inactivo no recibe compras.** Guard exportado, que consume
`confirmar_compra` en C2·T3:

```ts
/** RN-PRV2: un proveedor inactivo no recibe compras. Sus compras históricas se conservan. */
export async function assertProveedorActivo(proveedorId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("proveedores")
    .select("id, activo")
    .eq("id", proveedorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) throw new DomainError(ErrorCode.SUPPLIER_NOT_FOUND, 404, "Proveedor no encontrado en este tenant");
  if (!(data as { activo: boolean }).activo) {
    throw new DomainError(ErrorCode.SUPPLIER_INACTIVE, 422, "El proveedor está inactivo");
  }
}
```

**RN-PRV3 — un proveedor con compras no se borra.** No hay método `eliminar` ni ruta `DELETE`;
la protección dura es el `ON DELETE RESTRICT` desde `compras`, que se declara en C2·T3. La
fila de la matriz para RN-PRV3 queda **`PENDIENTE`** en esta tanda y se cierra en C2·T3, cuando
exista la tabla contra la que probar el rebote de la FK. **No la marques ✅ acá**: un test que
verifica que el método no existe no prueba que la base frene el borrado.

### 2.3. `proveedores.controller.ts` y rutas

```ts
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("stock"),
  requirePermission("manage_suppliers"),
];
```

Acá **no hay split lectura/escritura**: §8.1 define `manage_suppliers` como el permiso que
cubre "proveedores y compras", sin un `view_suppliers` aparte. Un solo `use("/*")`, como
`servicios.controller.ts`.

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/v1/proveedores` | `ok(items, { page, limit, total })` |
| GET | `/api/v1/proveedores/:id` | `ok(proveedor)` · 404 `SUPPLIER_NOT_FOUND` |
| POST | `/api/v1/proveedores` | 201 · 409 `SUPPLIER_DUPLICATE` |
| PUT | `/api/v1/proveedores/:id` | 200 |
| PATCH | `/api/v1/proveedores/:id/estado` | 200 |

En `main.ts`, junto al bloque del catálogo comercial:

```ts
app.route("/proveedores", proveedoresRouter);
```

### 2.4. Guardrail G1 — assert de cobertura en `tenant-filter-guardrail.test.ts`

**No toques el motor.** `scanSourceForViolations` y `extractSchemaFromMigrations` quedan como
están: ya derivan las tablas del DDL real, así que las cinco tablas nuevas del módulo entraron
solas a su alcance el día que se aplicó la migración de C1·T3.

Lo que falta es cubrir su **modo de falla silenciosa**: si el guardrail escanea **cero**
archivos del módulo comercial, no encuentra violaciones y da verde. Eso pasa si alguien cambia
el patrón de directorios, si el módulo se llama distinto, o si el `readdirSync` filtra por un
sufijo que los archivos nuevos no tienen.

Agregá un `describe` nuevo:

```ts
describe("BLOQUEANTE: el guardrail efectivamente ve los services del módulo comercial", () => {
  // Los directorios de módulo del comercial, en el orden en que las etapas los crean.
  // Cada tanda que agrega un módulo nuevo agrega su nombre acá. Es la ÚNICA lista
  // escrita a mano de este archivo, y existe porque su ausencia es indetectable:
  // un guardrail que no escanea nada pasa en verde para siempre.
  const MODULOS_COMERCIALES = ["productos", "proveedores"];

  const escaneados = listServiceFiles().map((f) => f.relPath);

  it.each(MODULOS_COMERCIALES)(
    "el service de %s está dentro del alcance del guardrail",
    (modulo) => {
      const match = escaneados.filter((p) => p.includes(`/modules/${modulo}/`));
      expect(
        match,
        `El guardrail de tenant_id no está escaneando ningún .service.ts de ` +
        `src/modules/${modulo}/. Sus consultas NO están verificadas y el aislamiento ` +
        `por tenant de ese módulo no tiene ninguna red. Archivos que sí ve:\n` +
        escaneados.join("\n"),
      ).not.toHaveLength(0);
    },
  );

  it("el esquema derivado de las migraciones incluye las tablas del módulo", () => {
    const schema = loadRealSchema();
    for (const tabla of ["productos", "familias_producto", "producto_conversiones", "proveedores"]) {
      expect(
        schema.tenantTables?.has?.(tabla) ?? [...(schema as never as string[])].includes(tabla),
        `La tabla ${tabla} no quedó en el esquema derivado del DDL: el guardrail no va ` +
        `a exigir el filtro de tenant en sus consultas.`,
      ).toBe(true);
    }
  });
});
```

**Adaptá la segunda aserción a la forma real que devuelve `extractSchemaFromMigrations`** —
leé `tests/unit/_helpers/tenantFilterAnalysis.ts` y usá su API tal cual es. Lo que no puede
cambiar es la intención: verificar que las cuatro tablas están en el conjunto que el guardrail
considera "con `tenant_id`".

**Verificación por mutación, obligatoria.** Comentá temporalmente un `.eq("tenant_id", …)` de
`proveedores.service.ts`, corré el guardrail, confirmá que **falla nombrando ese archivo y esa
línea**, y volvé a ponerlo. Reportá que lo hiciste. Sin este paso no sabés si G1 sirve.

### 2.5. Guardrail G3 — enumerador de funciones en `grants.integration.test.ts`

Hoy el archivo verifica funciones **nombradas a mano** (`cambiar_dueno_mascota`,
`crear_tenant`, `on_tenant_created`). Eso no escala: el módulo comercial va a crear una decena
de RPC entre C2 y C6, y una lista a mano se olvida exactamente en el que importa.

Agregá un bloque que las **descubra**:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/**
 * Funciones creadas por las migraciones del módulo comercial.
 *
 * Se descubren parseando las migraciones que llevan la marca `-- @modulo: comercial`
 * en su primera línea, en vez de una lista escrita a mano: un RPC nuevo entra solo
 * al alcance de este guardrail el día que se agrega su migración. Ese es todo el
 * punto — la lista a mano se olvida justo en el RPC que importa.
 */
export function funcionesDeMigracionesComerciales(
  files: Array<{ name: string; content: string }>,
): string[] {
  const nombres = new Set<string>();

  for (const { content } of files) {
    if (!/^\s*--\s*@modulo:\s*comercial\s*$/m.test(content)) continue;

    const sinComentarios = content.replace(/--[^\n]*/g, "");
    for (const m of sinComentarios.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi,
    )) {
      nombres.add(m[1]!.toLowerCase());
    }
  }

  return [...nombres].sort();
}

function migracionesComerciales() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(MIGRATIONS_DIR, name), "utf-8") }));
}
```

Y el chequeo real:

```ts
describeIntegration("RN-SC3 — ningún RPC del módulo comercial es ejecutable por anon ni authenticated", () => {
  const funciones = funcionesDeMigracionesComerciales(migracionesComerciales());

  it("el enumerador encuentra funciones (si no, este bloque no prueba nada)", () => {
    // Sin esta aserción, un parser roto o una marca `-- @modulo: comercial` olvidada
    // dejarían el it.each de abajo con cero casos, y el bloque pasaría en verde sin
    // haber verificado ni un solo GRANT.
    expect(funciones.length).toBeGreaterThan(0);
  });

  it.each(funciones)("RN-SC3: %s no la ejecuta anon ni authenticated", async (fn) => {
    const { data, error } = await serviceDb.rpc("exec_sql_scalar_check", {}).select?.() ?? {};
    // Si el proyecto no tiene un helper de SQL crudo, usá una consulta directa
    // vía PostgREST sobre una vista, o el cliente pg del arnés de integración.
    // Lo que la consulta tiene que evaluar es exactamente esto:
    //
    //   SELECT has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
    //          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
    //   FROM pg_proc p
    //   JOIN pg_namespace n ON n.oid = p.pronamespace
    //   WHERE n.nspname = 'public' AND p.proname = $1;
    //
    // Esperado: anon = false Y auth = false para TODAS las sobrecargas.
  });
});
```

**Resolvé el "cómo consultar `has_function_privilege`" leyendo cómo lo hace hoy
`grants.integration.test.ts`.** El archivo ya prueba grants: mirá con qué mecanismo lo hace
—intentando el RPC con un cliente `anon` y esperando el error `42501`, o consultando el
catálogo— y **usá el mismo**. No inventes uno nuevo ni agregues una dependencia.

Si el mecanismo existente es "invocar con cliente `anon` y esperar `42501`", el `it.each` queda:

```ts
it.each(funciones)("RN-SC3: anon no puede ejecutar %s", async (fn) => {
  const { error } = await anonDb.rpc(fn, {});
  // 42501 = insufficient_privilege. Cualquier otro error significa que el REVOKE
  // no está: la función se alcanzó y falló por otra razón (parámetros, negocio).
  expect(error?.code).toBe("42501");
});
```

En este momento el módulo tiene dos funciones (`producto_conversiones_sin_ciclo` y
`cantidad_valida_para_unidad`) y las dos son de C1·T3. **Que el `it.each` corra con solo dos
casos está bien**; lo que importa es que en C2 pase a cinco sin que nadie toque este archivo.

### 2.6. Matriz rol × endpoint (RN-SC7)

En `tests/unit/proveedores.controller.test.ts` y completando
`tests/unit/productos.controller.test.ts`, la matriz explícita de los endpoints del módulo:

| Endpoint | admin | veterinario | recepcionista | sin módulo `stock` |
|---|:--:|:--:|:--:|:--:|
| `GET /productos` | 200 | 200 | 200 | 403 `MODULE_NOT_LICENSED` |
| `POST /productos` | 201 | **403** | **403** | 403 `MODULE_NOT_LICENSED` |
| `PATCH /productos/:id/estado` | 200 | **403** | **403** | 403 |
| `GET /familias-producto` | 200 | 200 | 200 | 403 |
| `POST /familias-producto` | 201 | **403** | **403** | 403 |
| `GET /producto-conversiones` | 200 | 200 | 200 | 403 |
| `POST /producto-conversiones` | 201 | **403** | **403** | 403 |
| `GET /proveedores` | 200 | **403** | 200 | 403 |
| `POST /proveedores` | 201 | **403** | 200 | 403 |

Las celdas en negrita son las que prueban algo. Una matriz que solo verifica los 200 pasa igual
si `requirePermission` no está puesto.

**El veterinario no ve proveedores** (no tiene `manage_suppliers`, §8.2). **La recepcionista
sí**, y además puede crearlos.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-PRV2 | Un proveedor inactivo no recibe compras; sus compras históricas se conservan. → `422 SUPPLIER_INACTIVE` | `it('RN-PRV2: un proveedor inactivo no recibe compras', …)` en `proveedores.service.test.ts` |
| RN-SC1 | Ningún handler lee `tenant_id` de body, query o params. | `it('RN-SC1: el tenantId del body se ignora', …)` + el assert de cobertura de G1 |
| RN-SC3 | Los RPC solo los ejecuta `service_role`. | `it('RN-SC3: anon no puede ejecutar %s', …)` (`it.each`) en `grants.integration.test.ts` |
| RN-SC5 | Toda escritura deja asiento, con su `module` correcto y sin asientos huérfanos. | `it('RN-SC5: toda escritura deja asiento con module suppliers', …)` |
| RN-SC7 | Cada endpoint exige su permiso y su módulo. | La matriz de 2.6, un `it('RN-SC7: …')` por fila |

**RN-PRV3 queda `PENDIENTE`** y se cierra en C2·T3. **RN-SC2 y RN-SC4** ya se cerraron en
C1·T3; no las toques.

## 4. Orden de trabajo

1. Escribí los tests de `proveedores.service.test.ts` primero y corrélos: tienen que fallar por
   módulo inexistente.
2. Escribí schemas, service y controller de proveedores hasta que pasen.
3. Registrá la ruta en `main.ts`.
4. Escribí la matriz rol × endpoint (2.6) en los dos `*.controller.test.ts`.
5. **Guardrail G1**: agregá el assert de cobertura y **verificalo por mutación** (2.4).
6. **Guardrail G3**: agregá el enumerador y verificá que descubre las dos funciones de C1·T3.
   **Verificalo por mutación**: sacá temporalmente la línea `-- @modulo: comercial` de
   `20260901000004_comercial_catalogo_tenant.sql`, corré el guardrail, confirmá que el
   `it.each` se queda con cero casos **y que el test "el enumerador encuentra funciones" se
   pone rojo**, y volvé a ponerla.
7. `npm test && npm run typecheck && npm run test:integration` en verde.
8. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Los tests de la tanda pasan
npx vitest run tests/unit/proveedores.service.test.ts tests/unit/proveedores.controller.test.ts \
  tests/unit/productos.controller.test.ts tests/unit/tenant-filter-guardrail.test.ts
# → todos passed, 0 skipped

# 2. G3 descubre las funciones del módulo y las verifica
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → passed, 0 skipped. El it.each tiene que correr con AL MENOS 2 casos
#   (producto_conversiones_sin_ciclo, cantidad_valida_para_unidad).

# 3. Las cuatro migraciones del módulo llevan su marca
grep -L "@modulo: comercial" supabase/migrations/2026090100000*.sql
# → sin resultados (grep -L lista los archivos que NO tienen la marca)

# 4. Ninguna función del módulo es ejecutable por anon ni authenticated
psql "$DATABASE_URL" -c "SELECT p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
  ('producto_conversiones_sin_ciclo','cantidad_valida_para_unidad');"
# → anon = f y auth = f en las dos filas

# 5. Ningún schema del módulo acepta tenantId
grep -rn "tenantId" supabase/functions/api/src/modules/productos/productos.schemas.ts \
                    supabase/functions/api/src/modules/proveedores/proveedores.schemas.ts
# → sin resultados

# 6. Suites completas
npm test && npm run typecheck && npm run test:integration
```

**Además, en el reporte:** decí explícitamente que verificaste G1 y G3 **por mutación** y qué
mensaje de error mostró cada uno al ponerse rojo. Si no lo hiciste, la tanda no está cerrada:
son los dos chequeos de los que dependen las cinco etapas siguientes.
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
