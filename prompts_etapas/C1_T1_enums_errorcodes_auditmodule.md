# ETAPA C1 · TANDA 1/5 — ENUMs, ErrorCodes y AuditModule
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** ninguna. Es la primera tanda del módulo comercial.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `CLAUDE.md` | Las 8 reglas de arquitectura inviolables y la sección "Aislamiento explícito en el camino de la API". |
| `PLAN_ETAPAS_COMERCIAL.md` §0 | Las seis correcciones a la spec y las decisiones de producto. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §9 completa | Los ENUMs. §7 completa: los ErrorCodes. |
| `supabase/migrations/20260828000002_auditoria_modulo_catalogs.sql` | **El patrón exacto a copiar** para un `ALTER TYPE modulo_auditoria ADD VALUE`. |
| `supabase/functions/api/src/shared/errors.ts` | Estilo de agrupación por comentarios y alineación del `=`. |
| `supabase/functions/api/src/shared/audit.ts` | El tipo `AuditModule` (unión de literales) — línea ~9. |
| `tests/unit/audit-modulo-enum.test.ts` | **El guardrail que vas a extender.** Leelo entero: ya parsea el ENUM desde las migraciones; le falta la dirección TypeScript. |

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

1. `supabase/migrations/20260901000001_comercial_enums.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/shared/errors.ts` | Los ErrorCode del módulo comercial (sección 2.2 de este prompt). |
| `supabase/functions/api/src/shared/audit.ts` | Los seis valores nuevos al tipo `AuditModule`. |
| `tests/unit/audit-modulo-enum.test.ts` | El chequeo de la dirección TypeScript (sección 2.4) — **guardrail G2**. |

**Nada más.** Esta tanda NO crea tablas, NO crea funciones y NO toca ningún service.
## 2. Especificación exacta

### 2.1. `20260901000001_comercial_enums.sql`

Va en **archivo propio y separado** de las tablas que usan estos tipos. Motivo, y no es
estilo: `ALTER TYPE … ADD VALUE` **no se puede usar en la misma transacción que lo agregó**.
Supabase aplica cada archivo de migración en su propia transacción, así que separar los
archivos es lo que hace que la migración siguiente pueda insertar `'stock'` en
`modulos_contratados`.

El archivo tiene exactamente estos cuatro bloques, en este orden:

**Bloque 1 — Tipos nuevos del módulo (15 `CREATE TYPE`):**

```sql
CREATE TYPE tipo_movimiento_stock AS ENUM (
  'entrada_compra', 'entrada_ajuste', 'entrada_devolucion', 'entrada_conversion',
  'entrada_inicial', 'sobrante_recuento',
  'salida_venta', 'salida_ajuste', 'salida_conversion', 'salida_devolucion_proveedor',
  'consumo_clinico', 'merma_fraccionamiento', 'merma_vencimiento', 'merma_rotura',
  'faltante_recuento'
);

CREATE TYPE estado_lote            AS ENUM ('disponible','bloqueado','dado_de_baja');
CREATE TYPE origen_lote            AS ENUM ('compra','conversion','ajuste','devolucion','inicial');
CREATE TYPE condicion_fiscal       AS ENUM ('consumidor_final','monotributista',
                                            'responsable_inscripto','exento',
                                            'no_alcanzado','sin_datos');
CREATE TYPE condicion_venta_producto AS ENUM ('libre','bajo_receta',
                                              'bajo_receta_archivada','uso_profesional');
CREATE TYPE tipo_item_venta        AS ENUM ('producto','servicio');
CREATE TYPE estado_venta           AS ENUM ('registrada','anulada');
CREATE TYPE condicion_pago_venta   AS ENUM ('contado','cuenta_corriente','mixto');
CREATE TYPE estado_facturacion     AS ENUM ('no_facturada','pendiente','facturada','anulada');
CREATE TYPE estado_compra          AS ENUM ('borrador','confirmada','anulada');
CREATE TYPE estado_sesion_caja     AS ENUM ('abierta','cerrada');
CREATE TYPE tipo_movimiento_caja   AS ENUM (
  'ingreso_venta','ingreso_cobro_cuenta_corriente','ingreso_manual',
  'egreso_pago_proveedor','egreso_devolucion','egreso_manual','egreso_retiro'
);
CREATE TYPE estado_recuento        AS ENUM ('borrador','aplicado','anulado');
CREATE TYPE estado_trazabilidad    AS ENUM ('no_aplica','pendiente','informado','confirmado');
```

Eso son 14. El decimoquinto es `tipo_movimiento_stock`, que está arriba de todo. **Contá que
sean 15 `CREATE TYPE` antes de seguir.**

**Bloque 2 — Dos valores nuevos en `modulo_vendible`:**

```sql
ALTER TYPE modulo_vendible ADD VALUE IF NOT EXISTS 'stock';
ALTER TYPE modulo_vendible ADD VALUE IF NOT EXISTS 'ventas';
```

Los valores actuales de `modulo_vendible` están en **español** (`historial_clinico`, `turnos`,
`guarderia`), así que estos también.

**Bloque 3 — Seis valores nuevos en `modulo_auditoria`. NO OMITAS ESTE BLOQUE:**

```sql
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'products';       -- catálogo, familias, unidades, conversiones
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'suppliers';      -- proveedores
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'purchases';      -- compras
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'inventory';      -- lotes, movimientos, ajustes, recuentos, fraccionamiento
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'sales';          -- ventas y devoluciones
ALTER TYPE modulo_auditoria ADD VALUE IF NOT EXISTS 'cash_register';  -- caja
```

Los valores actuales de `modulo_auditoria` están en **inglés**, así que estos también. La
incoherencia idiomática entre este ENUM y el dominio es preexistente: **se respeta, no se
corrige.** Un ENUM a medias en dos idiomas es peor que uno consistente en el idioma equivocado.

**Bloque 4 — Dos valores nuevos en `origen_notificacion`:**

```sql
ALTER TYPE origen_notificacion ADD VALUE IF NOT EXISTS 'vencimiento_lote';
ALTER TYPE origen_notificacion ADD VALUE IF NOT EXISTS 'stock_minimo';
```

Se adelantan acá aunque no se usen hasta C2·T5, por la misma restricción transaccional del
principio: un valor agregado no se puede usar en el archivo que lo agregó.

**El archivo NO lleva `NOTIFY pgrst`.** Ese `NOTIFY` corresponde a las migraciones que crean o
cambian funciones RPC, y esta no crea ninguna.

### 2.2. ErrorCodes en `shared/errors.ts`

Se agregan **al final del enum `ErrorCode`**, respetando el estilo del archivo: bloques
separados por un comentario `// ── Título ─────` y los `=` alineados dentro de cada bloque.

```ts
  // ── Catálogo comercial ────────────────────────────────────────────
  PRODUCT_CODE_DUPLICATE   = "PRODUCT_CODE_DUPLICATE",
  PRODUCT_NAME_DUPLICATE   = "PRODUCT_NAME_DUPLICATE",
  PRODUCT_NOT_FOUND        = "PRODUCT_NOT_FOUND",
  PRODUCT_IN_USE           = "PRODUCT_IN_USE",
  PRODUCT_INACTIVE         = "PRODUCT_INACTIVE",
  PRODUCT_WITHOUT_PRICE    = "PRODUCT_WITHOUT_PRICE",
  PRODUCT_NOT_SELLABLE     = "PRODUCT_NOT_SELLABLE",
  BARCODE_DUPLICATE        = "BARCODE_DUPLICATE",
  INVALID_TAX_RATE         = "INVALID_TAX_RATE",
  UNIT_NO_DECIMALS         = "UNIT_NO_DECIMALS",
  UNIT_INVALID_SCALE       = "UNIT_INVALID_SCALE",
  UNIT_IMMUTABLE           = "UNIT_IMMUTABLE",
  FAMILY_WITHOUT_BASE_UNIT = "FAMILY_WITHOUT_BASE_UNIT",
  FAMILY_NOT_FOUND         = "FAMILY_NOT_FOUND",

  // ── Proveedores ───────────────────────────────────────────────────
  SUPPLIER_DUPLICATE = "SUPPLIER_DUPLICATE",
  SUPPLIER_INACTIVE  = "SUPPLIER_INACTIVE",
  SUPPLIER_IN_USE    = "SUPPLIER_IN_USE",
  SUPPLIER_NOT_FOUND = "SUPPLIER_NOT_FOUND",

  // ── Existencias y lotes ───────────────────────────────────────────
  INSUFFICIENT_STOCK           = "INSUFFICIENT_STOCK",
  BATCH_NOT_FOUND              = "BATCH_NOT_FOUND",
  BATCH_EXPIRED                = "BATCH_EXPIRED",
  BATCH_BLOCKED                = "BATCH_BLOCKED",
  EXPIRY_REQUIRED              = "EXPIRY_REQUIRED",
  FEFO_OVERRIDE_WITHOUT_REASON = "FEFO_OVERRIDE_WITHOUT_REASON",
  MOVEMENT_IMMUTABLE           = "MOVEMENT_IMMUTABLE",
  REASON_REQUIRED              = "REASON_REQUIRED",
  INVALID_QUANTITY             = "INVALID_QUANTITY",
  STOCK_DRIFT_DETECTED         = "STOCK_DRIFT_DETECTED",

  // ── Compras ───────────────────────────────────────────────────────
  PURCHASE_ALREADY_CONFIRMED = "PURCHASE_ALREADY_CONFIRMED",
  PURCHASE_WITHOUT_ITEMS     = "PURCHASE_WITHOUT_ITEMS",
  PURCHASE_HAS_EXITS         = "PURCHASE_HAS_EXITS",
  PURCHASE_NOT_FOUND         = "PURCHASE_NOT_FOUND",
  SUPPLIER_INVOICE_DUPLICATE = "SUPPLIER_INVOICE_DUPLICATE",

  // ── Ventas ────────────────────────────────────────────────────────
  SALE_WITHOUT_ITEMS         = "SALE_WITHOUT_ITEMS",
  SALE_ALREADY_VOIDED        = "SALE_ALREADY_VOIDED",
  SALE_NOT_FOUND             = "SALE_NOT_FOUND",
  INVALID_ITEM_TYPE          = "INVALID_ITEM_TYPE",
  PAYMENT_MISMATCH           = "PAYMENT_MISMATCH",
  PAYMENT_REFERENCE_REQUIRED = "PAYMENT_REFERENCE_REQUIRED",
  PAYMENT_METHOD_DISABLED    = "PAYMENT_METHOD_DISABLED",
  RETURN_EXCEEDS_SOLD        = "RETURN_EXCEEDS_SOLD",
  RETURN_WITHOUT_SALE        = "RETURN_WITHOUT_SALE",

  // ── Caja ──────────────────────────────────────────────────────────
  CASH_SESSION_REQUIRED     = "CASH_SESSION_REQUIRED",
  CASH_SESSION_ALREADY_OPEN = "CASH_SESSION_ALREADY_OPEN",
  CASH_SESSION_CLOSED       = "CASH_SESSION_CLOSED",
  CASH_SESSION_NOT_FOUND    = "CASH_SESSION_NOT_FOUND",
  INVALID_OPENING_BALANCE   = "INVALID_OPENING_BALANCE",

  // ── Fraccionamiento ───────────────────────────────────────────────
  CONVERSION_NOT_DEFINED         = "CONVERSION_NOT_DEFINED",
  CONVERSION_NOT_FOUND           = "CONVERSION_NOT_FOUND",
  CONVERSION_CYCLE               = "CONVERSION_CYCLE",
  CONVERSION_REVERSE_NOT_ALLOWED = "CONVERSION_REVERSE_NOT_ALLOWED",
  INVALID_YIELD                  = "INVALID_YIELD",
  EXPIRY_AFTER_PARENT            = "EXPIRY_AFTER_PARENT",

  // ── Recuento ──────────────────────────────────────────────────────
  COUNT_ALREADY_APPLIED = "COUNT_ALREADY_APPLIED",
  COUNT_STALE           = "COUNT_STALE",
  COUNT_WITHOUT_DETAIL  = "COUNT_WITHOUT_DETAIL",
  COUNT_NOT_FOUND       = "COUNT_NOT_FOUND",

  // ── Reservados (sin uso todavía) ──────────────────────────────────
  PRESCRIPTION_REQUIRED   = "PRESCRIPTION_REQUIRED",
  CREDIT_ACCOUNT_DISABLED = "CREDIT_ACCOUNT_DISABLED",
  CREDIT_LIMIT_EXCEEDED   = "CREDIT_LIMIT_EXCEEDED",
```

`MODULE_NOT_LICENSED`, `VALIDATION_ERROR`, `FORBIDDEN` e `INTERNAL_ERROR` **ya existen** en el
enum. No los dupliques.

### 2.3. `AuditModule` en `shared/audit.ts`

El tipo actual es:

```ts
export type AuditModule =
  | "clients" | "pets" | "medical_records" | "appointments" | "daycare"
  | "users"   | "security" | "services" | "system" | "platform"
  // Catálogos clínicos del tenant (especies, razas, tipos de vacuna).
  | "catalogs";
```

Queda:

```ts
export type AuditModule =
  | "clients" | "pets" | "medical_records" | "appointments" | "daycare"
  | "users"   | "security" | "services" | "system" | "platform"
  // Catálogos clínicos del tenant (especies, razas, tipos de vacuna).
  | "catalogs"
  // Módulo comercial. Los seis valores existen en el ENUM modulo_auditoria desde
  // 20260901000001_comercial_enums.sql. Si un valor está acá y NO en el ENUM,
  // recordAudit loguea el error y sigue: la operación funciona y el asiento se
  // pierde en silencio. Ese es el bug que el guardrail de
  // tests/unit/audit-modulo-enum.test.ts existe para atrapar.
  | "products" | "suppliers" | "purchases" | "inventory" | "sales" | "cash_register";
```

### 2.4. Guardrail G2 — extender `tests/unit/audit-modulo-enum.test.ts`

El guardrail hoy verifica **una** dirección: todo `module:` que un Service le pasa a
`recordAudit` existe en el ENUM. Le falta la otra, y es la que importa para esta tanda.

**El modo de falla es asimétrico, y ese es todo el punto:**

- Un valor en el tipo `AuditModule` que NO está en el ENUM → `recordAudit` loguea en consola y
  sigue. La operación funciona, el asiento **no queda**, ningún test se pone rojo.
- Un valor en el ENUM que NO está en el tipo → el typecheck lo frena.

Agregá al archivo, **sin tocar lo que ya tiene**:

1. **Un parser del tipo TypeScript.** Función exportada `modulosDesdeTipoAuditModule(source: string): Set<string>` que recibe el contenido de `shared/audit.ts`, encuentra el bloque `export type AuditModule = … ;` y devuelve los literales entre comillas. Tiene que ignorar los literales que aparezcan dentro de comentarios `//`.

2. **El chequeo real**, en un `describe` nuevo:

```ts
describe("BLOQUEANTE: todo valor de AuditModule existe en el enum modulo_auditoria", () => {
  const enEnum = enumModulosDesdeMigraciones(migraciones());
  const enTipo = modulosDesdeTipoAuditModule(
    readFileSync(join(SHARED_DIR, "audit.ts"), "utf-8"),
  );

  it("el tipo se parsea y trae los módulos conocidos", () => {
    // Si esto falla, el parser dejó de entender el tipo y el chequeo de abajo
    // estaría dando verde por leer un conjunto vacío.
    expect(enTipo.size).toBeGreaterThan(10);
    expect(enTipo).toContain("medical_records");
    expect(enTipo).toContain("inventory");
  });

  it("ningún valor del tipo AuditModule falta en el enum de la base", () => {
    const faltantes = [...enTipo].filter((m) => !enEnum.has(m));
    expect(
      faltantes,
      faltantes.length === 0 ? "" :
        `${faltantes.length} valor(es) del tipo AuditModule que la base va a rechazar: ` +
        `${faltantes.join(", ")}\n\n` +
        "recordAudit es best-effort: esto NO rompe la operación, el asiento simplemente " +
        "no queda. Agregá el valor con ALTER TYPE modulo_auditoria ADD VALUE en una " +
        "migración nueva.",
    ).toEqual([]);
  });
});
```

3. **Autoverificación por mutación**, con el mismo criterio que ya usa el archivo — un
   guardrail que no se sabe si detecta algo no es un guardrail. Tres casos mínimos:

```ts
it("parsea los literales de la unión de tipos", () => {
  const s = 'export type AuditModule =\n  | "clients" | "pets"\n  | "inventory";';
  expect([...modulosDesdeTipoAuditModule(s)].sort()).toEqual(["clients", "inventory", "pets"]);
});

it("ignora un literal que está en un comentario", () => {
  const s = 'export type AuditModule =\n  // | "fantasma"\n  | "clients";';
  expect(modulosDesdeTipoAuditModule(s).has("fantasma")).toBe(false);
});

it("MUTACIÓN — un valor del tipo que no está en el enum se detecta", () => {
  const enEnum = enumModulosDesdeMigraciones([
    { name: "a.sql", content: "CREATE TYPE modulo_auditoria AS ENUM ('clients');" },
  ]);
  const enTipo = modulosDesdeTipoAuditModule('export type AuditModule = | "clients" | "inventory";');
  expect([...enTipo].filter((m) => !enEnum.has(m))).toEqual(["inventory"]);
});
```

## 3. RN que cubre esta tanda

| RN | Enunciado | Test a escribir |
|---|---|---|
| **RN-SC6** | Cada operación usa su módulo de auditoría, y los valores nuevos existen en el ENUM **antes** de que se escriba el primer service que los use. | `it('RN-SC6: ningún valor de AuditModule falta en el enum modulo_auditoria', …)` en `tests/unit/audit-modulo-enum.test.ts`. Citá el código RN en el título del `it()` del chequeo real. |

Es la única RN de esta tanda. Las demás necesitan tablas, que llegan en T3.

## 4. Orden de trabajo

1. Escribí `supabase/migrations/20260901000001_comercial_enums.sql` y aplicalo.
2. **Escribí el guardrail G2 extendido y corrélo ANTES de tocar `audit.ts`.** Tiene que estar
   en **verde**: en este punto el tipo `AuditModule` todavía no tiene los seis valores nuevos y
   el ENUM sí, así que no hay faltantes. Un guardrail que arranca en rojo no se sabe si detecta
   la condición o si está roto.
3. Agregá los seis valores a `AuditModule`. **Volvé a correr G2: tiene que seguir verde.**
4. **Verificá que G2 se pone rojo cuando debe.** Agregá temporalmente un valor inventado
   (`| "fantasma"`) al tipo, corré el guardrail, confirmá que falla nombrando `fantasma`, y
   sacalo. Este paso no deja rastro en el diff pero es el único que prueba que el guardrail
   sirve. Reportá que lo hiciste.
5. Agregá los ErrorCodes a `shared/errors.ts`.
6. `npm test && npm run typecheck` en verde.
7. Marcá RN-SC6 en `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

Cada uno de estos comandos, con su resultado esperado:

```bash
# 1. Los 15 tipos nuevos existen
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_type WHERE typname IN (
  'tipo_movimiento_stock','estado_lote','origen_lote','condicion_fiscal',
  'condicion_venta_producto','tipo_item_venta','estado_venta','condicion_pago_venta',
  'estado_facturacion','estado_compra','estado_sesion_caja','tipo_movimiento_caja',
  'estado_recuento','estado_trazabilidad');"
# → 14   (el decimoquinto, tipo_movimiento_stock, ya está en la lista: el total es 14 nombres)

# 2. modulo_vendible tiene cinco valores
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='modulo_vendible' ORDER BY e.enumsortorder;"
# → historial_clinico, turnos, guarderia, stock, ventas

# 3. modulo_auditoria tiene los seis nuevos
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='modulo_auditoria' ORDER BY e.enumsortorder;"
# → ... products, suppliers, purchases, inventory, sales, cash_register

# 4. origen_notificacion tiene cuatro valores
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='origen_notificacion' ORDER BY e.enumsortorder;"
# → turno, vacunacion, vencimiento_lote, stock_minimo

# 5. El guardrail G2 corre y pasa
npx vitest run tests/unit/audit-modulo-enum.test.ts
# → todos los tests passed, 0 skipped

# 6. Suite completa
npm test && npm run typecheck
# → sin errores
```

**Además, verificable a ojo en el diff:** `shared/errors.ts` no tiene ningún código duplicado
(`grep -o '[A-Z_]* = "' supabase/functions/api/src/shared/errors.ts | sort | uniq -d` no
devuelve nada).
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
