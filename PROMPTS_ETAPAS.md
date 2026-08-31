# PROMPTS_ETAPAS.md — Módulo Comercial (C1 a C8)

Todos los prompts, listos para copiar y pegar. Cada bloque va precedido de una línea que dice
**cuándo usarlo** y **qué modelo le toca**. Los archivos individuales están en
`prompts_etapas/`; este archivo es la copia para pegar de a uno.

**Orden de ejecución:** de arriba hacia abajo, sin saltear. Cada tanda declara su precondición y
ninguna arranca hasta que la anterior esté en verde.

**Los bloques usan un cerco de cinco backticks** porque los prompts contienen bloques de tres
adentro. Copiá desde la línea siguiente al cerco de apertura hasta la anterior al de cierre.

**C1·T1** — Primera tanda del módulo. Sesión nueva y vacía. · **Gemini Flash** · Entrega: migración de ENUMs, ErrorCodes, `AuditModule` y el guardrail G2.

`````markdown
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
`````

**C1·T2** — Cuando C1·T1 está en verde. · **Gemini Flash** · Entrega: los 10 permisos, `on_tenant_created()`, el backfill y los seis archivos de `ModuloVendible`.

`````markdown
# ETAPA C1 · TANDA 2/5 — Permisos, roles y licenciamiento
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C1·T1 está en verde (`npm test` + `npm run typecheck`) y la migración
> `20260901000001_comercial_enums.sql` está aplicada.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `CLAUDE.md` | Regla 4 (licenciamiento) y regla 5 (permisos). |
| `docs/ESPEC_MODULO_COMERCIAL.md` §8 completa | Los diez permisos, el mapeo a roles y las tres partes de la migración. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.5 y §0.8 | Los seis archivos de `ModuloVendible` y la decisión P-01b. |
| `supabase/migrations/20260725000001_permiso_clientes_veterinario.sql` | **El patrón exacto a copiar.** Es el precedente de las tres partes: INSERT de permisos, `CREATE OR REPLACE on_tenant_created()`, y otorgamiento a tenants existentes. |
| `supabase/migrations/20260827000001_catalogos_por_tenant.sql` líneas 252-330 | **La versión VIGENTE de `on_tenant_created()`.** Es la que tenés que copiar y extender: la de `20260725000001` está desactualizada. |
| `supabase/functions/api/src/middleware/requireModule.ts` | El tipo `ModuloVendible` (línea 6) y cómo funciona la caché de 60 s. |
| `web/src/lib/navigation.ts` y `web/src/lib/planes.ts` | Los `Record<ModuloVendible, …>` que el typecheck va a exigir completar. |
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

1. `supabase/migrations/20260901000002_comercial_permisos_licenciamiento.sql`
2. `tests/integration/comercial-licenciamiento.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/middleware/requireModule.ts` | `"stock"` y `"ventas"` al tipo `ModuloVendible`. |
| `supabase/functions/api/src/modules/modulos/modulos.schemas.ts` | `"stock"` y `"ventas"` a `ModuloVendibleEnum`. |
| `web/src/types/index.ts` | `"stock"` y `"ventas"` al tipo `ModuloVendible` (línea ~852). |
| `web/src/lib/navigation.ts` | Dos entradas en `MODULE_NAV`. |
| `web/src/lib/planes.ts` | Dos entradas en `MODULO_META` y dos en `MODULOS_ORDEN`. |
| `web/src/lib/dashboard.ts` | Nada obligatorio; verificá que compile (usa `ModuloVendible` en `QUICK_ACTIONS`). |

**Nada más.** Esta tanda NO crea tablas de negocio y NO toca ningún service del módulo.

## 2. Especificación exacta

### 2.1. Los diez permisos

`name` en inglés, formato `verbo_recurso`, igual que los 12 que ya existen. La columna
`module` es `TEXT` y usa el mismo vocabulario que el ENUM `modulo_auditoria`.

| `name` | `display_name` | `module` | Cubre |
|---|---|---|---|
| `view_stock` | Ver stock | `inventory` | Catálogo, existencias, lotes, movimientos, kárdex. |
| `manage_stock` | Gestionar stock | `inventory` | Ajustes, mermas, recuento, bloqueo y desbloqueo de lotes. |
| `split_stock` | Fraccionar productos | `inventory` | Permiso propio: es una operación irreversible con implicancias distintas de `manage_stock`. |
| `consume_stock` | Consumir insumos clínicos | `inventory` | Descontar desde un acto clínico. |
| `manage_products` | Gestionar productos | `products` | Catálogo, familias, precios, conversiones. |
| `manage_suppliers` | Gestionar proveedores | `suppliers` | Proveedores y compras. |
| `view_sales` | Ver ventas | `sales` | Listado y detalle, incluidas las de otros usuarios. |
| `manage_sales` | Registrar ventas | `sales` | Vender y registrar devoluciones. |
| `void_sales` | Anular ventas | `sales` | Anulación con motivo. |
| `manage_cash` | Gestionar caja | `cash_register` | Abrir, mover y cerrar sesión. |

```sql
INSERT INTO permisos (name, display_name, module) VALUES
  ('view_stock',       'Ver stock',                  'inventory'),
  ('manage_stock',     'Gestionar stock',            'inventory'),
  ('split_stock',      'Fraccionar productos',       'inventory'),
  ('consume_stock',    'Consumir insumos clínicos',  'inventory'),
  ('manage_products',  'Gestionar productos',        'products'),
  ('manage_suppliers', 'Gestionar proveedores',      'suppliers'),
  ('view_sales',       'Ver ventas',                 'sales'),
  ('manage_sales',     'Registrar ventas',           'sales'),
  ('void_sales',       'Anular ventas',              'sales'),
  ('manage_cash',      'Gestionar caja',             'cash_register')
ON CONFLICT (name) DO NOTHING;
```

### 2.2. Mapeo a roles

El `admin` recibe **todos** los permisos automáticamente porque `on_tenant_created()` hace
`SELECT p.id FROM permisos p` sin filtro: los diez le llegan solos, no hay que tocarlo. Los
otros dos roles sí.

| Permiso | admin | veterinario | recepcionista |
|---|:--:|:--:|:--:|
| `view_stock` | auto | ✅ | ✅ |
| `manage_stock` | auto | — | — |
| `split_stock` | auto | ✅ | ✅ |
| `consume_stock` | auto | ✅ | — |
| `manage_products` | auto | — | — |
| `manage_suppliers` | auto | — | ✅ |
| `view_sales` | auto | — | — |
| `manage_sales` | auto | ✅ | ✅ |
| `void_sales` | auto | — | — |
| `manage_cash` | auto | — | ✅ |

**Veterinario suma:** `view_stock`, `split_stock`, `consume_stock`, `manage_sales`.
**Recepcionista suma:** `view_stock`, `split_stock`, `manage_suppliers`, `manage_sales`, `manage_cash`.

### 2.3. `on_tenant_created()` — qué cambia y qué no

Copiá **entera** la versión vigente de `20260827000001_catalogos_por_tenant.sql` (líneas
252-330) y cambiale exactamente dos cosas. No reescribas el resto: el paso 7
(`PERFORM public.seed_catalogos_tenant(p_tenant_id)`) y el resto de los `INSERT` tienen que
quedar idénticos, o una clínica nueva nace sin catálogo clínico.

**Cambio 1 — los arreglos de permisos de veterinario y recepcionista:**

```sql
  -- 3. Veterinario: permisos clínicos, de agenda y de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_vet, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_medical_history',
    'manage_appointments',
    'manage_schedules',
    'manage_catalogs',
    -- Módulo comercial (§8.2). El veterinario PUEDE fraccionar: abrir una caja de
    -- comprimidos ocurre al atender, no cuando el administrador está disponible. Si se
    -- restringe, se fracciona igual y se registra mal o no se registra, que es peor.
    -- NO ajusta stock: ajustar es corregir el inventario, consumir no lo es, y separarlo
    -- es lo que le da sentido al consumo clínico como tipo propio.
    'view_stock',
    'split_stock',
    'consume_stock',
    'manage_sales'
  );

  -- 4. Recepcionista: permisos de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_recep, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_appointments',
    'manage_daycare',
    'manage_catalogs',
    -- Módulo comercial (§8.2). Maneja caja pero NO tiene view_sales: ve las ventas que
    -- registra ella (el listado filtra por usuario_id); auditar el turno de otro es
    -- view_sales, que va solo al admin.
    'view_stock',
    'split_stock',
    'manage_suppliers',
    'manage_sales',
    'manage_cash'
  );
```

**Cambio 2 — el `INSERT` de `modulos_contratados` (decisión P-01b):**

`stock` se habilita en **`profesional` y `premium`**; `ventas` **solo en `premium`**. Escalonar
la dependencia con el precio es el motivo de haber partido el módulo en dos: un tenant
`profesional` controla insumos sin vender al público, que es exactamente el producto que D-16
describe.

```sql
  -- 6. Módulos según plan
  SELECT plan INTO v_plan FROM tenants WHERE id = p_tenant_id;

  INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta) VALUES
    (p_tenant_id, 'historial_clinico',
      true,
      CURRENT_DATE),
    (p_tenant_id, 'turnos',
      v_plan IN ('profesional', 'premium'),
      CASE WHEN v_plan IN ('profesional', 'premium') THEN CURRENT_DATE END),
    (p_tenant_id, 'guarderia',
      v_plan = 'premium',
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END),
    (p_tenant_id, 'stock',
      v_plan IN ('profesional', 'premium'),
      CASE WHEN v_plan IN ('profesional', 'premium') THEN CURRENT_DATE END),
    (p_tenant_id, 'ventas',
      v_plan = 'premium',
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END);
```

### 2.4. Otorgamiento a los tenants ya creados — NO OMITAS ESTE PASO

Los tenants existentes **no pasan** por `on_tenant_created()`. Sin esto, el módulo queda
invisible para ellos y el bug aparece semanas después como "a mi clínica no le anda". Es
exactamente el error que la migración de `manage_clients` documenta.

Dos partes, las dos idempotentes:

```sql
-- ── Permisos a los roles ya existentes ────────────────────────────────────
-- admin: todos los permisos nuevos (mismo criterio que on_tenant_created).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.name = 'admin'
  AND p.name IN ('view_stock','manage_stock','split_stock','consume_stock',
                 'manage_products','manage_suppliers','view_sales','manage_sales',
                 'void_sales','manage_cash')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.name = 'veterinario'
  AND p.name IN ('view_stock','split_stock','consume_stock','manage_sales')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.name = 'recepcionista'
  AND p.name IN ('view_stock','split_stock','manage_suppliers','manage_sales','manage_cash')
ON CONFLICT DO NOTHING;

-- ── Módulos contratados de los tenants ya existentes ──────────────────────
-- Mismo criterio de plan que on_tenant_created. `habilitado` según el plan del
-- tenant, no `true` a todos: dar de regalo un módulo vendible a los tenants
-- viejos es una decisión comercial que nadie tomó.
INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta)
SELECT t.id, 'stock',
       t.plan IN ('profesional','premium'),
       CASE WHEN t.plan IN ('profesional','premium') THEN CURRENT_DATE END
FROM tenants t
ON CONFLICT (tenant_id, modulo) DO NOTHING;

INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta)
SELECT t.id, 'ventas',
       t.plan = 'premium',
       CASE WHEN t.plan = 'premium' THEN CURRENT_DATE END
FROM tenants t
ON CONFLICT (tenant_id, modulo) DO NOTHING;
```

**Antes de escribir el `ON CONFLICT (tenant_id, modulo)`, verificá que esa restricción única
existe** en `modulos_contratados` (`supabase/migrations/20260614000002_tables.sql`). Si el
nombre de las columnas del índice difiere, ajustá el `ON CONFLICT`; si no existe ninguna
restricción única, **frená y reportá**: sin ella la migración no es idempotente y correrla dos
veces duplica filas.

### 2.5. Los seis archivos de código

**`supabase/functions/api/src/middleware/requireModule.ts`** (línea 6):

```ts
export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia" | "stock" | "ventas";
```

**`supabase/functions/api/src/modules/modulos/modulos.schemas.ts`:**

```ts
export const ModuloVendibleEnum = z.enum([
  "historial_clinico",
  "turnos",
  "guarderia",
  "stock",
  "ventas",
]);
```

**`web/src/types/index.ts`** (línea ~852):

```ts
export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia" | "stock" | "ventas";
```

**`web/src/lib/navigation.ts`** — `MODULE_NAV` es un `Record<ModuloVendible, …>`, así que el
typecheck exige las dos entradas:

```ts
const MODULE_NAV: Record<ModuloVendible, { label: string; href: string }> = {
  historial_clinico: { label: "Historial Clínico", href: "/historial" },
  turnos:            { label: "Turnos",            href: "/turnos" },
  guarderia:         { label: "Guardería",         href: "/guarderia" },
  stock:             { label: "Stock",             href: "/stock" },
  ventas:            { label: "Ventas",            href: "/ventas" },
};
```

**`web/src/lib/planes.ts`** — dos entradas en `MODULO_META` y las dos en `MODULOS_ORDEN`:

```ts
  stock: {
    sigla:       "ST",
    label:       "Stock",
    description: "Productos, lotes, existencias, compras y fraccionamiento.",
  },
  ventas: {
    sigla:       "VE",
    label:       "Ventas",
    description: "Mostrador, caja y arqueo. Requiere Stock contratado.",
  },
```

```ts
export const MODULOS_ORDEN: ModuloVendible[] = [
  "historial_clinico", "turnos", "guarderia", "stock", "ventas",
];
```

**`web/src/lib/dashboard.ts`** — no requiere cambios obligatorios. Verificá que compile y **no
agregues** `QUICK_ACTIONS` de stock ni de ventas: las rutas `/stock` y `/ventas` todavía no
existen y una acción rápida que lleva a un 404 es peor que no tenerla.

### 2.6. La dependencia `ventas` requiere `stock`

Es una **regla comercial, no una restricción de integridad**, así que va en el service de
contratación y no en la base. En `supabase/functions/api/src/modules/modulos/modulos.service.ts`,
en el método que habilita un módulo para un tenant (el que consume el toggle del Super Admin):

- Si se intenta habilitar `ventas` y `stock` no está habilitado para ese tenant →
  `DomainError(ErrorCode.VALIDATION_ERROR, 422, "El módulo 'ventas' requiere 'stock' contratado")`.
- Si se intenta **deshabilitar** `stock` y `ventas` está habilitado → mismo error, con el
  mensaje al revés.

Filtrá la consulta de verificación por `tenant_id`: corre con `getServiceDb()`.

### 2.7. `tests/integration/comercial-licenciamiento.integration.test.ts`

Copiá el arnés de `tests/integration/modulos.integration.test.ts` (import de `_env.ts`,
`describeIntegration`, creación de tenants con `serviceDb`). Casos:

1. **Un tenant `basico` nace sin stock ni ventas.** Crear tenant plan `basico`, correr
   `on_tenant_created`, verificar que `modulos_contratados` tiene las cinco filas y que
   `stock` y `ventas` están en `habilitado = false`.
2. **Un tenant `profesional` nace con stock y sin ventas.** `stock.habilitado = true`,
   `ventas.habilitado = false`.
3. **Un tenant `premium` nace con los dos.** Los dos en `true`.
4. **El admin de un tenant nuevo tiene los diez permisos.** Contar las filas de `rol_permiso`
   del rol `admin` que corresponden a los diez `name` nuevos → 10.
5. **El veterinario tiene exactamente cuatro y no más.** `view_stock`, `split_stock`,
   `consume_stock`, `manage_sales`; y **no** tiene `manage_stock`, `manage_products`,
   `view_sales`, `void_sales` ni `manage_cash`. Aserciones negativas explícitas: un test que
   solo verifica lo que sí está pasa igual si el rol tiene los diez.
6. **La recepcionista tiene exactamente cinco y no más.** Mismo criterio, con aserciones
   negativas sobre `consume_stock`, `manage_stock`, `manage_products`, `view_sales` y
   `void_sales`.
7. **`ventas` no se habilita sin `stock`.** Por la API del Super Admin, deshabilitar `stock` en
   un tenant premium → falla; habilitar `ventas` en un tenant con `stock` deshabilitado → falla.

Los tests de esta tanda **borran sus tenants al terminar** (`afterAll`), siguiendo lo que hace
`tests/integration/_teardown.ts`.

## 3. RN que cubre esta tanda

Ninguna RN se cierra completa acá. Esta tanda deja la **base de licenciamiento** sobre la que
RN-SC7 se verifica en C1·T5, cuando existan endpoints a los que aplicarle la matriz
rol × endpoint. En `MATRIZ_RN_TESTS_COMERCIAL.md` **no cambies ninguna fila**: RN-SC7 sigue
`PENDIENTE` hasta T5.

Los siete casos de 2.7 no llevan código RN en el `it()` — no corresponden a ninguna RN de la
spec. Nombralos en castellano descriptivo.

## 4. Orden de trabajo

1. Verificá el `ON CONFLICT` de `modulos_contratados` (2.4). Si no existe la restricción única,
   frená y reportá.
2. Escribí `tests/integration/comercial-licenciamiento.integration.test.ts` **primero** y
   corrélo: los siete casos tienen que **fallar**, porque los permisos y los módulos todavía no
   existen. Verificá que fallan por eso y no por un error de arnés.
3. Escribí `supabase/migrations/20260901000002_comercial_permisos_licenciamiento.sql` y aplicala.
4. Corré el test de nuevo: los siete casos en verde salvo el 7, que necesita 2.6.
5. Implementá la validación de dependencia de 2.6 en `modulos.service.ts`.
6. Tocá los seis archivos de código de 2.5.
7. `npm test && npm run typecheck && npm run test:integration` en verde.

## 5. Definición de hecho

```bash
# 1. Los diez permisos existen y no se duplicaron
psql "$DATABASE_URL" -c "SELECT count(*) FROM permisos WHERE name IN
  ('view_stock','manage_stock','split_stock','consume_stock','manage_products',
   'manage_suppliers','view_sales','manage_sales','void_sales','manage_cash');"
# → 10

# 2. La migración es idempotente: aplicarla dos veces no duplica nada
#    (volvé a correr el archivo y repetí la consulta 1) → 10

# 3. Ningún tenant existente quedó sin sus filas de modulos_contratados
psql "$DATABASE_URL" -c "SELECT count(*) FROM tenants t
  WHERE NOT EXISTS (SELECT 1 FROM modulos_contratados m
                    WHERE m.tenant_id = t.id AND m.modulo = 'stock');"
# → 0

# 4. Ningún rol veterinario quedó sin los cuatro permisos nuevos
psql "$DATABASE_URL" -c "SELECT count(*) FROM roles r WHERE r.name='veterinario'
  AND (SELECT count(*) FROM rol_permiso rp JOIN permisos p ON p.id=rp.permiso_id
       WHERE rp.rol_id=r.id AND p.name IN
       ('view_stock','split_stock','consume_stock','manage_sales')) <> 4;"
# → 0

# 5. Los tests de licenciamiento pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts tests/integration/comercial-licenciamiento.integration.test.ts
# → debe decir "7 passed" y "0 skipped". Si dice "skipped", faltan
#   TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY en .env
#   y la tanda NO está hecha.

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
`````

**C1·T3** — Cuando C1·T2 está en verde. · **Gemini Flash** · Entrega: catálogos globales, las cuatro tablas del tenant, RLS, trigger anti-ciclo y los tests de base.

`````markdown
# ETAPA C1 · TANDA 3/5 — Migración del catálogo y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C1·T2 está en verde (`npm test` + `npm run typecheck` + los siete casos de
> `comercial-licenciamiento.integration.test.ts`).
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Esta tanda escribe migración Y tests, a propósito.** Las reglas que entrega —código único,
> alícuota válida, escala coherente, nombre único, anti-ciclo, FK cross-tenant— **las hace
> cumplir la base**, no el código. Si el test se difiere a la tanda siguiente, la migración se
> da por buena sin que nadie haya comprobado que el trigger anti-ciclo existe.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1, §4.2, §4.3, §4.13 | Precisión numérica, catálogos globales, catálogo del tenant, RLS. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.1 y §6.2 | El enunciado exacto de RN-PR1…PR12 y RN-PRV1…PRV3. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.3 | Por qué `clientes` necesita `UNIQUE (id, tenant_id)`. |
| `supabase/migrations/20260827000001_catalogos_por_tenant.sql` | **El patrón exacto a copiar** para catálogos por tenant: `UNIQUE (id, tenant_id)` (líneas 105-107), políticas RLS, seed idempotente. |
| `supabase/migrations/20260725000003_hardening_authenticated_rls.sql` | El formato exacto de las políticas `FOR SELECT` con `usuario_activo()` y `tiene_permiso()`. Copialo al pie de la letra. |
| `supabase/migrations/20260725000005_usuarios_integridad_referencial.sql` | El patrón de FK compuesta: `UNIQUE (id, tenant_id)` del lado referenciado + `FOREIGN KEY (x_id, tenant_id) REFERENCES tabla(id, tenant_id)`, y la convención de nombre `<tabla_hija>_<rol>_tenant_fkey`. |
| `supabase/migrations/20260710000001_revoke_execute_funciones.sql` | Por qué toda función nueva necesita su `REVOKE`/`GRANT`: desde esta migración las funciones no nacen ejecutables por `PUBLIC`. |
| `tests/integration/rls.test.ts` | El arnés de dos tenants con JWT que vas a extender. Mirá `RLS-7` (catálogos por tenant): es el bloque más parecido al que tenés que escribir. |
| `tests/integration/aislamiento-api.integration.test.ts` | El bloque "Integridad cross-tenant en la BASE (FK compuestas, no solo el Service)" — es el patrón de RN-SC2. |
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

1. `supabase/migrations/20260901000003_comercial_catalogos_globales.sql`
2. `supabase/migrations/20260901000004_comercial_catalogo_tenant.sql`
3. `tests/integration/catalogo-comercial.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/rls.test.ts` | Un `describeIntegration` nuevo con el aislamiento de las cuatro tablas del tenant (RN-SC4). |
| `tests/integration/aislamiento-api.integration.test.ts` | Los casos de FK compuesta cross-tenant de las tablas nuevas (RN-SC2). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Las filas de las RN de esta tanda. |

**Nada más.** Esta tanda NO escribe ningún service, controller ni schema.

## 2. Especificación exacta

### 2.0. Precisión numérica — no la improvises

| Concepto | Tipo | Por qué |
|---|---|---|
| Cantidades de existencia | `NUMERIC(14,3)` | 3 decimales dan resolución de 1 gramo expresando en kg, que es lo que muestra la balanza. |
| Precios e importes | `NUMERIC(14,2)` | |
| Costos unitarios | `NUMERIC(14,4)` | **4 decimales, no 2.** El costo unitario es un cociente: una bolsa de $45.000 que rinde 14,2 kg da $3.169,0141 por kg. Redondear a 2 en cada conversión acumula error. |
| Alícuota de IVA | `NUMERIC(5,2)` | 21.00, 10.50, 27.00, 0.00. |
| Factor de conversión | `NUMERIC(14,4)` | |
| Porcentajes | `NUMERIC(5,2)` | |

**Nunca `float`.** Un total que da `1499.9999999998` es un bug que aparece en el ticket del
cliente.

### 2.1. `20260901000003_comercial_catalogos_globales.sql`

Dos catálogos **sin `tenant_id`**, como `permisos`. RLS de solo lectura para cualquier
autenticado; escritura solo `is_super_admin()`.

**`unidades_medida`:**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `codigo` | `TEXT NOT NULL UNIQUE` | |
| `nombre` | `TEXT NOT NULL` | |
| `abreviatura` | `TEXT NOT NULL` | Lo que se muestra al lado de la cantidad. |
| `admite_decimales` | `BOOLEAN NOT NULL` | Sin default: es una decisión por unidad, no un olvido. |
| `escala_decimal` | `SMALLINT NOT NULL DEFAULT 0` | `CHECK (escala_decimal BETWEEN 0 AND 3)` **y** `CHECK (admite_decimales OR escala_decimal = 0)`. Los dos CHECKs, con nombre: son RN-PR7. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

Seed idempotente con `ON CONFLICT (codigo) DO NOTHING`, once filas:

```sql
INSERT INTO unidades_medida (codigo, nombre, abreviatura, admite_decimales, escala_decimal) VALUES
  ('unidad',     'Unidad',      'u',    false, 0),
  ('kg',         'Kilogramo',   'kg',   true,  3),
  ('g',          'Gramo',       'g',    true,  3),
  ('l',          'Litro',       'l',    true,  3),
  ('ml',         'Mililitro',   'ml',   true,  3),
  ('comprimido', 'Comprimido',  'comp', false, 0),
  ('blister',    'Blíster',     'bl',   false, 0),
  ('bolsa',      'Bolsa',       'bol',  false, 0),
  ('caja',       'Caja',        'cj',   false, 0),
  ('dosis',      'Dosis',       'ds',   true,  3),
  ('pipeta',     'Pipeta',      'pip',  false, 0)
ON CONFLICT (codigo) DO NOTHING;
```

**`medios_pago`:**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `codigo` | `TEXT NOT NULL UNIQUE` | |
| `nombre` | `TEXT NOT NULL` | |
| `afecta_arqueo` | `BOOLEAN NOT NULL DEFAULT false` | **Solo `efectivo` en `true`.** Es la columna que hace que la cuenta corriente no rompa el arqueo sin implementar cuenta corriente (D-08). |
| `requiere_referencia` | `BOOLEAN NOT NULL DEFAULT false` | |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

```sql
INSERT INTO medios_pago (codigo, nombre, afecta_arqueo, requiere_referencia) VALUES
  ('efectivo',         'Efectivo',        true,  false),
  ('transferencia',    'Transferencia',   false, true),
  ('debito',           'Tarjeta de débito',  false, true),
  ('credito',          'Tarjeta de crédito', false, true),
  ('qr',               'Pago con QR',     false, true),
  ('cuenta_corriente', 'Cuenta corriente', false, false)
ON CONFLICT (codigo) DO NOTHING;
```

**RLS de los dos catálogos globales:**

```sql
ALTER TABLE unidades_medida ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_unidades_medida_lectura ON unidades_medida FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY p_unidades_medida_escritura ON unidades_medida FOR ALL
  USING (is_super_admin()) WITH CHECK (is_super_admin());
```

Ídem `medios_pago`. **Sin `FORCE ROW LEVEL SECURITY`** y **sin `GRANT` propio**:
`ALTER DEFAULT PRIVILEGES` ya deja las tablas nuevas con `SELECT` para `authenticated` y DML
para `service_role`.

### 2.2. `20260901000004_comercial_catalogo_tenant.sql`

**Convenciones que valen para las cuatro tablas:**

- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `updated_at` solo donde la tabla es mutable.
- **`UNIQUE (id, tenant_id)` en las cuatro**, con nombre `<tabla>_id_tenant_key`. Sin eso las
  FKs compuestas de C2 y C4 no se pueden declarar.
- Las FKs internas del módulo hacia tablas con `tenant_id` son **compuestas**:
  `FOREIGN KEY (x_id, tenant_id) REFERENCES tabla(id, tenant_id)`, con nombre
  `<tabla_hija>_<rol>_tenant_fkey`. **Nombrá el constraint explícitamente**: las FKs compuestas
  rompen las pistas de embed de PostgREST que nombran una columna, y el frontend va a tener que
  embeber por nombre de constraint, igual que ya hace con `usuarios_rol_tenant_fkey`.
- Índice en `tenant_id` y en las columnas de búsqueda.

**Paso 0 — `clientes` necesita su `UNIQUE (id, tenant_id)`:**

```sql
-- proveedores.cliente_id es una FK compuesta a clientes; el lado referenciado
-- necesita la UNIQUE que la respalde. El par (id, tenant_id) ya es único por
-- construcción porque id es PK: no hace falta guarda previa de datos.
ALTER TABLE clientes ADD CONSTRAINT clientes_id_tenant_key UNIQUE (id, tenant_id);
```

**`familias_producto`:**

```
id, tenant_id,
nombre           TEXT NOT NULL,
unidad_base_id   UUID NOT NULL REFERENCES unidades_medida(id) ON DELETE RESTRICT,
activo           BOOLEAN NOT NULL DEFAULT true,
created_at
```
- `CREATE UNIQUE INDEX uq_familias_tenant_nombre ON familias_producto (tenant_id, lower(nombre));`
  — mismo patrón que `uq_servicios_tenant_nombre`.
- `UNIQUE (id, tenant_id)`.
- `unidad_base_id` es `NOT NULL`: eso **es** RN-PR8. Sin unidad base no se puede agregar en
  reportes, así que la regla vive en la columna, no en el Service.

**`proveedores`:**

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `razon_social` | `TEXT NOT NULL` | |
| `nombre_fantasia` | `TEXT NULL` | |
| `cuit` | `TEXT NULL` | Sin validación de dígito verificador en esta etapa. |
| `condicion_fiscal` | `condicion_fiscal NULL` | El ENUM ya existe desde C1·T1. |
| `telefono`, `email`, `direccion`, `contacto_nombre`, `observaciones` | `TEXT NULL` | |
| `cliente_id` | `UUID NULL` | **FK compuesta** → `clientes (id, tenant_id)`, `ON DELETE SET NULL`. Vincula las dos fichas cuando son el mismo sujeto real; **no las fusiona** (decisión P-10, opción A). |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at`, `updated_at` | | |

- `CREATE UNIQUE INDEX uq_proveedores_tenant_razon ON proveedores (tenant_id, lower(razon_social));`
- `CREATE UNIQUE INDEX uq_proveedores_tenant_cuit ON proveedores (tenant_id, cuit) WHERE cuit IS NOT NULL;`
- `UNIQUE (id, tenant_id)`.
- Un proveedor con compras **no se borra**: la protección es el `ON DELETE RESTRICT` desde
  `compras`, que se declara en C2. Acá solo va la baja lógica con `activo`.

**`productos`:**

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `codigo` | `TEXT NOT NULL` | SKU interno. |
| `nombre` | `TEXT NOT NULL` | Incluye la presentación: *"Alimento X Adulto bolsa 15 kg"*. |
| `descripcion` | `TEXT NULL` | |
| `familia_id` | `UUID NULL` | FK compuesta → `familias_producto`, `ON DELETE RESTRICT`. |
| `unidad_medida_id` | `UUID NOT NULL REFERENCES unidades_medida(id) ON DELETE RESTRICT` | Inmutable tras el primer movimiento (RN-PR5, se implementa en T4). |
| `marca` | `TEXT NULL` | |
| `alicuota_iva` | `NUMERIC(5,2) NOT NULL DEFAULT 21.00` | `CHECK (alicuota_iva IN (0, 10.50, 21, 27))` — **es RN-PR4**. |
| `condicion_venta` | `condicion_venta_producto NOT NULL DEFAULT 'libre'` | |
| `controla_lote` | `BOOLEAN NOT NULL DEFAULT true` | |
| `controla_vencimiento` | `BOOLEAN NOT NULL DEFAULT true` | |
| `vida_util_post_apertura_dias` | `INTEGER NULL` | Propone el vencimiento del hijo al fraccionar (C6). |
| `precio_venta` | `NUMERIC(14,2) NULL` | Precio final **con IVA incluido**. `NULL` = no vendible al público. |
| `costo_reposicion` | `NUMERIC(14,4) NULL` | Último costo de compra. **No valúa movimientos.** |
| `margen_objetivo` | `NUMERIC(5,2) NULL` | |
| `stock_minimo` | `NUMERIC(14,3) NULL` | |
| `es_vendible` | `BOOLEAN NOT NULL DEFAULT true` | |
| `es_consumible_clinico` | `BOOLEAN NOT NULL DEFAULT false` | |
| `requiere_frio` | `BOOLEAN NOT NULL DEFAULT false` | **Columna reservada.** Sin uso. |
| `trazable` | `BOOLEAN NOT NULL DEFAULT false` | **Columna reservada.** Sin uso. |
| `codigo_barras` | `TEXT NULL` | **Columna reservada** para la búsqueda del mostrador. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at`, `updated_at` | | |

Índices y restricciones:
```sql
ALTER TABLE productos ADD CONSTRAINT productos_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE productos ADD CONSTRAINT uq_productos_tenant_codigo UNIQUE (tenant_id, codigo);   -- RN-PR1
CREATE UNIQUE INDEX uq_productos_tenant_nombre_activo
  ON productos (tenant_id, lower(nombre)) WHERE activo;                                       -- RN-PR12
CREATE UNIQUE INDEX uq_productos_tenant_barras
  ON productos (tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL;                     -- RN-PR11
CREATE INDEX idx_productos_tenant_activo  ON productos (tenant_id, activo);
CREATE INDEX idx_productos_tenant_nombre  ON productos (tenant_id, lower(nombre));
CREATE INDEX idx_productos_tenant_familia ON productos (tenant_id, familia_id);
```

**RN-PR12 es un índice único PARCIAL sobre los activos**, igual que `uq_servicios_tenant_nombre`.
Eso es lo que hace que el caso "reactivar un producto dado de baja cuyo nombre ya lo tiene otro
activo" falle: al pasar `activo` a `true` la fila entra al índice y colisiona.

**`producto_conversiones`:**

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `producto_origen_id` | `UUID NOT NULL` | FK compuesta → `productos`, `ON DELETE RESTRICT`. |
| `producto_destino_id` | `UUID NOT NULL` | FK compuesta → `productos`, `ON DELETE RESTRICT`. |
| `factor_teorico` | `NUMERIC(14,4) NOT NULL` | `CHECK (factor_teorico > 0)`. Unidades de destino que rinde **una** de origen. Bolsa 15 kg → kg: `15.0000`. |
| `merma_esperada_porcentaje` | `NUMERIC(5,2) NOT NULL DEFAULT 0` | |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | | |

- `UNIQUE (tenant_id, producto_origen_id, producto_destino_id)`.
- `CHECK (producto_origen_id <> producto_destino_id)`.
- `UNIQUE (id, tenant_id)`.
- **No hay columna `nivel`.** La profundidad es una propiedad del grafo, no un atributo de la
  fila. Si te dan ganas de agregarla, no lo hagas.

**Trigger anti-ciclo (RN-FR2):**

```sql
CREATE OR REPLACE FUNCTION public.producto_conversiones_sin_ciclo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ¿El destino alcanza al origen por alguna cadena ya cargada? Si sí, insertar
  -- esta fila cerraría un ciclo. Sin esto, el multi-nivel de D-06 se vuelve un
  -- bucle infinito en el reporte de familia la primera vez que alguien cargue
  -- comprimido→caja por error.
  IF EXISTS (
    WITH RECURSIVE alcanzables AS (
      SELECT pc.producto_destino_id AS nodo
      FROM producto_conversiones pc
      WHERE pc.tenant_id = NEW.tenant_id
        AND pc.producto_origen_id = NEW.producto_destino_id
      UNION
      SELECT pc.producto_destino_id
      FROM producto_conversiones pc
      JOIN alcanzables a ON a.nodo = pc.producto_origen_id
      WHERE pc.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM alcanzables WHERE nodo = NEW.producto_origen_id
  ) THEN
    RAISE EXCEPTION 'CONVERSION_CYCLE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_producto_conversiones_sin_ciclo
  BEFORE INSERT OR UPDATE ON producto_conversiones
  FOR EACH ROW EXECUTE FUNCTION public.producto_conversiones_sin_ciclo();

REVOKE ALL ON FUNCTION public.producto_conversiones_sin_ciclo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.producto_conversiones_sin_ciclo() TO service_role;
```

El `UNION` (no `UNION ALL`) del CTE es lo que hace que el recorrido termine si el grafo ya
tuviera un ciclo cargado de antes.

**Función `cantidad_valida_para_unidad()` (RN-PR6):**

La validación de decimales tiene que vivir **en la base, no solo en la aplicación**. Esta
función es la que van a usar los CHECKs y los RPC de C2 en adelante.

```sql
CREATE OR REPLACE FUNCTION public.cantidad_valida_para_unidad(
  p_cantidad NUMERIC,
  p_unidad_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN um.admite_decimales THEN
      -- La escala declarada por la unidad manda: 1,2345 kg con escala 3 no es válido.
      p_cantidad = round(p_cantidad, um.escala_decimal)
    ELSE
      p_cantidad = trunc(p_cantidad)
  END
  FROM unidades_medida um
  WHERE um.id = p_unidad_id;
$$;

REVOKE ALL ON FUNCTION public.cantidad_valida_para_unidad(NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cantidad_valida_para_unidad(NUMERIC, UUID) TO service_role;
```

Es `STABLE` y no `IMMUTABLE` porque lee una tabla. **No la uses en una columna generada** por
ese motivo; se llama desde los RPC y desde CHECKs de fila que la base evalúa al insertar.

**RLS de las cuatro tablas del tenant.** Una política `FOR SELECT` por tabla, copiando el
formato de `20260725000003_hardening_authenticated_rls.sql`:

```sql
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_productos_lectura ON productos FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );
```

| Tabla | Permiso en `tiene_permiso()` |
|---|---|
| `familias_producto` | `view_stock` |
| `productos` | `view_stock` |
| `producto_conversiones` | `view_stock` |
| `proveedores` | `manage_suppliers` |

- **Sin `FORCE ROW LEVEL SECURITY`.** Los RPC de C2 en adelante son `SECURITY DEFINER` y su
  dueño es el propietario de las tablas: forzar RLS los rompería.
- **Sin políticas de escritura.** `authenticated` no tiene `INSERT/UPDATE/DELETE` desde el
  hardening de julio; toda escritura pasa por la Edge Function con `service_role`.
- **Sin `GRANT` propio.**

**Cierre del archivo:** `NOTIFY pgrst, 'reload schema';`. Esta migración crea funciones, y el
`NOTIFY` es barato; olvidarlo cuesta un síntoma que engaña ("la función no existe" aunque la
migración se aplicó).

### 2.3. `tests/integration/catalogo-comercial.integration.test.ts`

Arnés: copiá el de `tests/integration/rls.test.ts` (dos tenants con `on_tenant_created`,
usuarios en `auth.users` vía API de admin, JWT de cada uno, `serviceDb` con service role).
Importá de `./_env.ts`. Borrá los tenants en `afterAll`.

**Los tests de esta tanda le pegan a la base, no a un mock.** Todas estas reglas las hace
cumplir un CHECK, un índice único o un trigger: un test que revisa el código fuente pasaría en
verde aunque la restricción no exista.

| `it()` | Caso |
|---|---|
| `RN-PR1: dos productos del mismo tenant no comparten código; dos tenants sí` | Insertar `codigo='SKU-1'` en A dos veces → la segunda falla (código `23505`). Insertar `SKU-1` en B → funciona. |
| `RN-PR4: la alícuota está en el conjunto admitido` | `alicuota_iva = 15.00` → viola el CHECK. `0`, `10.50`, `21`, `27` → los cuatro funcionan. |
| `RN-PR6: la cantidad respeta los decimales de su unidad` | `SELECT cantidad_valida_para_unidad(1.5, <id de comprimido>)` → `false`. `(1.5, <id de kg>)` → `true`. `(1.2345, <id de kg>)` → `false` (escala 3). `(1, <id de comprimido>)` → `true`. |
| `RN-PR7: escala coherente con admite_decimales` | `escala_decimal = 4` → viola el CHECK. `admite_decimales = false` con `escala_decimal = 2` → viola el otro CHECK. |
| `RN-PR8: una familia no existe sin unidad base` | `INSERT` de familia con `unidad_base_id = NULL` → falla por NOT NULL. |
| `RN-PR11: el código de barras es único cuando existe` | Dos productos con `codigo_barras='779...'` → la segunda falla. **Tres** productos con `codigo_barras = NULL` → los tres funcionan (el índice es parcial). |
| `RN-PR12: el nombre es único entre los activos, insensible a mayúsculas` | Dos productos activos con `"Alimento X"` y `"alimento x"` → la segunda falla. Dar de baja el primero, crear el segundo → funciona. **Reactivar el primero → falla**, porque al volver a `activo=true` entra al índice parcial. |
| `RN-PRV1: proveedor único por razón social y por CUIT` | Misma razón social en A dos veces → falla. Mismo CUIT en B → funciona. Dos proveedores con `cuit = NULL` → funcionan. |
| `RN-FR2: el grafo de conversiones es acíclico` | Cargar A→B y B→C. Intentar C→A → falla con `CONVERSION_CYCLE`. Intentar A→A → falla por el CHECK, **con un mensaje distinto** (verificá que no es el del trigger: son dos defensas distintas y confundirlas oculta que una de las dos no existe). |

**RN-SC2 va en `tests/integration/aislamiento-api.integration.test.ts`**, en el bloque
"Integridad cross-tenant en la BASE", siguiendo el patrón de los casos que ya están ahí:

| `it()` | Caso |
|---|---|
| `RN-SC2: un producto de A no puede colgar de una familia de B` | `INSERT` con `service_role` de un producto con `tenant_id = A` y `familia_id` de B → falla **por FK**, no por validación de aplicación. Verificá el código de error `23503`. |
| `RN-SC2: un proveedor de A no puede apuntar a un cliente de B` | Ídem con `proveedores.cliente_id`. |
| `RN-SC2: una conversión de A no puede referenciar un producto de B` | Ídem con `producto_conversiones.producto_destino_id`. |
| `RN-SC2: tampoco poniéndole a la fila el tenant de la otra clínica` | El caso que el archivo ya usa para catálogos: cambiar el `tenant_id` de la fila hija tampoco la deja apuntar cruzado. |

**RN-SC4 va en `tests/integration/rls.test.ts`**, como un `describeIntegration` nuevo con el
formato de `RLS-7`:

| `it()` | Caso |
|---|---|
| `RN-SC4: el usuario B no ve productos del tenant A` | Con el JWT de B, `select` sobre `productos` no devuelve ninguna fila de A, **ni pidiéndola por id**. |
| `RN-SC4: el usuario B no ve familias, conversiones ni proveedores de A` | Las otras tres tablas, mismo criterio. |
| `RN-SC4: el usuario A sí ve sus propios productos` | Descarta el verde falso por permisos: si A tampoco viera los suyos, el test anterior pasaría sin que RLS aísle nada. |
| `RN-SC4: B no puede escribir el catálogo comercial por PostgREST` | `insert` y `update` con el JWT de B sobre `productos` → rechazado. No hay políticas de escritura y `authenticated` perdió el DML. |

El caso "A sí ve los suyos" **no es opcional**. Sin él, un `GRANT` mal puesto que le saque el
`SELECT` a todo el mundo deja los otros tres tests en verde.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-PR1 | Código único por tenant; dos tenants pueden repetirlo. | `it('RN-PR1: dos productos del mismo tenant no comparten código; dos tenants sí', …)` |
| RN-PR4 | Alícuota obligatoria y dentro de 0 · 10,50 · 21 · 27. | `it('RN-PR4: la alícuota está en el conjunto admitido', …)` |
| RN-PR6 | Si la unidad no admite fracción, la cantidad es entera. Se valida en la base. | `it('RN-PR6: la cantidad respeta los decimales de su unidad', …)` |
| RN-PR7 | `escala_decimal` entre 0 y 3, y 0 cuando `admite_decimales = false`. | `it('RN-PR7: escala coherente con admite_decimales', …)` |
| RN-PR8 | Sin unidad base no se puede agregar en reportes. | `it('RN-PR8: una familia no existe sin unidad base', …)` |
| RN-PR11 | Código de barras único cuando existe; varios `NULL` no colisionan. | `it('RN-PR11: el código de barras es único cuando existe', …)` |
| RN-PR12 | Nombre único entre los activos, insensible a mayúsculas. → `409 PRODUCT_NAME_DUPLICATE` | `it('RN-PR12: el nombre es único entre los activos, insensible a mayúsculas', …)` |
| RN-PRV1 | Proveedor único por razón social normalizada y por CUIT informado. | `it('RN-PRV1: proveedor único por razón social y por CUIT', …)` |
| RN-FR2 | Ninguna cadena de conversiones vuelve a su origen. → `409 CONVERSION_CYCLE` | `it('RN-FR2: el grafo de conversiones es acíclico', …)` |
| RN-SC2 | Ninguna fila referencia a otra de otro tenant; lo garantiza la FK compuesta. | Cuatro `it('RN-SC2: …')` en `aislamiento-api.integration.test.ts` |
| RN-SC4 | Aislamiento de lectura por RLS. **Bloqueante.** | Cuatro `it('RN-SC4: …')` en `rls.test.ts` |

## 4. Orden de trabajo

1. Escribí las dos migraciones y aplicalas.
2. **Escribí los tests y corrélos ANTES de darte por satisfecho con la migración.** Acá el
   orden TDD estricto no aplica —la migración y el test se escriben juntos porque el test no
   compila sin las tablas— pero sí aplica esto: por **cada** CHECK, índice único y trigger,
   confirmá que el test **falla** si lo sacás. Probalo al menos con el trigger anti-ciclo:
   comentá el `CREATE TRIGGER`, corré `RN-FR2`, confirmá que se pone rojo, y volvé a ponerlo.
   Reportá que lo hiciste.
3. Extendé `rls.test.ts` y `aislamiento-api.integration.test.ts`.
4. `npm test && npm run typecheck && npm run test:integration` en verde.
5. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Las seis tablas existen
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('unidades_medida','medios_pago','familias_producto','productos',
                    'producto_conversiones','proveedores') ORDER BY 1;"
# → las seis

# 2. Las cinco tablas del tenant + clientes tienen su UNIQUE (id, tenant_id)
psql "$DATABASE_URL" -c "SELECT conrelid::regclass AS tabla FROM pg_constraint
  WHERE contype='u' AND conname LIKE '%_id_tenant_key' ORDER BY 1;"
# → clientes, especies, familias_producto, producto_conversiones, productos,
#   proveedores, razas, roles, tipos_vacuna

# 3. RLS activa en las seis, SIN force
psql "$DATABASE_URL" -c "SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname IN ('unidades_medida','medios_pago','familias_producto',
  'productos','producto_conversiones','proveedores');"
# → relrowsecurity = t en las seis; relforcerowsecurity = f en las seis

# 4. Ninguna política de escritura en las cuatro tablas del tenant
psql "$DATABASE_URL" -c "SELECT tablename, policyname, cmd FROM pg_policies
  WHERE tablename IN ('familias_producto','productos','producto_conversiones','proveedores');"
# → solo cmd = 'SELECT'. Si aparece INSERT, UPDATE, DELETE o ALL, está mal.

# 5. Las dos funciones nuevas NO son ejecutables por anon ni authenticated
psql "$DATABASE_URL" -c "SELECT p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p WHERE p.proname IN
  ('producto_conversiones_sin_ciclo','cantidad_valida_para_unidad');"
# → anon = f y auth = f en las dos

# 6. El seed es idempotente
#    Volvé a correr 20260901000003 y verificá:
psql "$DATABASE_URL" -c "SELECT count(*) FROM unidades_medida;"   # → 11
psql "$DATABASE_URL" -c "SELECT count(*) FROM medios_pago;"       # → 6

# 7. Solo el efectivo afecta el arqueo
psql "$DATABASE_URL" -c "SELECT codigo FROM medios_pago WHERE afecta_arqueo;"
# → efectivo, y nada más

# 8. Los tests pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts \
  tests/integration/catalogo-comercial.integration.test.ts \
  tests/integration/rls.test.ts \
  tests/integration/aislamiento-api.integration.test.ts
# → "N passed", "0 skipped". Un "skipped" significa que faltan las credenciales
#   de TEST_SUPABASE_* en .env y que la tanda NO está verificada.

# 9. Suites completas
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
`````

**C1·T4** — Cuando C1·T3 está en verde con 0 skipped. · **Gemini Flash** · Entrega: CRUD de productos, familias y conversiones.

`````markdown
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
`````

**C1·T5** — Cuando C1·T4 está en verde. · **Gemini Flash** · Entrega: CRUD de proveedores y **los guardrails G1 y G3**, que son la red de las siete etapas siguientes.

`````markdown
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
`````

**C2·T1** — Cuando C1 está completa y los tres guardrails verificados por mutación. · **Gemini Flash** · Entrega: `lotes`, `movimientos_stock`, `existencias_lote`, triggers y tests de base. **Es la migración más cara de revertir del módulo.**

`````markdown
# ETAPA C2 · TANDA 1/5 — Migración del libro mayor y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C1 completa y en verde: `npm test`, `npm run typecheck` y
> `npm run test:integration` con **0 skipped**, y los guardrails G1, G2 y G3 verificados por
> mutación.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es la migración más grande del módulo y la más cara de revertir.** §12.2 de la spec dice
> que cuatro de sus decisiones son irrecuperables sin reconstruir datos que para entonces no
> van a existir: `lote_padre_id`, el costo en el lote, el `operacion_id` y la escala
> `NUMERIC(14,3)`. Ninguna de las cuatro se puede "agregar después".
>
> Los tests van en **esta misma tanda** porque las reglas que entrega —inmutabilidad,
> existencia no negativa, signo derivado, coherencia tipo-documento— **las hace cumplir la
> base**. Un test que revisa el código fuente pasaría en verde aunque el trigger no exista.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1, §4.4, §4.5, §4.13, §9.1 | Precisión numérica, `lotes`, `movimientos_stock`, `existencias_lote`, productos sin control de lote, RLS, `signo_movimiento`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-02 y D-13 | Por qué el libro mayor es append-only y por qué `lote_padre_id` va acá aunque se use en C6. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.3 | El enunciado exacto de RN-MV1…MV12. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.3 | Los tres `UNIQUE (id, tenant_id)` que corresponden a esta tanda. |
| `supabase/migrations/20260901000004_comercial_catalogo_tenant.sql` | Tu propia migración de C1·T3: copiá su forma de declarar FKs compuestas, RLS e índices. |
| `supabase/migrations/20260725000005_usuarios_integridad_referencial.sql` | El patrón de FK compuesta y la convención de nombre de constraint. |
| `tests/integration/catalogo-comercial.integration.test.ts` | Tu propio arnés de C1·T3: dos tenants, `serviceDb`, teardown. Reusalo. |
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

1. `supabase/migrations/20260908000001_comercial_libro_mayor.sql`
2. `tests/integration/stock.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/rls.test.ts` | Aislamiento de `lotes`, `movimientos_stock` y `existencias_lote` (RN-SC4). |
| `tests/integration/aislamiento-api.integration.test.ts` | FK compuesta cross-tenant de las tablas nuevas (RN-SC2). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-MV2, MV3, MV4, MV5, MV8, y las notas de RN-SC2/SC4. |

**Esta tanda NO escribe ningún RPC, service ni controller.** `recalcular_existencias` y
`verificar_existencias` son C2·T2; `confirmar_compra` es C2·T3.

## 2. Especificación exacta

### 2.0. Los tres `UNIQUE (id, tenant_id)` que faltan

`movimientos_stock` lleva tres FKs compuestas a tablas de producción que todavía no tienen la
restricción única del lado referenciado. Van al principio del archivo:

```sql
ALTER TABLE mascotas          ADD CONSTRAINT mascotas_id_tenant_key          UNIQUE (id, tenant_id);
ALTER TABLE historial_clinico ADD CONSTRAINT historial_clinico_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE plan_vacunacion   ADD CONSTRAINT plan_vacunacion_id_tenant_key   UNIQUE (id, tenant_id);
```

El par `(id, tenant_id)` ya es único por construcción porque `id` es PK: no hace falta guarda
previa de datos.

**Las tres columnas que las usan son de C7 (consumo clínico), que está fuera del alcance del
plan actual.** Se crean igual, nullable y sin uso, porque agregarle una dimensión al libro
mayor después obliga a reescribir todas las consultas de existencia y a decidir
retroactivamente de dónde salió cada cosa.

### 2.1. `signo_movimiento()` — IMMUTABLE, y no es negociable

```sql
CREATE OR REPLACE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_tipo IN ('entrada_compra','entrada_ajuste','entrada_devolucion',
                              'entrada_conversion','entrada_inicial','sobrante_recuento')
              THEN 1 ELSE -1 END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento(tipo_movimiento_stock) TO service_role;
```

**Tiene que ser `IMMUTABLE`**, no `STABLE`: la columna generada `cantidad_con_signo` la usa, y
Postgres solo admite funciones `IMMUTABLE` en una expresión de columna generada. Si la marcás
`STABLE`, la migración falla al crear la tabla con un mensaje que no menciona esta función.

**No lleva `SET search_path`**: una función `IMMUTABLE` con `search_path` fijado no se puede
usar en una columna generada en algunas versiones de Postgres. Es `LANGUAGE sql` sin acceso a
tablas, así que no hay superficie que proteger.

Seis tipos son entrada; los nueve restantes, salida. Contá los quince del ENUM y verificá que
la partición cierra.

### 2.2. `lotes` — portador del costo y unidad de trazabilidad

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `tenant_id` | `UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` | |
| `producto_id` | `UUID NOT NULL` | FK compuesta → `productos`, `ON DELETE RESTRICT`. |
| `codigo_lote` | `TEXT NULL` | Número del fabricante. **Etiqueta, no identidad.** |
| `fecha_vencimiento` | `DATE NULL` | Obligatoria si `productos.controla_vencimiento` — se valida en el RPC de C2·T3, no con un CHECK (el CHECK tendría que leer otra tabla). |
| `fecha_ingreso` | `DATE NOT NULL DEFAULT CURRENT_DATE` | Desempate secundario de FEFO. |
| `costo_unitario_neto` | `NUMERIC(14,4) NOT NULL` | Sin IVA. |
| `costo_unitario_efectivo` | `NUMERIC(14,4) NOT NULL` | El que valúa los movimientos. **Se congela al crear el lote.** |
| `lote_padre_id` | `UUID NULL` | FK compuesta autorreferencial → `lotes (id, tenant_id)`, `ON DELETE RESTRICT`. **D-13: va acá aunque el fraccionamiento sea C6.** |
| `origen` | `origen_lote NOT NULL` | |
| `compra_item_id` | `UUID NULL` | Sin FK todavía: `compras_items` llega en C2·T3. La FK se agrega en esa migración. |
| `proveedor_id` | `UUID NULL` | FK compuesta → `proveedores`, `ON DELETE RESTRICT`. Denormalizado desde la compra: *"todos los lotes de este proveedor"* es la consulta de un retiro de mercadería. |
| `estado` | `estado_lote NOT NULL DEFAULT 'disponible'` | |
| `motivo_bloqueo` | `TEXT NULL` | `CHECK (estado <> 'bloqueado' OR motivo_bloqueo IS NOT NULL)` |
| `deposito_id` | `UUID NULL` | **Dimensión reservada** (decisión P-08). Sin FK, sin uso, sin índice. |
| `usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | FK simple, no compuesta: es lo que la spec declara. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Sin `updated_at`: el costo de un lote no se edita. |

```sql
ALTER TABLE lotes ADD CONSTRAINT lotes_id_tenant_key UNIQUE (id, tenant_id);
CREATE INDEX idx_lotes_fefo       ON lotes (tenant_id, producto_id, fecha_vencimiento);
CREATE INDEX idx_lotes_codigo     ON lotes (tenant_id, codigo_lote);
CREATE INDEX idx_lotes_padre      ON lotes (tenant_id, lote_padre_id);
CREATE INDEX idx_lotes_por_vencer ON lotes (tenant_id, fecha_vencimiento) WHERE estado = 'disponible';
CREATE INDEX idx_lotes_proveedor  ON lotes (tenant_id, proveedor_id);
```

**No hay `UNIQUE` sobre `codigo_lote`, y es a propósito.** Dos compras del mismo lote de
fabricante a distinto costo generan **dos filas**, porque el lote es el portador del costo. El
código se indexa para búsqueda, no para unicidad. Si te dan ganas de agregarle un `UNIQUE`,
estás rompiendo RN-LO1.

**`vencido` y `agotado` NO son estados.** Se derivan de `fecha_vencimiento < CURRENT_DATE` y de
`existencia = 0`. Guardar un estado derivado es el mismo error que guardar `stock_actual`.

### 2.3. `movimientos_stock` — el libro mayor. Append-only, sin excepciones

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `operacion_id` | `UUID NOT NULL` | Agrupa los movimientos de un mismo acto de negocio. **Sin esto, los tres movimientos de un fraccionamiento son asientos sueltos que nadie puede volver a agrupar.** |
| `tipo` | `tipo_movimiento_stock NOT NULL` | |
| `producto_id` | `UUID NOT NULL` | FK compuesta → `productos`. Denormalizado desde el lote: ahorra un join en la tabla más grande del módulo. |
| `lote_id` | `UUID NOT NULL` | FK compuesta → `lotes`, `ON DELETE RESTRICT`. |
| `cantidad` | `NUMERIC(14,3) NOT NULL CHECK (cantidad > 0)` | **Siempre positiva.** |
| `cantidad_con_signo` | `NUMERIC(14,3) GENERATED ALWAYS AS (cantidad * signo_movimiento(tipo)) STORED` | El signo lo determina el tipo, no quien inserta. Elimina la "entrada negativa". |
| `costo_unitario` | `NUMERIC(14,4) NOT NULL DEFAULT 0` | **Costo efectivo, congelado.** |
| `costo_total` | `NUMERIC(14,2) NOT NULL DEFAULT 0` | `round(cantidad * costo_unitario, 2)`. **Cero en `merma_fraccionamiento`.** |
| `motivo` | `TEXT NULL` | |
| `fefo_respetado` | `BOOLEAN NULL` | Solo en salidas. |
| `venta_item_id`, `compra_item_id`, `recuento_id` | `UUID NULL` | Sin FK todavía: las tablas destino llegan en C2·T3, C4·T1 y C5·T1. **Cada una de esas migraciones agrega su FK compuesta.** Anotalo con un comentario en el DDL. |
| `lote_destino_id` | `UUID NULL` | FK compuesta → `lotes`. Solo en `salida_conversion`. Redundante con `lotes.lote_padre_id` y **deliberado**: permite recorrer la cadena en las dos direcciones sin invertir el índice. |
| `historial_id` | `UUID NULL` | FK compuesta → `historial_clinico`. **Reservada para C7.** |
| `plan_vacunacion_id` | `UUID NULL` | FK compuesta → `plan_vacunacion`. **Reservada para C7.** |
| `mascota_id` | `UUID NULL` | FK compuesta → `mascotas`. **Reservada para C7.** |
| `receta_id`, `profesional_prescriptor_id` | `UUID NULL` | **Reservadas. Sin FK**, porque la tabla `receta` no existe y no se va a crear. |
| `trazabilidad_estado` | `estado_trazabilidad NOT NULL DEFAULT 'no_aplica'` | **Reservada.** |
| `trazabilidad_referencia_externa` | `TEXT NULL` | **Reservada.** |
| `deposito_id` | `UUID NULL` | **Dimensión reservada** (P-08). |
| `usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | **Sin `updated_at`: la tabla no se actualiza.** |

**CHECK de coherencia documental (RN-MV8).** A lo sumo uno de los cuatro documentos puede estar
presente, y tiene que ser el que le corresponde al tipo. Un `salida_venta` sin `venta_item_id`
es un bug que la base rechaza, no un caso a validar en el Service:

```sql
CONSTRAINT chk_movimientos_documento_coherente CHECK (
  (CASE WHEN venta_item_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN compra_item_id IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN recuento_id    IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN historial_id   IS NOT NULL THEN 1 ELSE 0 END) <= 1
  AND (tipo <> 'salida_venta'    OR venta_item_id  IS NOT NULL)
  AND (tipo <> 'entrada_compra'  OR compra_item_id IS NOT NULL)
  AND (tipo <> 'consumo_clinico' OR historial_id   IS NOT NULL)
  AND (tipo IN ('sobrante_recuento','faltante_recuento') OR recuento_id IS NULL)
)
```

**`salida_devolucion_proveedor` y `entrada_devolucion` no exigen documento** en esta versión:
la devolución de cliente referencia la venta por `operacion_id`, no por una columna propia
(§4.10 — no hay tabla nueva de devoluciones).

**Índices:**

```sql
CREATE INDEX idx_mov_lote      ON movimientos_stock (tenant_id, lote_id, created_at);  -- sostiene el kárdex
CREATE INDEX idx_mov_producto  ON movimientos_stock (tenant_id, producto_id, created_at);
CREATE INDEX idx_mov_operacion ON movimientos_stock (tenant_id, operacion_id);
CREATE INDEX idx_mov_tipo      ON movimientos_stock (tenant_id, tipo, created_at);
CREATE INDEX idx_mov_historial ON movimientos_stock (tenant_id, historial_id) WHERE historial_id IS NOT NULL;
```

**Inmutabilidad, en dos capas (RN-MV2):**

```sql
CREATE OR REPLACE FUNCTION public.movimientos_stock_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Capa 1: `authenticated` ya perdió UPDATE/DELETE en el hardening de julio.
  -- Capa 2 (esta): los Services escriben con service_role, que SÍ podría
  -- actualizar. La segunda capa no es redundante: es la ÚNICA que frena al
  -- camino real de escritura del sistema.
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_movimientos_stock_inmutable
  BEFORE UPDATE OR DELETE ON movimientos_stock
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_stock_inmutable();

REVOKE ALL ON FUNCTION public.movimientos_stock_inmutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.movimientos_stock_inmutable() TO service_role;
```

### 2.4. `existencias_lote` — caché derivada, mantenida solo por trigger

| Columna | Tipo | Notas |
|---|---|---|
| `lote_id` | `UUID PRIMARY KEY` | FK compuesta → `lotes`, `ON DELETE RESTRICT`. |
| `tenant_id` | `UUID NOT NULL` | |
| `producto_id` | `UUID NOT NULL` | Permite bloquear y consultar por producto sin join. |
| `cantidad` | `NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (cantidad >= 0)` | **La última red (RN-MV5).** |
| `actualizado_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

`CREATE INDEX idx_existencias_producto ON existencias_lote (tenant_id, producto_id);`

**No es la fuente de la verdad**: es un índice materializado del libro mayor. **No se escribe
desde la aplicación**: no hay endpoint, service ni permiso que la toque. **Es reconstruible**:
`recalcular_existencias()` la rehace y `verificar_existencias()` reporta desvíos (C2·T2).

```sql
CREATE OR REPLACE FUNCTION public.existencias_lote_aplicar_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO existencias_lote (lote_id, tenant_id, producto_id, cantidad, actualizado_at)
  VALUES (NEW.lote_id, NEW.tenant_id, NEW.producto_id, NEW.cantidad_con_signo, now())
  ON CONFLICT (lote_id) DO UPDATE
    SET cantidad       = existencias_lote.cantidad + EXCLUDED.cantidad,
        actualizado_at = now();
  RETURN NULL;   -- AFTER trigger: el valor de retorno se ignora
END;
$$;

CREATE TRIGGER trg_existencias_lote_aplicar
  AFTER INSERT ON movimientos_stock
  FOR EACH ROW EXECUTE FUNCTION public.existencias_lote_aplicar_movimiento();

REVOKE ALL ON FUNCTION public.existencias_lote_aplicar_movimiento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.existencias_lote_aplicar_movimiento() TO service_role;
```

El `CHECK (cantidad >= 0)` corre **dentro de esta misma transacción**: si un movimiento dejaría
la existencia negativa, el `INSERT` en `movimientos_stock` rebota. Esa es la última red de
RN-MV5; la primera es la validación bajo `FOR UPDATE` de los RPC.

**Solo `AFTER INSERT`.** No hace falta trigger de `UPDATE` ni de `DELETE` sobre
`movimientos_stock` porque el trigger de inmutabilidad los impide.

### 2.5. RLS

Las tres tablas, política `FOR SELECT` con `tiene_permiso('view_stock')`, copiando el formato
de C1·T3. Sin `FORCE`, sin políticas de escritura, sin `GRANT` propio.

### 2.6. `tests/integration/stock.integration.test.ts`

Arnés: reusá el de `catalogo-comercial.integration.test.ts`. Vas a necesitar un helper que
siembre un producto, un lote y un movimiento con `serviceDb`; escribilo una vez y exportalo,
porque C2·T2 y C2·T3 lo van a reusar.

| `it()` | Caso |
|---|---|
| `RN-MV2: un movimiento no se puede actualizar ni borrar, tampoco con service_role` | `serviceDb.from("movimientos_stock").update({ cantidad: 999 }).eq("id", movId)` → `error.message` contiene `MOVEMENT_IMMUTABLE`. Ídem `.delete()`. **Los dos casos, no uno**: el trigger es `BEFORE UPDATE OR DELETE` y una implementación que solo cubra `UPDATE` pasaría con un solo test. |
| `RN-MV3: la cantidad es siempre positiva` | `INSERT` con `cantidad: 0` → viola el CHECK. Con `cantidad: -5` → viola el CHECK. |
| `RN-MV4: el signo lo determina el tipo` | Insertar `entrada_compra` con `cantidad: 10` → `cantidad_con_signo = 10`. Insertar `salida_venta` con `cantidad: 3` → `cantidad_con_signo = -3`. Intentar **escribir** `cantidad_con_signo` en el `INSERT` → error de columna generada. |
| `RN-MV5: la existencia nunca queda negativa` | Con un lote de existencia 5, insertar una `salida_venta` de 8 directamente por PostgREST con `service_role` → el `INSERT` falla por el CHECK de `existencias_lote`. Verificá que la existencia siguió en 5. |
| `RN-MV8: cada tipo exige su documento y prohíbe los demás` | `salida_venta` sin `venta_item_id` → falla. `entrada_compra` con `venta_item_id` **y** `compra_item_id` → falla (más de un documento). `entrada_compra` con `venta_item_id` en vez de `compra_item_id` → falla. |
| `la caché se mantiene sola` | Insertar tres movimientos (+10, −3, +5) sobre un lote → `existencias_lote.cantidad` = 12. **Sin llamar a ninguna función**: lo hace el trigger. Es la base sobre la que C2·T2 prueba RN-MV11 y MV12. |

**RN-SC2 en `aislamiento-api.integration.test.ts`:** un `movimientos_stock` de A con
`lote_id` de B falla **por FK** (`23503`); un `lotes` de A con `producto_id` de B, ídem.

**RN-SC4 en `rls.test.ts`:** B no ve `lotes`, `movimientos_stock` ni `existencias_lote` de A;
A sí ve los suyos; B no puede escribir ninguna de las tres por PostgREST.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-MV2 | Ni `UPDATE` ni `DELETE` sobre un movimiento, tampoco con `service_role`. → `409 MOVEMENT_IMMUTABLE` | `it('RN-MV2: un movimiento no se puede actualizar ni borrar, tampoco con service_role', …)` |
| RN-MV3 | La dirección la da el tipo, no el signo: la cantidad es siempre positiva. | `it('RN-MV3: la cantidad es siempre positiva', …)` |
| RN-MV4 | `cantidad_con_signo` es columna generada a partir del tipo. | `it('RN-MV4: el signo lo determina el tipo', …)` |
| RN-MV5 | Existencia nunca negativa, garantizado por el CHECK de `existencias_lote`. → `409 INSUFFICIENT_STOCK` | `it('RN-MV5: la existencia nunca queda negativa', …)` |
| RN-MV8 | Cada tipo exige el documento que le corresponde y prohíbe los demás. | `it('RN-MV8: cada tipo exige su documento y prohíbe los demás', …)` |
| RN-SC2 | Ninguna fila referencia a otra de otro tenant; lo garantiza la FK compuesta. | Dos `it('RN-SC2: …')` más en `aislamiento-api.integration.test.ts` |
| RN-SC4 | Aislamiento de lectura por RLS sobre las tres tablas nuevas. **Bloqueante.** | Tres `it('RN-SC4: …')` más en `rls.test.ts` |

## 4. Orden de trabajo

1. Escribí la migración con la marca `-- @modulo: comercial` en la primera línea y aplicala.
2. Escribí los tests. **Por cada CHECK y cada trigger, verificá que el test se pone rojo si lo
   sacás.** Hacelo al menos con el trigger de inmutabilidad y con el CHECK de coherencia
   documental, y reportá el mensaje de error que mostró cada uno.
3. Extendé `rls.test.ts` y `aislamiento-api.integration.test.ts`.
4. `npm test && npm run typecheck && npm run test:integration` en verde.
5. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Las tres tablas y sus constraints
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('lotes','movimientos_stock','existencias_lote');"
# → las tres

# 2. cantidad_con_signo es GENERATED, no una columna común
psql "$DATABASE_URL" -c "SELECT column_name, is_generated, generation_expression
  FROM information_schema.columns
  WHERE table_name='movimientos_stock' AND column_name='cantidad_con_signo';"
# → is_generated = ALWAYS

# 3. signo_movimiento es IMMUTABLE
psql "$DATABASE_URL" -c "SELECT proname, provolatile FROM pg_proc WHERE proname='signo_movimiento';"
# → provolatile = 'i'   (i = immutable; 's' = stable estaría MAL)

# 4. El trigger de inmutabilidad existe y cubre UPDATE y DELETE
psql "$DATABASE_URL" -c "SELECT tgname, tgtype FROM pg_trigger
  WHERE tgrelid='movimientos_stock'::regclass AND NOT tgisinternal;"
# → trg_movimientos_stock_inmutable y trg_existencias_lote_aplicar

# 5. lote_padre_id existe DESDE ESTA MIGRACIÓN (D-13)
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='lotes' AND column_name IN ('lote_padre_id','deposito_id');"
# → las dos

# 6. Las columnas reservadas de C7 existen y son nullable
psql "$DATABASE_URL" -c "SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name='movimientos_stock' AND column_name IN
  ('historial_id','plan_vacunacion_id','mascota_id','receta_id',
   'profesional_prescriptor_id','trazabilidad_estado','deposito_id');"
# → las siete, todas is_nullable = YES salvo trazabilidad_estado (NOT NULL DEFAULT 'no_aplica')

# 7. Los cinco UNIQUE (id, tenant_id) acumulados
psql "$DATABASE_URL" -c "SELECT conrelid::regclass FROM pg_constraint
  WHERE contype='u' AND conname LIKE '%_id_tenant_key' ORDER BY 1;"
# → clientes, especies, familias_producto, historial_clinico, lotes, mascotas,
#   plan_vacunacion, producto_conversiones, productos, proveedores, razas, roles,
#   tipos_vacuna

# 8. La migración lleva su marca
head -1 supabase/migrations/20260908000001_comercial_libro_mayor.sql
# → -- @modulo: comercial

# 9. Los tests pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts \
  tests/integration/stock.integration.test.ts tests/integration/rls.test.ts \
  tests/integration/aislamiento-api.integration.test.ts
# → "N passed", "0 skipped"

# 10. Guardrails de C1 siguen verdes
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each de G3 ahora corre con 5 casos (las 2 de C1 + signo_movimiento,
#   movimientos_stock_inmutable, existencias_lote_aplicar_movimiento)

# 11. Suites completas
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
`````

**C2·T2** — Cuando C2·T1 está en verde. · **Gemini Flash** · Entrega: `recalcular_existencias` y `verificar_existencias`, con el test que justifica la caché (RN-MV11).

`````markdown
# ETAPA C2 · TANDA 2/5 — Conciliación de la caché de existencias
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T1 en verde, con `stock.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Esta tanda entrega el test que justifica una decisión de diseño.** D-02 dice que
> `existencias_lote` no es "la columna `stock_actual` prohibida" porque es reconstruible y
> auditable, y que **una columna `stock_actual` no puede tener este test porque no hay contra
> qué verificarla**. Si esta tanda no cierra, esa decisión no está sostenida por nada.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-02 | Los tres argumentos por los que la caché no es `stock_actual`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.4 (`existencias_lote`) y §6.3 | RN-MV10, MV11, MV12. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Tu propia migración de C2·T1: el trigger `existencias_lote_aplicar_movimiento` que estas funciones tienen que reproducir exactamente. |
| `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql` | El patrón de función `SECURITY DEFINER` con `REVOKE`/`GRANT` y `NOTIFY pgrst` al final. |
| `tests/integration/stock.integration.test.ts` | Tu propio arnés de C2·T1 y el helper de siembra. |
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

1. `supabase/migrations/20260908000002_comercial_conciliacion_existencias.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/stock.integration.test.ts` | Los casos de RN-MV11 y RN-MV12. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-MV11 y RN-MV12. |

**RN-MV10 no se cierra acá**: es un guardrail estático y va en C2·T5, junto con RN-MV1.

## 2. Especificación exacta

### 2.1. `recalcular_existencias(p_tenant_id, p_producto_id DEFAULT NULL)`

Reconstruye la caché desde el libro mayor. Es la función que hace que `existencias_lote` sea
un índice materializado y no un dato con vida propia.

```sql
CREATE OR REPLACE FUNCTION public.recalcular_existencias(
  p_tenant_id   UUID,
  p_producto_id UUID DEFAULT NULL
)
RETURNS INTEGER            -- cantidad de filas de existencias_lote reescritas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filas INTEGER;
BEGIN
  -- Se reconstruye TODA fila de existencias_lote del alcance, incluidas las que
  -- quedarían en cero: una fila que la caché tiene y el libro mayor no respalda
  -- es exactamente el desvío que hay que corregir.
  WITH saldos AS (
    SELECT m.lote_id,
           m.tenant_id,
           m.producto_id,
           sum(m.cantidad_con_signo) AS cantidad
    FROM movimientos_stock m
    WHERE m.tenant_id = p_tenant_id
      AND (p_producto_id IS NULL OR m.producto_id = p_producto_id)
    GROUP BY m.lote_id, m.tenant_id, m.producto_id
  ),
  escritos AS (
    INSERT INTO existencias_lote (lote_id, tenant_id, producto_id, cantidad, actualizado_at)
    SELECT s.lote_id, s.tenant_id, s.producto_id, s.cantidad, now()
    FROM saldos s
    ON CONFLICT (lote_id) DO UPDATE
      SET cantidad       = EXCLUDED.cantidad,
          producto_id    = EXCLUDED.producto_id,
          actualizado_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_filas FROM escritos;

  -- Lotes del alcance que quedaron SIN ningún movimiento: su saldo es cero.
  -- Sin esta parte, un lote cuyos movimientos se hubieran ido con un rollback
  -- conservaría para siempre el saldo viejo.
  UPDATE existencias_lote e
  SET cantidad = 0, actualizado_at = now()
  WHERE e.tenant_id = p_tenant_id
    AND (p_producto_id IS NULL OR e.producto_id = p_producto_id)
    AND NOT EXISTS (
      SELECT 1 FROM movimientos_stock m
      WHERE m.tenant_id = e.tenant_id AND m.lote_id = e.lote_id
    );

  RETURN v_filas;
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_existencias(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalcular_existencias(UUID, UUID) TO service_role;
```

**Cada lectura y cada escritura filtra por `p_tenant_id`.** Es `SECURITY DEFINER`: no hay RLS
que salve un filtro olvidado, y un recálculo sin filtro reescribiría la caché de todas las
clínicas.

### 2.2. `verificar_existencias(p_tenant_id)`

Devuelve los lotes donde la caché difiere de la suma del libro mayor. **En condiciones normales
devuelve cero filas.**

```sql
CREATE OR REPLACE FUNCTION public.verificar_existencias(p_tenant_id UUID)
RETURNS TABLE (
  lote_id          UUID,
  producto_id      UUID,
  cantidad_cache   NUMERIC(14,3),
  cantidad_real    NUMERIC(14,3),
  diferencia       NUMERIC(14,3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.lote_id,
         e.producto_id,
         e.cantidad                                  AS cantidad_cache,
         COALESCE(m.suma, 0)                         AS cantidad_real,
         e.cantidad - COALESCE(m.suma, 0)            AS diferencia
  FROM existencias_lote e
  LEFT JOIN (
    SELECT ms.lote_id, sum(ms.cantidad_con_signo) AS suma
    FROM movimientos_stock ms
    WHERE ms.tenant_id = p_tenant_id
    GROUP BY ms.lote_id
  ) m ON m.lote_id = e.lote_id
  WHERE e.tenant_id = p_tenant_id
    AND e.cantidad <> COALESCE(m.suma, 0);
$$;

REVOKE ALL ON FUNCTION public.verificar_existencias(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_existencias(UUID) TO service_role;
```

El `LEFT JOIN` y el `COALESCE(m.suma, 0)` importan: un lote con fila en la caché y **cero**
movimientos es un desvío, y con `INNER JOIN` no aparecería.

**Cierre del archivo:** `NOTIFY pgrst, 'reload schema';`. Las dos funciones se invocan por
`.rpc()` desde los tests y desde el Service de C2·T4: sin el `NOTIFY`, PostgREST sirve la firma
vieja desde caché y el síntoma engaña ("no se encontró la función" aunque la migración se
aplicó).

### 2.3. Tests

Agregá a `tests/integration/stock.integration.test.ts`:

| `it()` | Caso |
|---|---|
| `RN-MV11: el desvío de la caché se detecta y se corrige` | (1) Sembrar un lote con tres movimientos; `verificar_existencias(tenantA)` → **cero filas**. (2) **Adulterar la caché a mano** con `serviceDb.from("existencias_lote").update({ cantidad: 999 }).eq("lote_id", loteId)`. (3) `verificar_existencias(tenantA)` → **una fila**, con ese `lote_id`, `cantidad_cache: 999` y la `diferencia` correcta. (4) `recalcular_existencias(tenantA)`. (5) `verificar_existencias(tenantA)` → **cero filas** otra vez, y `existencias_lote.cantidad` volvió al valor del libro mayor. |
| `RN-MV11: verificar_existencias no cruza tenants` | Adulterar la caché de un lote de **B** y llamar `verificar_existencias(tenantA)` → cero filas. Es lo que prueba que el `p_tenant_id` filtra de verdad. |
| `RN-MV12: la caché es reconstruible` | Sembrar **200 movimientos variados** sobre al menos 5 lotes de 2 productos, mezclando entradas y salidas (sin dejar ningún lote en negativo). Guardar el estado completo de `existencias_lote`. Llamar `recalcular_existencias(tenantA)`. Comparar **fila por fila**: sin diferencias. |
| `RN-MV12: recalcular por producto no toca los demás` | `recalcular_existencias(tenantA, productoX)` después de adulterar un lote de `productoX` **y** uno de `productoY` → el de X quedó corregido y el de Y **sigue adulterado**. Verifica que el parámetro opcional acota de verdad. |

**El paso 2 de RN-MV11 —adulterar la caché a mano— es lo que hace que este test valga.** Un
test que solo verifica "el trigger mantiene la caché bien" ya está en C2·T1. Este prueba que el
sistema **se da cuenta** cuando la caché se desvía, que es lo que ninguna columna `stock_actual`
puede probar.

Para los 200 movimientos de RN-MV12, generalos en un bucle con `serviceDb`, no a mano. Cuidá
que ninguna salida deje el lote en negativo: el `CHECK` de `existencias_lote` haría fallar el
`INSERT` y el test se caería por la razón equivocada.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-MV11 | `verificar_existencias` da cero filas en condiciones normales y reporta el lote cuando la caché fue adulterada. | `it('RN-MV11: el desvío de la caché se detecta y se corrige', …)` |
| RN-MV12 | `recalcular_existencias` produce exactamente los valores que mantuvo el trigger. | `it('RN-MV12: la caché es reconstruible', …)` |

## 4. Orden de trabajo

1. **Escribí los tests primero y corrélos.** Tienen que fallar con "no se encontró la función
   `verificar_existencias` en el schema cache". Ese mensaje exacto es la señal de que el test
   llegó a la base y la función no está — no de que el test esté roto.
2. Escribí la migración (con su marca `-- @modulo: comercial` y su `NOTIFY pgrst`) y aplicala.
3. Corré los tests: en verde.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Las dos funciones existen con la firma correcta
psql "$DATABASE_URL" -c "SELECT proname, pg_get_function_identity_arguments(oid)
  FROM pg_proc WHERE proname IN ('recalcular_existencias','verificar_existencias');"
# → recalcular_existencias(uuid, uuid) y verificar_existencias(uuid)

# 2. Ninguna es ejecutable por anon ni authenticated (G3 lo cubre solo, pero verificá)
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each ahora corre con 7 casos

# 3. En una base sana, verificar_existencias no reporta nada
psql "$DATABASE_URL" -c "SELECT count(*) FROM verificar_existencias('<un tenant real>');"
# → 0

# 4. Los tests pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts tests/integration/stock.integration.test.ts
# → "N passed", "0 skipped"

# 5. Suites completas
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
`````

**C2·T3** — Cuando C2·T2 está en verde. · **Gemini Flash** · Entrega: `compras`, `configuracion_tenant` y el RPC `confirmar_compra`. Primera escritura transaccional del módulo.

`````markdown
# ETAPA C2 · TANDA 3/5 — Compras, configuración y RPC `confirmar_compra`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T2 en verde, con `stock.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Primera escritura transaccional del módulo.** A partir de acá vale la regla que no se
> negocia: **el Service arma la intención y llama al RPC. El Service NO lee existencias para
> decidir.** Si en una revisión aparece un `SELECT` de existencia seguido de una escritura
> desde TypeScript, es un defecto aunque pase las pruebas.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.5, §4.6, §4.11 | Productos sin control de lote, `compras`, `compras_items`, las seis columnas de `configuracion_tenant`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04 | Costo por lote, costo efectivo vs. costo de reposición, y la composición del costo según condición fiscal. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.4 y §6.5 | RN-LO1, LO2, LO3 y RN-CM1…CM5. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.8 | Decisión P-05: **monotributista** → `iva_compras_es_costo` default `true`. |
| `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql` | **El patrón exacto del RPC a copiar.** Mirá: la resolución de `full_name` / `display_name` del usuario, el `INSERT INTO registros_auditoria` dentro de la transacción, el `REVOKE`/`GRANT`, el `NOTIFY pgrst`. |
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | **El patrón de llamada al RPC desde el Service**: `.rpc(nombre, { p_tenant_id: ctx.tenantId, … }).single()` y `mapEstadiaRpcError` para traducir el `RAISE EXCEPTION` a `DomainError`. |
| `supabase/migrations/20260614000002_tables.sql` líneas 30-38 | `configuracion_tenant` tal como está hoy. |
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

1. `supabase/migrations/20260908000003_comercial_compras.sql`
2. `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/compras.integration.test.ts` | **Crealo**: RN-CM1, CM4, CM5, RN-LO1, LO2, LO3, RN-MV7, RN-PRV3. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Las filas de esas ocho RN. |

**Dos migraciones separadas, no una.** La primera crea tablas y columnas; la segunda crea el
RPC. Son dos modos de error distintos y conviene poder revisar el diff del DDL solo.

## 2. Especificación exacta

### 2.1. `20260908000003_comercial_compras.sql`

**Las seis columnas de `configuracion_tenant`.** Columnas tipadas, no `parametros_extra`: todas
se leen en caminos de validación donde un `->>` sin tipo es una fuente de bugs silenciosos.

```sql
ALTER TABLE configuracion_tenant
  -- Decisión P-05: la clínica es MONOTRIBUTISTA. El IVA de compra no se recupera
  -- y es parte del costo real, así que costo_unitario_efectivo = neto + IVA.
  -- Si esto se pusiera en false por error, el inventario quedaría subvaluado un
  -- 21 % y TODOS los márgenes saldrían inflados.
  ADD COLUMN iva_compras_es_costo               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dias_alerta_vencimiento            INTEGER NOT NULL DEFAULT 60
    CHECK (dias_alerta_vencimiento BETWEEN 1 AND 365),
  ADD COLUMN tolerancia_rendimiento_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN tolerancia_diferencia_arqueo       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN permitir_venta_sin_existencia      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN exigir_receta_bloqueante           BOOLEAN NOT NULL DEFAULT false;
```

Todas con `NOT NULL DEFAULT`, todas aditivas. `on_tenant_created()` **no necesita cambios**: su
`INSERT` existente toma los defaults.

**`compras`:**

```
id, tenant_id,
proveedor_id                    UUID NOT NULL,  -- FK compuesta → proveedores, ON DELETE RESTRICT
fecha                           DATE NOT NULL,
comprobante_proveedor_tipo      TEXT NULL,
comprobante_proveedor_numero    TEXT NULL,
total_neto, total_iva, total    NUMERIC(14,2) NOT NULL DEFAULT 0,
estado                          estado_compra NOT NULL DEFAULT 'borrador',
genera_egreso_caja              BOOLEAN NOT NULL DEFAULT false,
sesion_caja_id                  UUID NULL,   -- sin FK: sesiones_caja llega en C3·T1
observaciones                   TEXT NULL,
usuario_id                      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
created_at, updated_at
```

- `ALTER TABLE compras ADD CONSTRAINT compras_id_tenant_key UNIQUE (id, tenant_id);`
- **RN-CM4** — evita cargar dos veces la misma factura, que es el error de carga más común:
  ```sql
  CREATE UNIQUE INDEX uq_compras_comprobante
    ON compras (tenant_id, proveedor_id, comprobante_proveedor_numero)
    WHERE comprobante_proveedor_numero IS NOT NULL;
  ```
- `CREATE INDEX idx_compras_tenant_estado ON compras (tenant_id, estado, fecha DESC);`
- **El `ON DELETE RESTRICT` de `proveedor_id` es RN-PRV3.** Es la protección dura que C1·T5
  dejó pendiente: recién ahora existe la tabla contra la que probarla.

**`compras_items`:**

```
id, tenant_id,
compra_id             UUID NOT NULL,  -- FK compuesta → compras, ON DELETE CASCADE
producto_id           UUID NOT NULL,  -- FK compuesta → productos, ON DELETE RESTRICT
cantidad              NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
costo_unitario_neto   NUMERIC(14,4) NOT NULL CHECK (costo_unitario_neto >= 0),
alicuota_iva          NUMERIC(5,2) NOT NULL,
codigo_lote           TEXT NULL,
fecha_vencimiento     DATE NULL,
importe_neto, importe_iva, importe_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
created_at
```

- `ALTER TABLE compras_items ADD CONSTRAINT compras_items_id_tenant_key UNIQUE (id, tenant_id);`
- **`ON DELETE CASCADE` en `compra_id` es el ÚNICO CASCADE del módulo**, y es deliberado: un
  ítem de un borrador no tiene vida propia. Todo lo demás es `RESTRICT`.

**Las dos FKs diferidas de C2·T1.** `lotes.compra_item_id` y `movimientos_stock.compra_item_id`
se declararon sin FK porque la tabla no existía. Ahora sí:

```sql
ALTER TABLE lotes
  ADD CONSTRAINT lotes_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_compra_item_tenant_fkey
  FOREIGN KEY (compra_item_id, tenant_id) REFERENCES compras_items (id, tenant_id)
  ON DELETE RESTRICT;
```

**RLS** de las dos tablas: `FOR SELECT` con `tiene_permiso('manage_suppliers')` —§4.13 asigna
ese permiso a "proveedores y compras"—. Sin `FORCE`, sin políticas de escritura, sin `GRANT`.

### 2.2. `20260908000004_comercial_confirmar_compra_rpc.sql`

**El borrador no mueve existencias (RN-CM1).** Lotes y movimientos se crean **al confirmar**,
en este RPC, en una sola transacción.

```
confirmar_compra(p_tenant_id UUID, p_usuario_id UUID, p_compra_id UUID)
RETURNS TABLE (compra_id UUID, operacion_id UUID, lotes_creados INTEGER, total NUMERIC)
```

Cuerpo, en este orden:

```
BEGIN
  v_operacion := gen_random_uuid();

  -- 1. La compra existe, es de este tenant y está en borrador
  SELECT * INTO v_compra FROM compras
   WHERE id = p_compra_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'PURCHASE_NOT_FOUND';        END IF;
  IF v_compra.estado <> 'borrador' THEN RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED'; END IF;

  -- 2. RN-PRV2: el proveedor está activo
  SELECT activo INTO v_prov_activo FROM proveedores
   WHERE id = v_compra.proveedor_id AND tenant_id = p_tenant_id;
  IF NOT FOUND        THEN RAISE EXCEPTION 'SUPPLIER_NOT_FOUND'; END IF;
  IF NOT v_prov_activo THEN RAISE EXCEPTION 'SUPPLIER_INACTIVE'; END IF;

  -- 3. Al menos un ítem
  IF NOT EXISTS (SELECT 1 FROM compras_items
                  WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id)
     THEN RAISE EXCEPTION 'PURCHASE_WITHOUT_ITEMS'; END IF;

  -- 4. Composición del costo: se lee UNA vez, fuera del bucle
  SELECT iva_compras_es_costo INTO v_iva_es_costo
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  -- 5. Un lote y un movimiento por ítem
  FOR v_item IN SELECT * FROM compras_items
                 WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id
                 ORDER BY id
  LOOP
      SELECT activo, controla_lote, controla_vencimiento, unidad_medida_id
        INTO v_prod
        FROM productos
       WHERE id = v_item.producto_id AND tenant_id = p_tenant_id;

      IF NOT FOUND       THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
      IF NOT v_prod.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;   -- RN-PR3

      -- RN-PR6: la cantidad respeta los decimales de la unidad del producto
      IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
         THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

      -- RN-LO2: si el producto controla vencimiento, el lote lo lleva
      IF v_prod.controla_vencimiento AND v_item.fecha_vencimiento IS NULL
         THEN RAISE EXCEPTION 'EXPIRY_REQUIRED'; END IF;

      -- D-04 + P-05. El costo efectivo se CONGELA acá y no se recalcula nunca.
      v_costo_efectivo := CASE
        WHEN v_iva_es_costo
        THEN round(v_item.costo_unitario_neto * (1 + v_item.alicuota_iva / 100), 4)
        ELSE v_item.costo_unitario_neto
      END;

      -- RN-LO1: dos ingresos del mismo codigo_lote a distinto costo generan DOS
      -- lotes. No se busca un lote existente para "sumarle": el lote es el
      -- portador del costo y su costo es inmutable.
      -- RN-LO3: con controla_lote = false, codigo_lote y fecha_vencimiento van
      -- NULL y se crea un lote genérico igual. NO se actualiza el costo de un
      -- lote genérico existente: cada compra a distinto costo crea uno nuevo.
      INSERT INTO lotes (
        tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
        costo_unitario_neto, costo_unitario_efectivo, origen,
        compra_item_id, proveedor_id, estado, usuario_id
      ) VALUES (
        p_tenant_id, v_item.producto_id,
        CASE WHEN v_prod.controla_lote THEN v_item.codigo_lote        ELSE NULL END,
        CASE WHEN v_prod.controla_lote THEN v_item.fecha_vencimiento  ELSE NULL END,
        v_compra.fecha,
        v_item.costo_unitario_neto, v_costo_efectivo, 'compra',
        v_item.id, v_compra.proveedor_id, 'disponible', p_usuario_id
      )
      RETURNING id INTO v_lote_id;

      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
        costo_unitario, costo_total, compra_item_id, usuario_id
      ) VALUES (
        p_tenant_id, v_operacion, 'entrada_compra', v_item.producto_id, v_lote_id,
        v_item.cantidad, v_costo_efectivo,
        round(v_item.cantidad * v_costo_efectivo, 2),
        v_item.id, p_usuario_id
      );

      -- RN-CM5: la compra actualiza el costo de REPOSICIÓN del producto. NO toca
      -- los movimientos anteriores: ese es el punto de D-04 y de RN-MV6.
      UPDATE productos
         SET costo_reposicion = v_costo_efectivo, updated_at = now()
       WHERE id = v_item.producto_id AND tenant_id = p_tenant_id;

      v_lotes := v_lotes + 1;
  END LOOP;

  -- 6. Totales y estado
  SELECT sum(importe_neto), sum(importe_iva), sum(importe_total)
    INTO v_neto, v_iva, v_total
    FROM compras_items WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id;

  UPDATE compras
     SET estado = 'confirmada', total_neto = v_neto, total_iva = v_iva,
         total = v_total, updated_at = now()
   WHERE id = p_compra_id AND tenant_id = p_tenant_id;

  -- 7. Auditoría en la MISMA transacción (patrón registrar_eutanasia)
  SELECT u.full_name, COALESCE(r.display_name, r.name)
    INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'UPDATE', 'purchases', p_compra_id::text,
    jsonb_build_object('estado','confirmada','operacion_id',v_operacion,
                       'lotes_creados',v_lotes,'total',v_total)
  );

  RETURN QUERY SELECT p_compra_id, v_operacion, v_lotes, v_total;
END;
```

**`genera_egreso_caja` NO se implementa en esta tanda.** `sesiones_caja` llega en C3. Si la
compra tiene `genera_egreso_caja = true`, el RPC la confirma igual y **no** genera movimiento
de caja. Dejá este comentario en el cuerpo:

```sql
-- TODO C3: si v_compra.genera_egreso_caja, insertar el egreso en movimientos_caja.
-- La tabla llega en C3·T1; hasta entonces la compra se confirma sin tocar caja.
```

**Cada lectura y cada escritura filtra por `p_tenant_id`.** Es `SECURITY DEFINER`: no hay RLS.
Contá los `WHERE` del cuerpo y verificá que **todos** lo llevan.

Cierre: `REVOKE ALL … FROM PUBLIC;`, `GRANT EXECUTE … TO service_role;`,
`NOTIFY pgrst, 'reload schema';`.

### 2.3. `tests/integration/compras.integration.test.ts`

Reusá el helper de siembra de `stock.integration.test.ts`.

| `it()` | Caso |
|---|---|
| `RN-CM1: el borrador no mueve existencias` | Crear compra en borrador con 2 ítems → `existencias_lote` no cambió y `lotes` no tiene filas nuevas. Confirmar → sí. |
| `RN-CM4: el comprobante del proveedor no se carga dos veces` | Dos compras del mismo proveedor con `comprobante_proveedor_numero = 'A-0001-00001234'` → la segunda falla (`23505`). Dos con número `NULL` → funcionan. |
| `RN-CM5: la compra actualiza el costo de reposición sin tocar los movimientos` | Compra 1 a costo 100 → confirmar. Compra 2 del mismo producto a 130 → confirmar. `productos.costo_reposicion` = el de la 2.ª; el `movimientos_stock.costo_unitario` de la 1.ª **sigue en el valor viejo**. |
| `RN-LO1: dos ingresos del mismo código de lote a distinto costo generan dos lotes` | Dos compras con `codigo_lote = 'L-993'` a $100 y $130 → **dos filas** en `lotes`, con sus costos respectivos. |
| `RN-LO2: sin fecha de vencimiento no se confirma` | Producto con `controla_vencimiento = true` y un ítem sin `fecha_vencimiento` → `confirmar_compra` falla con `EXPIRY_REQUIRED`. |
| `RN-LO3: el producto sin control de lote genera un lote genérico` | Producto con `controla_lote = false`: confirmar sin `codigo_lote` funciona, el lote creado tiene `codigo_lote` y `fecha_vencimiento` en `NULL`, y el movimiento tiene `lote_id` **no nulo**. |
| `RN-MV7: la operación es atómica` | Compra de 3 ítems donde el **tercero** es de un producto inactivo → `confirmar_compra` falla con `PRODUCT_INACTIVE`, y **no quedó ningún lote ni ningún movimiento** de los dos primeros. Verificá contando filas antes y después. |
| `RN-MV7: los movimientos de una compra comparten operacion_id` | Compra de 3 ítems confirmada → los 3 movimientos tienen el **mismo** `operacion_id`. |
| `RN-PRV2: un proveedor inactivo no recibe compras` | Desactivar el proveedor y confirmar → `SUPPLIER_INACTIVE`. |
| `RN-PRV3: un proveedor con compras no se borra` | `serviceDb.from("proveedores").delete().eq("id", provId)` con una compra confirmada → falla **por FK** (`23503`), no por validación de aplicación. |
| `RN-SC3: confirmar_compra no la ejecuta anon` | Lo cubre G3 solo. **No escribas este caso a mano**: verificá que el `it.each` de `grants.integration.test.ts` lo incluyó. |

**RN-MV7 es el caso más importante de la tanda.** Un RPC que valida los ítems uno por uno
dentro del bucle deja los dos primeros lotes creados si el tercero falla, salvo que todo corra
en una transacción. En PL/pgSQL corre en una sola por defecto — el test es lo que lo confirma,
y lo que detecta si alguien mete un `COMMIT` o un bloque `EXCEPTION` que se coma el error.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CM1 | Lotes y movimientos se crean al confirmar, no en el borrador. | `it('RN-CM1: el borrador no mueve existencias', …)` |
| RN-CM4 | No se carga dos veces la misma factura del mismo proveedor. → `409 SUPPLIER_INVOICE_DUPLICATE` | `it('RN-CM4: el comprobante del proveedor no se carga dos veces', …)` |
| RN-CM5 | Confirmar actualiza `costo_reposicion` sin tocar los movimientos anteriores. | `it('RN-CM5: la compra actualiza el costo de reposición sin tocar los movimientos', …)` |
| RN-LO1 | Dos ingresos del mismo `codigo_lote` a distinto costo generan dos lotes. | `it('RN-LO1: dos ingresos del mismo código de lote a distinto costo generan dos lotes', …)` |
| RN-LO2 | Si el producto controla vencimiento, ningún lote suyo lo tiene nulo. → `422 EXPIRY_REQUIRED` | `it('RN-LO2: sin fecha de vencimiento no se confirma', …)` |
| RN-LO3 | Con `controla_lote = false` cada compra crea un lote genérico y hay un solo camino de descuento. | `it('RN-LO3: el producto sin control de lote genera un lote genérico', …)` |
| RN-MV7 | Los movimientos de una operación comparten `operacion_id` y transacción; si uno falla, no queda ninguno. | `it('RN-MV7: la operación es atómica', …)` |
| RN-PRV2 | Un proveedor inactivo no recibe compras. → `422 SUPPLIER_INACTIVE` | `it('RN-PRV2: un proveedor inactivo no recibe compras', …)` — cierra lo que C1·T5 dejó parcial |
| RN-PRV3 | Un proveedor con compras no se borra. → `409 SUPPLIER_IN_USE` | `it('RN-PRV3: un proveedor con compras no se borra', …)` — **cierra la fila que C1·T5 dejó PENDIENTE** |

## 4. Orden de trabajo

1. Escribí `20260908000003_comercial_compras.sql` (con marca) y aplicala.
2. **Escribí `compras.integration.test.ts` y corrélo.** Los casos de DDL (RN-CM4, RN-PRV3)
   tienen que pasar ya; los de RPC tienen que fallar con "no se encontró la función
   `confirmar_compra`".
3. Escribí `20260908000004_comercial_confirmar_compra_rpc.sql` (con marca y `NOTIFY`) y
   aplicala.
4. Corré los tests: todos en verde.
5. **Verificá RN-MV7 por mutación:** envolvé el bucle del RPC en un bloque
   `BEGIN … EXCEPTION WHEN OTHERS THEN NULL; END`, corré el test de atomicidad, confirmá que se
   pone **rojo** porque quedaron lotes huérfanos, y sacalo. Reportá que lo hiciste.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Agregá las filas a `MATRIZ_RN_TESTS_COMERCIAL.md`, **incluida RN-PRV3, que pasa de
   `PENDIENTE` a ✅**.

## 5. Definición de hecho

```bash
# 1. Las seis columnas de configuracion_tenant, con sus defaults
psql "$DATABASE_URL" -c "SELECT column_name, column_default, is_nullable
  FROM information_schema.columns WHERE table_name='configuracion_tenant'
  AND column_name IN ('iva_compras_es_costo','dias_alerta_vencimiento',
  'tolerancia_rendimiento_porcentaje','tolerancia_diferencia_arqueo',
  'permitir_venta_sin_existencia','exigir_receta_bloqueante');"
# → las seis, is_nullable = NO. iva_compras_es_costo default = true (decisión P-05)

# 2. El ÚNICO CASCADE del módulo es compras_items.compra_id
psql "$DATABASE_URL" -c "SELECT conname, confdeltype FROM pg_constraint
  WHERE contype='f' AND conrelid::regclass::text IN
  ('lotes','movimientos_stock','existencias_lote','compras','compras_items',
   'productos','proveedores','producto_conversiones','familias_producto');"
# → confdeltype = 'c' (cascade) SOLO en la FK de compras_items→compras y en las
#   de tenant_id→tenants. Todo lo demás 'r' (restrict) o 'n' (set null).

# 3. El RPC existe con la firma correcta y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, pg_get_function_identity_arguments(oid),
  has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE proname='confirmar_compra';"
# → confirmar_compra(uuid, uuid, uuid), anon = f

# 4. TODA consulta del RPC filtra por p_tenant_id
grep -c "p_tenant_id" supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
grep -c "WHERE" supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
# → el primer número tiene que ser >= al segundo. Si hay un WHERE de más,
#   encontralo y verificá que sea sobre una tabla sin tenant_id.

# 5. Las dos migraciones llevan su marca y la del RPC su NOTIFY
head -1 supabase/migrations/20260908000003_comercial_compras.sql
head -1 supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
tail -3 supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql
# → "-- @modulo: comercial" en las dos; "NOTIFY pgrst, 'reload schema';" al final del RPC

# 6. Los tests pasan Y NO se saltearon
npx vitest run --config vitest.integration.config.ts tests/integration/compras.integration.test.ts
# → "N passed", "0 skipped"

# 7. G3 descubrió el RPC nuevo sin que nadie tocara el guardrail
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con 8 casos e incluye confirmar_compra

# 8. Suites completas
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
`````

**C2·T4** — Cuando C2·T3 está en verde. · **Gemini Flash** · Entrega: Services y Controllers de stock y compras, kárdex, valorización y `anular_compra`.

`````markdown
# ETAPA C2 · TANDA 4/5 — Services y Controllers de stock y compras
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2·T3 en verde, con `compras.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04, D-05 | Costo efectivo vs. reposición; FEFO con override motivado. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.3, §6.4, §6.5 | RN-MV6, MV9, RN-LO4, LO5, LO7, RN-CM2, CM3. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | Tu propio Service de C1·T4: el guard `assertProductoOperable` que se reusa acá. |
| `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` | El patrón de `.rpc()` + `mapEstadiaRpcError` para traducir el `RAISE EXCEPTION` a `DomainError`. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | `buscarPaginado` con `count: "exact"` y `range()`. |
| `CLAUDE.md` sección "Acceso a datos y rendimiento — evitar consultas N+1" | El kárdex y el listado de lotes traen datos de producto: **una sola consulta con embed**, nunca un `await` por fila. |
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

1. `supabase/functions/api/src/modules/stock/stock.schemas.ts`
2. `supabase/functions/api/src/modules/stock/stock.service.ts`
3. `supabase/functions/api/src/modules/stock/stock.controller.ts`
4. `supabase/functions/api/src/modules/compras/compras.schemas.ts`
5. `supabase/functions/api/src/modules/compras/compras.service.ts`
6. `supabase/functions/api/src/modules/compras/compras.controller.ts`
7. `tests/unit/stock.service.test.ts`
8. `tests/unit/compras.service.test.ts`
9. `tests/unit/compras.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/lotes", …)`, `app.route("/movimientos-stock", …)`, `app.route("/existencias", …)`, `app.route("/compras", …)`. |
| `tests/integration/compras.integration.test.ts` | RN-CM3 (anulación) y RN-MV9. |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"stock"` y `"compras"` a `MODULOS_COMERCIALES` (el assert de cobertura de G1). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-MV6, MV9, RN-LO4, LO5, LO7, RN-CM2, CM3. |

**No olvides el paso de `MODULOS_COMERCIALES`.** Si no agregás los dos módulos nuevos a esa
lista, el guardrail G1 los escanea igual (deriva los archivos del directorio), pero **el assert
de cobertura no los exige**: el día que el patrón de directorios cambie, los dos quedan sin red
y nadie se entera.

## 2. Especificación exacta

### 2.1. `stock.service.ts` — cinco RN, ninguna escribe existencia

**Regla que gobierna toda esta tanda:** el Service **lee** existencias para mostrar, y **nunca**
para decidir una escritura. Toda escritura de existencia va por RPC. Acá no hay ningún método
que inserte en `movimientos_stock`.

**`listarCandidatosFefo(productoId, cantidad, tenantId)` — RN-LO4, LO5, LO7.**

Devuelve los lotes elegibles ordenados por FEFO. Es la consulta que el frontend usa para
sugerir, y la misma que el RPC de venta va a replicar en C4. **Que existan las dos no es
duplicación**: la del Service alimenta la UI y la del RPC decide bajo bloqueo. Lo que no puede
pasar es que difieran en el criterio.

```ts
const { data, error } = await db
  .from("existencias_lote")
  .select(`
    lote_id, cantidad,
    lote:lotes!inner(id, codigo_lote, fecha_vencimiento, fecha_ingreso,
                     estado, costo_unitario_efectivo)
  `)
  .eq("tenant_id", tenantId)
  .eq("producto_id", productoId)
  .gt("cantidad", 0)
  .eq("lotes.estado", "disponible")                       // RN-LO7
  .or(`fecha_vencimiento.is.null,fecha_vencimiento.gte.${hoy}`, { foreignTable: "lotes" }) // RN-LO4
  .order("fecha_vencimiento", { foreignTable: "lotes", ascending: true, nullsFirst: false })
  .order("fecha_ingreso",     { foreignTable: "lotes", ascending: true })
  .order("id",                { foreignTable: "lotes", ascending: true });
```

- **RN-LO5, orden exacto:** `fecha_vencimiento` ascendente **con nulos al final**, luego
  `fecha_ingreso`, luego `id`. El tercer criterio no es opcional: sin él, dos lotes de igual
  vencimiento e igual ingreso salen en orden distinto entre ejecuciones y la sugerencia deja
  de ser reproducible.
- **RN-LO4, no es overrideable por ningún rol, incluido `admin`.** Un lote vencido no entra en
  esta lista y no hay parámetro que lo haga entrar. La única salida posible de un lote vencido
  es `merma_vencimiento`, que llega en C5.
- **RN-LO7:** un lote `bloqueado` no aparece entre los candidatos.
- **Un solo `select` con embed.** Nada de traer los lotes y después iterar pidiendo el producto:
  eso es el patrón N+1 que `CLAUDE.md` prohíbe explícitamente.

**Ojo con el embed y las FKs compuestas.** `existencias_lote.lote_id` referencia
`lotes (id, tenant_id)`: si PostgREST no resuelve la pista `lotes!inner`, embebé **por nombre de
constraint** (`existencias_lote_lote_tenant_fkey`), igual que el repo ya hace con
`usuarios_rol_tenant_fkey`. Es un costo conocido del patrón, no un bug.

**`kardexPorLote(loteId, tenantId, opts)` — RN-MV6.**

Listado paginado de `movimientos_stock` de un lote, orden `created_at` ascendente, con el saldo
acumulado. **Devuelve `costo_unitario` tal como está guardado.** No lo recalcula, no lo joinea
contra `productos.costo_reposicion`, no lo "actualiza" con nada:

```ts
// RN-MV6: el costo del movimiento es el costo EFECTIVO congelado cuando ocurrió.
// Un join a productos.costo_reposicion acá sería más corto de escribir y estaría
// mal: revaluaría hacia atrás mercadería comprada más barata e inventaría una
// ganancia que no ocurrió. El costo de reposición sirve para FIJAR PRECIOS, no
// para valuar movimientos.
```

**`valorizacionInventario(tenantId, opts)`.** Suma `existencias_lote.cantidad *
lotes.costo_unitario_efectivo` agrupado por producto. Un solo `select` con embed.

**`existenciaPorProducto(tenantId, opts)`.** Listado paginado desde `existencias_lote`
agrupado por producto, con el nombre del producto embebido.

### 2.2. `compras.service.ts` — RN-CM2 y RN-CM3

CRUD del borrador (`crear`, `agregarItem`, `quitarItem`, `actualizarItem`, `obtenerPorId`,
`buscarPaginado`) + `confirmar` (llama al RPC) + `anular`.

**RN-CM2 — una compra confirmada no se edita.** Todo método que modifique la compra o sus ítems
empieza con el mismo guard:

```ts
/** RN-CM2: una compra confirmada no se edita. Se anula con contra-asientos. */
async function assertBorrador(compraId: string, tenantId: string) {
  const db = getServiceDb();
  const { data } = await db
    .from("compras")
    .select("id, estado")
    .eq("id", compraId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) throw new DomainError(ErrorCode.PURCHASE_NOT_FOUND, 404, "Compra no encontrada en este tenant");
  if ((data as { estado: string }).estado !== "borrador") {
    throw new DomainError(
      ErrorCode.PURCHASE_ALREADY_CONFIRMED, 409,
      "Una compra confirmada no se edita: se anula con contra-asientos",
    );
  }
}
```

**RN-CM3 — anulación solo sin salidas.** Va en un RPC nuevo, `anular_compra`, no en el Service:
mira existencias y escribe movimientos, así que por definición es transaccional.

Migración `20260908000005_comercial_anular_compra_rpc.sql`, con marca y `NOTIFY`:

```
anular_compra(p_tenant_id UUID, p_usuario_id UUID, p_compra_id UUID, p_motivo TEXT)
RETURNS TABLE (compra_id UUID, operacion_id UUID, movimientos_generados INTEGER)
```

```
BEGIN
  SELECT * INTO v_compra FROM compras
   WHERE id = p_compra_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                        THEN RAISE EXCEPTION 'PURCHASE_NOT_FOUND'; END IF;
  IF v_compra.estado <> 'confirmada'  THEN RAISE EXCEPTION 'PURCHASE_ALREADY_CONFIRMED'; END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- RN-CM3: si CUALQUIER lote de esta compra ya tuvo una salida, la corrección
  -- es un ajuste motivado, no una anulación. Anular con salidas dejaría el
  -- inventario en negativo o borraría una venta real.
  IF EXISTS (
    SELECT 1
    FROM lotes l
    JOIN movimientos_stock m ON m.lote_id = l.id AND m.tenant_id = p_tenant_id
    WHERE l.tenant_id = p_tenant_id
      AND l.compra_item_id IN (SELECT id FROM compras_items
                                WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id)
      AND signo_movimiento(m.tipo) = -1
  ) THEN RAISE EXCEPTION 'PURCHASE_HAS_EXITS'; END IF;

  -- RN-MV9: se COMPENSA con contra-asientos. No se borra ni el movimiento
  -- original ni el lote: quedan visibles en el kárdex, con el asiento nuevo al lado.
  v_operacion := gen_random_uuid();
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  SELECT p_tenant_id, v_operacion, 'salida_ajuste', m.producto_id, m.lote_id,
         m.cantidad, m.costo_unitario, m.costo_total, p_motivo, p_usuario_id
  FROM movimientos_stock m
  WHERE m.tenant_id = p_tenant_id AND m.tipo = 'entrada_compra'
    AND m.compra_item_id IN (SELECT id FROM compras_items
                              WHERE compra_id = p_compra_id AND tenant_id = p_tenant_id);
  GET DIAGNOSTICS v_movs = ROW_COUNT;

  UPDATE compras SET estado='anulada', observaciones = p_motivo, updated_at = now()
   WHERE id = p_compra_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (...) VALUES (..., 'UPDATE', 'purchases', ...);
  RETURN QUERY SELECT p_compra_id, v_operacion, v_movs;
END;
```

**El contra-asiento va SIN `compra_item_id`.** El CHECK de coherencia documental exige que
`entrada_compra` lo lleve, pero el contra-asiento es `salida_ajuste`, que no admite documento.
Si lo copiás del original, el `INSERT` falla contra el CHECK y el síntoma engaña.

### 2.3. Controllers y rutas

**`stock.controller.ts`** — tres routers: `lotesRouter`, `movimientosRouter`,
`existenciasRouter`. Middleware: `tenantContext, requireActiveTenant, requireModule("stock"),
requirePermission("view_stock")`. **Todo de lectura**: esta tanda no expone ninguna escritura de
existencia.

**`compras.controller.ts`** — `comprasRouter`. Middleware:
`tenantContext, requireActiveTenant, requireModule("stock"), requirePermission("manage_suppliers")`.

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/v1/lotes` | Filtros: `productoId`, `estado`, `venceAntesDe`, `conExistencia`. |
| GET | `/api/v1/lotes/:id/kardex` | Paginado, con saldo acumulado. |
| GET | `/api/v1/lotes/candidatos` | FEFO: `?productoId=…&cantidad=…` |
| GET | `/api/v1/movimientos-stock` | Filtros: `loteId`, `productoId`, `tipo`, `desde`, `hasta`, `operacionId`. |
| GET | `/api/v1/existencias` | Por producto, paginado. |
| GET | `/api/v1/existencias/valorizacion` | Suma `cantidad × costo_unitario_efectivo`. |
| GET/POST/PUT | `/api/v1/compras[/:id]` | Borrador. |
| POST | `/api/v1/compras/:id/items` · DELETE `/items/:itemId` | RN-CM2: rechaza si no es borrador. |
| POST | `/api/v1/compras/:id/confirmar` | Llama al RPC `confirmar_compra`. |
| POST | `/api/v1/compras/:id/anular` | Llama al RPC `anular_compra`. Body: `{ motivo }`. |

**No hay ninguna ruta de escritura sobre `movimientos_stock` ni `existencias_lote`.** Si te dan
ganas de agregar un `POST /movimientos-stock` "para cargar el stock inicial", **no lo hagas**:
eso va a ser `ajustar_existencia` en C5, con motivo obligatorio.

### 2.4. Tests

**`tests/unit/stock.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-LO5: FEFO ordena por vencimiento, ingreso e id` | Mock con lotes de `2026-03-01`, `2026-01-15` y `null` → el primero de la lista es el de enero y el `null` queda **último**. Dos lotes de igual vencimiento e igual ingreso → el orden es estable entre dos llamadas. |
| `RN-LO4: un lote vencido no es candidato, para ningún rol` | Mock con un lote vencido → no aparece. Repetí el caso con `callerRole: "admin"` y verificá que **tampoco** aparece: no hay override. |
| `RN-LO7: un lote bloqueado no es candidato` | Mock con `estado: "bloqueado"` → no aparece. |
| `RN-MV6: el kárdex devuelve el costo guardado` | Mock donde `movimientos_stock.costo_unitario` es 100 y `productos.costo_reposicion` es 130 → el kárdex devuelve **100**. |
| `RN-MV6: cambiar el costo de reposición no altera el kárdex` | Dos llamadas al kárdex con `costo_reposicion` distinto entre medio → el mismo resultado. |
| `no hay N+1 en el listado de candidatos` | El mock cuenta las llamadas a `.from()`: **una sola** para N lotes. |

**`tests/unit/compras.service.test.ts`:** RN-CM2 con las cuatro rutas de edición
(`agregarItem`, `quitarItem`, `actualizarItem`, `actualizar`) sobre una compra confirmada →
las cuatro lanzan `PURCHASE_ALREADY_CONFIRMED`. Probá **las cuatro**: un guard puesto en tres
de cuatro pasa un test que solo prueba una.

**En `tests/integration/compras.integration.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-CM3: anular sin salidas genera contra-asientos` | Confirmar una compra de 2 ítems, anularla con motivo → 2 movimientos `salida_ajuste` nuevos, la existencia volvió a cero, la compra quedó `anulada`, **y los `entrada_compra` originales siguen en la tabla**. |
| `RN-CM3: anular con salidas falla` | Confirmar, generar una salida del lote, anular → `PURCHASE_HAS_EXITS`. La compra sigue `confirmada`. |
| `RN-CM3: anular sin motivo falla` | Sin `motivo` y con `motivo: "error"` (5 caracteres) → `REASON_REQUIRED` en los dos casos. |
| `RN-MV9: nada se borra, se compensa` | Después de anular, contar `movimientos_stock` del lote → **4** (2 entradas + 2 contra-asientos), no 0. |

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-MV6 | El costo se guarda, no se recalcula: cambiar `costo_reposicion` no altera lo registrado. | `it('RN-MV6: el kárdex devuelve el costo guardado', …)` |
| RN-MV9 | Una operación registrada se revierte con contra-asientos visibles, no borrando. | `it('RN-MV9: nada se borra, se compensa', …)` |
| RN-LO4 | Prohibido despachar vencido. **No overrideable por ningún rol, incluido admin.** → `422 BATCH_EXPIRED` | `it('RN-LO4: un lote vencido no es candidato, para ningún rol', …)` |
| RN-LO5 | FEFO determinístico: vencimiento asc con nulos al final, luego ingreso, luego id. | `it('RN-LO5: FEFO ordena por vencimiento, ingreso e id', …)` |
| RN-LO7 | Un lote bloqueado no se despacha. → `422 BATCH_BLOCKED` | `it('RN-LO7: un lote bloqueado no es candidato', …)` |
| RN-CM2 | Una compra confirmada no se edita. → `409 PURCHASE_ALREADY_CONFIRMED` | `it('RN-CM2: una compra confirmada no se edita', …)` |
| RN-CM3 | Anulación solo si ningún lote tuvo salidas. → `409 PURCHASE_HAS_EXITS` | `it('RN-CM3: anular con salidas falla', …)` |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo por módulo inexistente.
2. `stock.schemas.ts` → `stock.service.ts` → `stock.controller.ts`.
3. `20260908000005_comercial_anular_compra_rpc.sql` (con marca y `NOTIFY`).
4. `compras.schemas.ts` → `compras.service.ts` → `compras.controller.ts`.
5. Rutas en `main.ts`.
6. Casos de integración de RN-CM3 y RN-MV9.
7. **Agregá `"stock"` y `"compras"` a `MODULOS_COMERCIALES` en el guardrail G1.**
8. `npm test && npm run typecheck && npm run test:integration`.
9. Filas en `MATRIZ_RN_TESTS_COMERCIAL.md`.

## 5. Definición de hecho

```bash
# 1. Ningún service del módulo escribe existencias_lote ni movimientos_stock
grep -rn 'from("existencias_lote")' supabase/functions/api/src/modules/ | grep -E '\.(update|insert|delete|upsert)\('
grep -rn 'from("movimientos_stock")' supabase/functions/api/src/modules/ | grep -E '\.(update|insert|delete|upsert)\('
# → SIN RESULTADOS en los dos. Toda escritura va por RPC.

# 2. No hay N+1: ningún await a la base dentro de un map/for sobre un listado
grep -n -A3 -E '\.(map|forEach)\(' supabase/functions/api/src/modules/stock/stock.service.ts | grep -n "await db"
# → sin resultados

# 3. G1 exige cobertura de los dos módulos nuevos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
# → passed, y el it.each de cobertura corre con 4 módulos
#   (productos, proveedores, stock, compras)

# 4. Los tests de la tanda
npx vitest run tests/unit/stock.service.test.ts tests/unit/compras.service.test.ts \
  tests/unit/compras.controller.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/compras.integration.test.ts
# → todos passed, 0 skipped

# 5. G3 descubrió anular_compra
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con 9 casos

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
`````

**C2·T5** — Cuando C2·T4 está en verde. · **Gemini Flash** · Entrega: notificación de vencimiento, el guardrail del libro mayor y el cierre de C2.

`````markdown
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
`````

**AUDITORÍA C1+C2** — Después de C2·T5, ANTES de empezar C3. · **Gemini Flash** · Checklist mecánica de 8 controles obligatorios + 6 específicos, y veredicto.

`````markdown
# AUDITORÍA — ETAPAS C1 y C2
> **Modelo:** Gemini Flash · **Rol:** auditoría y control
> **Cuándo:** después de C2·T5, antes de empezar C3.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **No implementás nada.** Corrés la checklist, anotás el resultado real de cada control y
> emitís un veredicto. Si algo falla, escribís el prompt de corrección para que lo haga una
> sesión de ejecución — no lo arreglás vos.
>
> **Esta es una checklist mecánica, no una revisión de criterio.** Cada control tiene su
> comando y su resultado esperado. Si el resultado no coincide, el control **falla**, aunque
> "se entienda por qué". Un control que se explica es un control que falló.

---

## 0. Preparación

```bash
# Todos los comandos corren desde la raíz del repo.
# `$DATABASE_URL` tiene que apuntar a la base donde se aplicaron las migraciones.
# Si te falta, frená: sin base no se puede auditar nada de la mitad de esta lista.

git log --oneline | head -30      # anotá el sha del último commit anterior a C1·T1
export SHA_INICIO=<ese sha>
git diff --stat $SHA_INICIO..HEAD
```

**Material a tener a mano:** `docs/ESPEC_MODULO_COMERCIAL.md` §4, §5, §6.1–6.5, §9;
`PLAN_ETAPAS_COMERCIAL.md` §0; `CLAUDE.md`; los reportes de las tandas C1·T1 a C2·T5.

---

## 1. Los ocho controles obligatorios

Anotá para cada uno: **comando corrido**, **resultado obtenido**, **PASA / FALLA**.

### Control 1 — RN cubiertas

```bash
# 1.1 Ninguna RN de C1 ni C2 quedó PENDIENTE
grep -E "^\| RN-(PR|PRV|MV|LO|CM)" MATRIZ_RN_TESTS_COMERCIAL.md | grep -c "PENDIENTE"
```
**Esperado: `0`.** Son 40 RN (12 PR + 3 PRV + 12 MV + 8 LO + 5 CM).

```bash
# 1.2 Toda RN marcada ✅ tiene un test que cita su código en el it()
for rn in PR1 PR2 PR3 PR4 PR5 PR6 PR7 PR8 PR9 PR10 PR11 PR12 \
          PRV1 PRV2 PRV3 \
          MV1 MV2 MV3 MV4 MV5 MV6 MV7 MV8 MV9 MV10 MV11 MV12 \
          LO1 LO2 LO3 LO4 LO5 LO6 LO7 LO8 \
          CM1 CM2 CM3 CM4 CM5; do
  n=$(grep -rho "RN-$rn[^0-9]" tests/ | wc -l)
  [ "$n" -eq 0 ] && echo "SIN TEST: RN-$rn"
done
```
**Esperado: sin salida.** Cada línea que aparezca es una RN marcada ✅ sin test que la cite.

> **RN-LO6 es la excepción esperada**: se cubre en C4·T2 y su fila debe decir `PENDIENTE`, no ✅.
> Si aparece en la salida y su fila dice `PENDIENTE`, está bien. Si dice ✅, **falla el control**.

### Control 2 — Filtro de tenant en cada consulta

Con `service_role` no hay RLS que salve el olvido: una consulta sin filtro devuelve datos de
todos los tenants y **no da error**.

```bash
# 2.1 El guardrail estático
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
```
**Esperado: passed, y el `it.each` de cobertura corre con 4 módulos** (`productos`,
`proveedores`, `stock`, `compras`).

```bash
# 2.2 Control cruzado a mano: contá .from() contra .eq("tenant_id"
for f in supabase/functions/api/src/modules/{productos,proveedores,stock,compras}/*.service.ts; do
  froms=$(grep -c '\.from("' "$f")
  eqs=$(grep -c 'eq("tenant_id"' "$f")
  echo "$f  from=$froms  tenant_eq=$eqs"
done
```
**Esperado: en cada archivo, `tenant_eq >= from` menos la cantidad de `.from()` sobre
catálogos globales** (`unidades_medida`, `medios_pago`, `permisos`). Si un archivo tiene menos
filtros que consultas, listá cuál `.from()` quedó sin filtro.

```bash
# 2.3 Los RPC: cada WHERE del cuerpo filtra por p_tenant_id
for m in supabase/migrations/2026090*_comercial_*.sql supabase/migrations/2026091*_comercial_*.sql; do
  echo "=== $m"
  echo "  p_tenant_id: $(grep -c 'p_tenant_id' "$m")   WHERE: $(grep -ci 'where' "$m")"
done
```
**Esperado: `p_tenant_id >= WHERE` en cada archivo que declare RPCs.** Las excepciones legítimas
son consultas a `unidades_medida`, `medios_pago` y `pg_*`. Listá cualquier otra.

### Control 3 — Aislamiento

```bash
# 3.1 RLS
npx vitest run --config vitest.integration.config.ts tests/integration/rls.test.ts
```
**Esperado: passed, `0 skipped`.** Un `skipped` significa que faltan las credenciales de
`TEST_SUPABASE_*` y que **este control no se verificó**: anotalo como FALLA, no como PASA.

```bash
# 3.2 FK compuesta cross-tenant
npx vitest run --config vitest.integration.config.ts tests/integration/aislamiento-api.integration.test.ts
grep -c "RN-SC2" tests/integration/aislamiento-api.integration.test.ts
```
**Esperado: passed con `0 skipped`, y al menos 5 casos `RN-SC2`** (catálogo ×3 de C1·T3,
libro mayor ×2 de C2·T1).

```bash
# 3.3 Las FKs compuestas existen de verdad
psql "$DATABASE_URL" -c "SELECT conrelid::regclass AS tabla, conname
  FROM pg_constraint WHERE contype='f' AND conname LIKE '%_tenant_fkey'
  ORDER BY 1, 2;"
```
**Esperado: al menos las de `productos`, `producto_conversiones` (×2), `proveedores`, `lotes`
(×3), `movimientos_stock` (×6), `existencias_lote`, `compras`, `compras_items` (×2).**

```bash
# 3.4 Los UNIQUE (id, tenant_id) del lado referenciado
psql "$DATABASE_URL" -c "SELECT conrelid::regclass FROM pg_constraint
  WHERE contype='u' AND conname LIKE '%_id_tenant_key' ORDER BY 1;"
```
**Esperado: `clientes`, `compras`, `compras_items`, `especies`, `familias_producto`,
`historial_clinico`, `lotes`, `mascotas`, `plan_vacunacion`, `producto_conversiones`,
`productos`, `proveedores`, `razas`, `roles`, `tipos_vacuna`.** Falta alguna → FALLA.

### Control 4 — Auditoría

El modo de falla es **silencioso**: si un valor está en el tipo `AuditModule` y no en el ENUM,
`recordAudit` loguea y sigue, los asientos se pierden y **ningún test se pone rojo**.

```bash
# 4.1 El guardrail G2, en sus DOS direcciones
npx vitest run tests/unit/audit-modulo-enum.test.ts
```
**Esperado: passed, incluyendo el `describe` de "todo valor de AuditModule existe en el enum"
y sus tres casos de mutación.** Si ese `describe` no existe, C1·T1 no se completó → **FALLA**.

```bash
# 4.2 Los seis valores están en el ENUM
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='modulo_auditoria' ORDER BY e.enumsortorder;"
```
**Esperado: incluye `products`, `suppliers`, `purchases`, `inventory`, `sales`,
`cash_register`.**

```bash
# 4.3 …y en el tipo TypeScript
grep -A4 "export type AuditModule" supabase/functions/api/src/shared/audit.ts
```
**Esperado: los seis literales presentes.**

```bash
# 4.4 Los RPC auditan DENTRO de la transacción
grep -l "registros_auditoria" supabase/migrations/*_comercial_*.sql
```
**Esperado: `confirmar_compra` y `anular_compra` lo tienen.** Un RPC transaccional que **no**
inserta su asiento adentro está mal: `recordAudit` desde el Service es best-effort y si la
operación hace rollback el asiento igual queda (o al revés).

```bash
# 4.5 No hay asientos huérfanos: si la operación falla, no queda asiento
grep -n "RN-SC5" tests/unit/*.service.test.ts
```
**Esperado: al menos un caso por módulo verificando que un `INSERT` fallido **no** llama a
`recordAudit`.**

### Control 5 — Permisos y licenciamiento

```bash
# 5.1 Los diez permisos existen
psql "$DATABASE_URL" -c "SELECT name, module FROM permisos WHERE name IN
  ('view_stock','manage_stock','split_stock','consume_stock','manage_products',
   'manage_suppliers','view_sales','manage_sales','void_sales','manage_cash') ORDER BY 1;"
```
**Esperado: 10 filas, con los `module` de §8.1.**

```bash
# 5.2 El plan correcto habilita cada módulo (decisión P-01b)
psql "$DATABASE_URL" -c "SELECT t.plan, m.modulo, m.habilitado, count(*)
  FROM tenants t JOIN modulos_contratados m ON m.tenant_id = t.id
  WHERE m.modulo IN ('stock','ventas') GROUP BY 1,2,3 ORDER BY 1,2;"
```
**Esperado:** `basico` → los dos en `false`. `profesional` → `stock` en `true`, `ventas` en
`false`. `premium` → los dos en `true`. **Cualquier otra combinación es FALLA**, incluido un
tenant sin fila.

```bash
# 5.3 Ningún tenant quedó sin sus filas
psql "$DATABASE_URL" -c "SELECT count(*) FROM tenants t WHERE NOT EXISTS
  (SELECT 1 FROM modulos_contratados m WHERE m.tenant_id=t.id AND m.modulo='stock');"
```
**Esperado: `0`.**

```bash
# 5.4 requireModule en todas las rutas del módulo
grep -L "requireModule" supabase/functions/api/src/modules/{productos,proveedores,stock,compras}/*.controller.ts
```
**Esperado: sin salida** (`grep -L` lista los que NO lo tienen).

```bash
# 5.5 La matriz rol × endpoint existe y prueba los 403
grep -c "403" tests/unit/{productos,proveedores,compras}.controller.test.ts
```
**Esperado: cada archivo con al menos 4 aserciones de 403.** Una matriz que solo verifica los
200 pasa igual si `requirePermission` no está puesto.

### Control 6 — Concurrencia

C2 no tiene RPC que compita por existencia —`confirmar_compra` solo suma—, así que este control
se limita a verificar que **la infraestructura está lista** para C3 y C4.

```bash
# 6.1 El FOR UPDATE ya existe donde corresponde
grep -n "FOR UPDATE" supabase/migrations/*_comercial_*.sql
```
**Esperado: `confirmar_compra` y `anular_compra` bloquean la fila de `compras`.** No hace falta
`ORDER BY lote_id` todavía: ninguno de los dos toca varios lotes en orden variable.

```bash
# 6.2 El guard rpcReallyRan está disponible para C3 y C4
grep -rn "rpcReallyRan" tests/integration/
```
**Esperado: definido en `guarderia.integration.test.ts`.** Si ya se copió a un archivo del
módulo, mejor.

### Control 7 — Grants y PostgREST

```bash
# 7.1 El guardrail G3 corre y descubre las funciones
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
```
**Esperado: passed, `0 skipped`, y el `it.each` corre con al menos 9 casos.** Anotá el número
exacto: si es menor que la cantidad de funciones creadas por las migraciones comerciales, el
enumerador no las está viendo.

```bash
# 7.2 Contá las funciones que DEBERÍA haber descubierto
grep -hoE "CREATE\s+(OR REPLACE\s+)?FUNCTION\s+(public\.)?[a-z0-9_]+" \
  supabase/migrations/*_comercial_*.sql | sed 's/.*[. ]//' | sort -u
```
**Esperado: la lista coincide con los casos del `it.each` de 7.1.** Las que falten es porque su
migración no lleva la marca `-- @modulo: comercial`.

```bash
# 7.3 Toda migración comercial lleva su marca
grep -L "@modulo: comercial" supabase/migrations/*_comercial_*.sql
```
**Esperado: sin salida.**

```bash
# 7.4 Ninguna función del módulo es ejecutable por anon ni authenticated
psql "$DATABASE_URL" -c "SELECT p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
  ('signo_movimiento','cantidad_valida_para_unidad','producto_conversiones_sin_ciclo',
   'movimientos_stock_inmutable','existencias_lote_aplicar_movimiento',
   'recalcular_existencias','verificar_existencias','confirmar_compra','anular_compra');"
```
**Esperado: `anon = f` y `auth = f` en las nueve filas.**

```bash
# 7.5 Toda migración de RPC termina con NOTIFY
for m in $(grep -l "CREATE OR REPLACE FUNCTION" supabase/migrations/*_comercial_*.sql); do
  tail -5 "$m" | grep -q "NOTIFY pgrst" || echo "SIN NOTIFY: $m"
done
```
**Esperado: sin salida**, salvo la migración de ENUMs, que no crea funciones.

### Control 8 — Los tests prueban algo

Buscá tests que pasarían aunque la funcionalidad no existiera.

```bash
# 8.1 Nada de expect(true) ni asserts sobre mocks propios
grep -rn "expect(true)\|expect(1).toBe(1)\|toBeDefined()" tests/unit tests/integration | grep -iE "comercial|producto|proveedor|stock|compra|lote|movimiento"
```
**Esperado: sin salida.** Un `toBeDefined()` sobre un mock que el propio test creó no prueba
nada.

```bash
# 8.2 Las suites de integración NO se saltearon
npx vitest run --config vitest.integration.config.ts 2>&1 | tail -20
```
**Esperado: la línea de resumen dice `0 skipped`.** Si dice cualquier otra cosa, **todos** los
controles que dependen de integración (3, 4.2, 7.1, 7.4) están sin verificar.

```bash
# 8.3 Las reglas que la BASE hace cumplir se prueban CONTRA la base
grep -n "MOVEMENT_IMMUTABLE\|23505\|23503\|23514" tests/integration/stock.integration.test.ts \
  tests/integration/catalogo-comercial.integration.test.ts | head -20
```
**Esperado: aparecen códigos de error de Postgres.** RN-MV2, MV3, MV5, MV8, RN-PR1, PR4, PR7,
PR11, PR12, RN-PRV1, RN-FR2 y RN-SC2 **no se pueden probar leyendo el código fuente**: si su
test no le pega a la base y no espera un error de la base, no prueba la regla.

```bash
# 8.4 Los guardrails tienen autoverificación por mutación
grep -c "MUTACIÓN" tests/unit/audit-modulo-enum.test.ts tests/unit/stock-ledger-guardrail.test.ts
```
**Esperado: al menos 1 en cada uno.** Un guardrail sin caso de mutación no se sabe si detecta.

```bash
# 8.5 Los reportes de tanda declaran las verificaciones por mutación
```
Revisá los reportes de C1·T1, C1·T3, C1·T5, C2·T1, C2·T3 y C2·T5. **Cada uno tenía que reportar
al menos una verificación por mutación con el mensaje de error obtenido.** Anotá cuáles la
reportaron y cuáles no.

---

## 2. Controles específicos de C1 y C2

Los modos de falla silenciosa que aplican a estas dos etapas (§12.1 de la spec).

### 2.1 — R-02: nadie agregó `stock_actual` "por performance"

```bash
npx vitest run tests/unit/stock-ledger-guardrail.test.ts
grep -rn 'from("existencias_lote")' supabase/functions/api/src/modules/ | grep -E '\.(update|insert|delete|upsert)\('
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='productos' AND column_name ILIKE '%stock%';"
```
**Esperado:** guardrail passed · grep sin resultados · en `productos` solo `stock_minimo`.
Cualquier `stock_actual` o `existencia_actual` en `productos` o `lotes` es **FALLA de diseño**,
no un detalle.

### 2.2 — R-03: el costo se guarda, no se recalcula

```bash
grep -rn "costo_reposicion" supabase/functions/api/src/modules/stock/stock.service.ts
```
**Esperado:** aparece solo en lecturas de catálogo o reportes de precio. **Nunca** en el kárdex,
en la valorización ni en un cálculo de margen. Si un reporte joinea `costo_reposicion` para
valuar, revaluó hacia atrás mercadería comprada más barata → **FALLA**.

### 2.3 — R-06: el ENUM y el tipo TypeScript, los dos

Cubierto por el control 4. Verificá además que **ninguna de las dos direcciones se agregó sin la
otra** revisando el diff de C1·T1.

### 2.4 — R-14: el `NOTIFY pgrst` no se olvidó

Cubierto por el control 7.5. Verificá además que ningún test de integración falló alguna vez con
"could not find the function in the schema cache" según los reportes de tanda.

### 2.5 — R-15: el lote genérico por compra es correcto, no un bug

```bash
psql "$DATABASE_URL" -c "SELECT p.nombre, count(l.id) AS lotes
  FROM lotes l JOIN productos p ON p.id=l.producto_id AND p.tenant_id=l.tenant_id
  WHERE p.controla_lote = false GROUP BY 1 HAVING count(l.id) > 1;"
```
**Si aparecen productos con varios lotes genéricos, está BIEN**: cada compra a distinto costo
crea uno nuevo y el libro mayor mantiene el costo correcto (RN-LO3). **No lo reportes como
defecto.** Se controla acá para que nadie lo "arregle" en C3.

### 2.6 — Las decisiones de §12.2 que son irrecuperables

```bash
# lote_padre_id existe desde la migración que crea lotes (D-13)
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='lotes' AND column_name IN ('lote_padre_id','costo_unitario_efectivo');"
grep -n "lote_padre_id" supabase/migrations/20260908000001_comercial_libro_mayor.sql

# operacion_id existe y es NOT NULL
psql "$DATABASE_URL" -c "SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name='movimientos_stock' AND column_name='operacion_id';"

# La escala de cantidades es 3, no 2
psql "$DATABASE_URL" -c "SELECT column_name, numeric_precision, numeric_scale
  FROM information_schema.columns WHERE table_name='movimientos_stock'
  AND column_name IN ('cantidad','costo_unitario','costo_total');"

# admite_decimales existe en unidades_medida
psql "$DATABASE_URL" -c "SELECT count(*) FROM unidades_medida WHERE admite_decimales;"

# Los tipos de conversión están en el ENUM desde C1
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='tipo_movimiento_stock'
  AND e.enumlabel IN ('salida_conversion','entrada_conversion','merma_fraccionamiento');"
```
**Esperado:** las dos columnas de `lotes` presentes · `operacion_id` `NOT NULL` ·
`cantidad` = `(14,3)`, `costo_unitario` = `(14,4)`, `costo_total` = `(14,2)` ·
al menos 5 unidades con decimales · **3** tipos de conversión en el ENUM.

**Cualquier fallo acá es RECHAZO, no corrección.** Son las seis decisiones que §12.2 marca como
imposibles de retrofitear: reconstruir la cadena de trazabilidad, la escala de gramos o los
tipos de conversión sobre datos históricos no es un `UPDATE` costoso, es información que no
existe.

---

## 3. Veredicto

Escribí **uno** de los tres, explícito, con la tabla de los ocho controles y su resultado.

### APROBADA
Los ocho controles pasan, los controles específicos pasan, y ninguna RN de C1/C2 quedó
`PENDIENTE`. Se avanza a C3.

### APROBADA CON CORRECCIONES
Lista numerada. **Cada corrección con: archivo exacto, qué está mal, y qué tiene que decir.**
Al final, el prompt de corrección listo para pegar en una sesión de ejecución, con el formato de
los prompts de tanda (secciones 0 a 7).

**No apruebes con pendientes "menores".** Un pendiente aprobado es deuda invisible: en C3 nadie
lo va a volver a mirar.

### RECHAZADA
Solo si falla algo de **2.6** o si el control 3 (aislamiento) falla. Decí qué decisión de diseño
se violó y por qué rehacer es más barato que parchar.

---

## 4. Qué NO hacer

- **No implementes las correcciones.** Escribí el prompt para que las haga la sesión de
  ejecución. La separación de roles es lo que mantiene el costo abajo.
- **No apruebes un control que no pudiste correr.** Si falta `$DATABASE_URL` o faltan las
  credenciales de `TEST_SUPABASE_*`, el control **no está verificado** y eso es un resultado
  distinto de "pasa". Decilo así.
- **No reinterpretes un resultado que no coincide.** Si el comando esperaba `0` y devolvió `2`,
  el control falla. No busques la explicación: anotá el resultado y seguí.
- No modifiques `docs/ESPEC_MODULO_COMERCIAL.md`, `PLAN_ETAPAS_COMERCIAL.md` ni ningún prompt.
- No toques `MATRIZ_RN_TESTS_COMERCIAL.md`: la llenan las tandas de ejecución.

## 5. Reporte final (obligatorio, va al chat)

1. **Tabla de los ocho controles**: número, comando corrido, resultado obtenido, PASA/FALLA/SIN VERIFICAR.
2. **Tabla de los seis controles específicos** (2.1 a 2.6), mismo formato.
3. **Veredicto**, uno de los tres.
4. Si hay correcciones: la lista numerada y el prompt de corrección.
5. **Cuántos controles quedaron SIN VERIFICAR y por qué.** Este número es el más importante del
   reporte: un control sin verificar no es un control que pasa.
`````

**C3·T1** — Cuando C2 está aprobada por su auditoría. · **Gemini Flash** · Entrega: `cajas`, `sesiones_caja`, `movimientos_caja`, el índice parcial único y los tests de base.

`````markdown
# ETAPA C3 · TANDA 1/3 — Migración de caja y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2 completa, aprobada por `C2_AUDITORIA.md`, y los cuatro guardrails en
> verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.8 | `cajas`, `sesiones_caja`, `movimientos_caja` y el índice parcial único. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-07 y D-08 | El cierre irreversible y por qué solo el efectivo afecta el arqueo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.7 | RN-CJ1…CJ9. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Tu propia migración de C2·T1: el trigger de inmutabilidad que vas a replicar para `movimientos_caja`. |
| `supabase/migrations/20260614000002_tables.sql` | El índice `uq_servicios_tenant_nombre` — es el precedente de índice parcial único del repo. |
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

1. `supabase/migrations/20260915000001_comercial_caja.sql`
2. `tests/integration/caja.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/rls.test.ts` | Aislamiento de las tres tablas de caja (RN-SC4). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | La parte de RN-CJ4 que la base hace cumplir. |

## 2. Especificación exacta

### 2.1. `cajas`

```
id, tenant_id, nombre TEXT NOT NULL, activa BOOLEAN NOT NULL DEFAULT true, created_at
```
- `CREATE UNIQUE INDEX uq_cajas_tenant_nombre ON cajas (tenant_id, lower(nombre));`
- `ALTER TABLE cajas ADD CONSTRAINT cajas_id_tenant_key UNIQUE (id, tenant_id);`

Una clínica chica tiene una fila. La tabla existe para no tener que inventarla cuando abran el
segundo mostrador.

**Seed:** `on_tenant_created()` **no se toca**. La caja principal la crea el Service la primera
vez que se abre una sesión y no hay ninguna (ver C3·T3). Motivo: agregar un `INSERT` a
`on_tenant_created()` obligaría a un backfill de todos los tenants existentes, y una caja sin
sesiones no le sirve a nadie.

### 2.2. `sesiones_caja`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `caja_id` | `UUID NOT NULL` | FK compuesta → `cajas`, `ON DELETE RESTRICT`. |
| `estado` | `estado_sesion_caja NOT NULL DEFAULT 'abierta'` | |
| `apertura_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `apertura_usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `saldo_inicial` | `NUMERIC(14,2) NOT NULL CHECK (saldo_inicial >= 0)` | |
| `cierre_at` | `TIMESTAMPTZ NULL` | |
| `cierre_usuario_id` | `UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `saldo_teorico_efectivo` | `NUMERIC(14,2) NULL` | Calculado y **congelado** al cerrar. |
| `efectivo_contado` | `NUMERIC(14,2) NULL` | Lo declarado por el usuario. |
| `diferencia` | `NUMERIC(14,2) NULL` | `efectivo_contado − saldo_teorico_efectivo`. **Se guarda siempre, incluso en cero.** |
| `motivo_diferencia`, `observaciones` | `TEXT NULL` | |
| `created_at` | | |

```sql
ALTER TABLE sesiones_caja ADD CONSTRAINT sesiones_caja_id_tenant_key UNIQUE (id, tenant_id);

-- RN-CJ4: una sola sesión abierta por caja, garantizado EN LA BASE y no en el
-- Service. Un chequeo previo en TypeScript deja una ventana entre el SELECT y el
-- INSERT: dos aperturas simultáneas ven "no hay ninguna abierta" y las dos
-- insertan. Este índice parcial único cierra esa ventana. Mismo recurso que
-- uq_servicios_tenant_nombre.
CREATE UNIQUE INDEX uq_sesion_caja_abierta
  ON sesiones_caja (tenant_id, caja_id) WHERE estado = 'abierta';

CREATE INDEX idx_sesiones_caja_tenant ON sesiones_caja (tenant_id, apertura_at DESC);

-- El cierre completa cuatro columnas de una: o están las cuatro o no está ninguna.
-- Una sesión cerrada sin `diferencia` es exactamente el caso que RN-CJ6 prohíbe.
ALTER TABLE sesiones_caja ADD CONSTRAINT chk_sesion_cierre_completo CHECK (
  (estado = 'abierta' AND cierre_at IS NULL AND saldo_teorico_efectivo IS NULL
                      AND efectivo_contado IS NULL AND diferencia IS NULL)
  OR
  (estado = 'cerrada' AND cierre_at IS NOT NULL AND saldo_teorico_efectivo IS NOT NULL
                      AND efectivo_contado IS NOT NULL AND diferencia IS NOT NULL)
);
```

**El `CHECK` de cierre completo es RN-CJ6 escrita en la base.** Registrar el cero distingue
*"se arqueó y dio bien"* de *"no se arqueó"*, y un `NULL` no distingue nada.

### 2.3. `movimientos_caja` — libro mayor del efectivo

```
id, tenant_id,
sesion_caja_id  UUID NOT NULL,   -- FK compuesta → sesiones_caja, ON DELETE RESTRICT
tipo            tipo_movimiento_caja NOT NULL,
medio_pago_id   UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
importe         NUMERIC(14,2) NOT NULL CHECK (importe > 0),
venta_id        UUID NULL,       -- sin FK: `ventas` llega en C4·T1
compra_id       UUID NULL,       -- FK compuesta → compras, ON DELETE RESTRICT
motivo          TEXT NULL,
usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
created_at
```

- `ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_id_tenant_key UNIQUE (id, tenant_id);`
- `CREATE INDEX idx_mov_caja_sesion ON movimientos_caja (tenant_id, sesion_caja_id, created_at);`
- **Sin `updated_at`**: append-only, igual que `movimientos_stock`.

**`signo_movimiento_caja()`**, mismo criterio que la de stock:

```sql
CREATE OR REPLACE FUNCTION public.signo_movimiento_caja(p_tipo tipo_movimiento_caja)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_tipo IN ('ingreso_venta','ingreso_cobro_cuenta_corriente','ingreso_manual')
              THEN 1 ELSE -1 END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) TO service_role;
```

Tres tipos son ingreso; cuatro son egreso. Contá los siete del ENUM.

**Trigger de inmutabilidad**, calcado del de `movimientos_stock`:

```sql
CREATE OR REPLACE FUNCTION public.movimientos_caja_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Mismo criterio que movimientos_stock: los Services escriben con service_role,
  -- que sí podría actualizar. Este trigger es la única capa que frena al camino
  -- real de escritura.
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_movimientos_caja_inmutable
  BEFORE UPDATE OR DELETE ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_inmutable();

REVOKE ALL ON FUNCTION public.movimientos_caja_inmutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.movimientos_caja_inmutable() TO service_role;
```

**No hay trigger de caché en caja.** El saldo teórico se calcula sumando bajo el `FOR UPDATE`
de la sesión al cerrar (C3·T2): una sesión tiene decenas de movimientos, no miles, y no
justifica una tabla derivada más.

### 2.4. RLS

Las tres tablas, `FOR SELECT` con `tiene_permiso('manage_cash')`. Sin `FORCE`, sin políticas de
escritura, sin `GRANT`.

### 2.5. `tests/integration/caja.integration.test.ts`

| `it()` | Caso |
|---|---|
| `RN-CJ4: el índice parcial rechaza la segunda sesión abierta` | Insertar una sesión `abierta` en la caja X, insertar otra `abierta` en la misma caja → falla (`23505`). Cerrar la primera e insertar la segunda → funciona. **Y con otra caja del mismo tenant** → funciona: el índice es por `(tenant_id, caja_id)`, no por tenant. |
| `RN-CJ6: una sesión cerrada sin diferencia no es válida` | `UPDATE` de una sesión a `estado='cerrada'` con `diferencia = NULL` → viola `chk_sesion_cierre_completo`. |
| `un movimiento de caja no se puede actualizar ni borrar` | `serviceDb.from("movimientos_caja").update(…)` → `MOVEMENT_IMMUTABLE`. Ídem `.delete()`. Los dos casos. |
| `el signo lo determina el tipo` | `signo_movimiento_caja('ingreso_venta')` → 1. `signo_movimiento_caja('egreso_retiro')` → −1. |
| `RN-SC2: una sesión de A no puede colgar de una caja de B` | FK compuesta: falla con `23503`. |

**RN-CJ4 se cierra en dos tandas.** Acá se prueba que **la base** rechaza la segunda fila; en
C3·T2 se prueba que **dos aperturas simultáneas** producen exactamente una ganadora. Son cosas
distintas: la primera puede pasar y la segunda fallar si el RPC atrapa el `23505` y reintenta.
En la matriz, RN-CJ4 queda `PENDIENTE` hasta T2.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CJ4 (parcial) | Una sola sesión abierta por caja, garantizado por índice único parcial. → `409 CASH_SESSION_ALREADY_OPEN` | `it('RN-CJ4: el índice parcial rechaza la segunda sesión abierta', …)` |
| RN-CJ6 (parcial) | La diferencia se registra siempre, incluso en cero. | `it('RN-CJ6: una sesión cerrada sin diferencia no es válida', …)` |
| RN-SC4 | Aislamiento por RLS de las tres tablas nuevas. **Bloqueante.** | Tres `it('RN-SC4: …')` en `rls.test.ts` |

## 4. Orden de trabajo

1. Migración con marca, aplicada.
2. Tests. Verificá por mutación el índice parcial único: sacalo, confirmá que el test se pone
   rojo, volvé a ponerlo. Reportá el mensaje.
3. `rls.test.ts` extendido.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. El índice parcial único existe y es PARCIAL
psql "$DATABASE_URL" -c "SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='sesiones_caja' AND indexname='uq_sesion_caja_abierta';"
# → el indexdef tiene que terminar en: WHERE (estado = 'abierta'::estado_sesion_caja)
#   Si NO tiene el WHERE, el índice impide una segunda sesión CERRADA en la misma
#   caja, que es un bug que aparece el segundo día de uso.

# 2. signo_movimiento_caja es IMMUTABLE
psql "$DATABASE_URL" -c "SELECT provolatile FROM pg_proc WHERE proname='signo_movimiento_caja';"
# → i

# 3. El trigger de inmutabilidad cubre UPDATE y DELETE
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger
  WHERE tgrelid='movimientos_caja'::regclass AND NOT tgisinternal;"
# → trg_movimientos_caja_inmutable

# 4. Solo políticas de SELECT
psql "$DATABASE_URL" -c "SELECT tablename, cmd FROM pg_policies
  WHERE tablename IN ('cajas','sesiones_caja','movimientos_caja');"
# → solo SELECT

# 5. Tests
npx vitest run --config vitest.integration.config.ts \
  tests/integration/caja.integration.test.ts tests/integration/rls.test.ts
# → "N passed", "0 skipped"

# 6. Suites completas y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each de G3 incluye signo_movimiento_caja y movimientos_caja_inmutable
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
`````

**C3·T2** — Cuando C3·T1 está en verde. · **Gemini Flash** · Entrega: los tres RPC de caja y el test concurrente de doble apertura.

`````markdown
# ETAPA C3 · TANDA 2/3 — Los tres RPC de caja y el test concurrente
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C3·T1 en verde, con `caja.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **El cierre de caja es irreversible.** Una sesión cerrada no se reabre, no se edita y no
> admite movimientos nuevos. El pedido de "reabrir solo para el admin" va a llegar el primer
> mes (R-09): la respuesta es que el error se corrige con un movimiento en la sesión
> siguiente, con motivo. Mismo criterio que la eutanasia y que el fraccionamiento.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.3 | El esqueleto de `cerrar_sesion_caja`, copiado línea por línea. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.7 | RN-CJ2, CJ4…CJ9 con sus casos de test. |
| `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql` | El patrón del RPC: `SECURITY DEFINER`, resolución del usuario, auditoría interna, `REVOKE`/`GRANT`, `NOTIFY`. |
| `supabase/migrations/20260629000001_crear_estadia_con_cupo_rpc.sql` | **El patrón del `FOR UPDATE` como mutex**, y su doc-comment explicando por qué el chequeo previo en el Service no alcanza. |
| `tests/integration/guarderia.integration.test.ts` líneas 160-240 | **El patrón concurrente exacto a copiar**: `rpcReallyRan()`, `esExito()`, `Promise.all` de dos `.rpc()`. |
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

1. `supabase/migrations/20260915000002_comercial_caja_rpcs.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/caja.integration.test.ts` | RN-CJ2, CJ4 (concurrente), CJ5, CJ6, CJ7, CJ8, CJ9. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas siete RN. |

## 2. Especificación exacta

### 2.1. `abrir_sesion_caja`

```
abrir_sesion_caja(p_tenant_id UUID, p_usuario_id UUID, p_caja_id UUID, p_saldo_inicial NUMERIC)
RETURNS TABLE (sesion_id UUID, caja_id UUID, apertura_at TIMESTAMPTZ, saldo_inicial NUMERIC)
```

```
BEGIN
  IF p_saldo_inicial IS NULL OR p_saldo_inicial < 0
     THEN RAISE EXCEPTION 'INVALID_OPENING_BALANCE'; END IF;

  -- La caja existe, es de este tenant y está activa.
  SELECT activa INTO v_activa FROM cajas
   WHERE id = p_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;

  -- RN-CJ4. NO se chequea "¿hay alguna abierta?" con un SELECT previo: eso deja
  -- una ventana entre la lectura y el INSERT por la que pasan dos aperturas
  -- simultáneas. Se intenta insertar y se deja que el índice parcial único
  -- decida, capturando su unique_violation. La base es el árbitro.
  BEGIN
    INSERT INTO sesiones_caja (tenant_id, caja_id, estado, apertura_usuario_id, saldo_inicial)
    VALUES (p_tenant_id, p_caja_id, 'abierta', p_usuario_id, p_saldo_inicial)
    RETURNING id, apertura_at INTO v_sesion_id, v_apertura;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'CASH_SESSION_ALREADY_OPEN';
  END;

  INSERT INTO registros_auditoria (... 'CREATE', 'cash_register', v_sesion_id::text ...);
  RETURN QUERY SELECT v_sesion_id, p_caja_id, v_apertura, p_saldo_inicial;
END;
```

**El `EXCEPTION WHEN unique_violation` NO puede envolver más que el `INSERT`.** Si envuelve
todo el cuerpo, se come errores de otras causas y los reporta como "ya hay una sesión abierta",
que es un diagnóstico falso difícil de rastrear.

### 2.2. `registrar_movimiento_caja`

```
registrar_movimiento_caja(p_tenant_id UUID, p_usuario_id UUID, p_sesion_id UUID,
                          p_tipo tipo_movimiento_caja, p_medio_pago_id UUID,
                          p_importe NUMERIC, p_motivo TEXT DEFAULT NULL,
                          p_referencia TEXT DEFAULT NULL)
RETURNS TABLE (movimiento_id UUID, sesion_id UUID)
```

```
BEGIN
  -- RN-CJ5: la sesión tiene que estar ABIERTA. El FOR UPDATE evita que se cierre
  -- entre esta lectura y el INSERT.
  SELECT estado INTO v_estado FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND              THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;
  IF v_estado <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_CLOSED';    END IF;

  -- El medio de pago existe y está activo.
  SELECT activo, requiere_referencia INTO v_mp
    FROM medios_pago WHERE id = p_medio_pago_id;
  IF NOT FOUND        THEN RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED'; END IF;
  IF NOT v_mp.activo  THEN RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED'; END IF;

  -- RN-CJ9: transferencia y tarjeta piden número de operación; efectivo no.
  IF v_mp.requiere_referencia AND (p_referencia IS NULL OR trim(p_referencia) = '')
     THEN RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED'; END IF;

  IF p_importe IS NULL OR p_importe <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;

  -- Los movimientos manuales exigen motivo: un egreso de caja sin explicación es
  -- exactamente el asiento que después nadie puede justificar.
  IF p_tipo IN ('ingreso_manual','egreso_manual','egreso_retiro')
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  INSERT INTO movimientos_caja (...) RETURNING id INTO v_mov_id;
  INSERT INTO registros_auditoria (... 'CREATE', 'cash_register', v_mov_id::text ...);
  RETURN QUERY SELECT v_mov_id, p_sesion_id;
END;
```

**`medios_pago` es un catálogo global, sin `tenant_id`.** Su consulta es la única del cuerpo
que **no** lleva filtro de tenant, y está bien. Todas las demás sí.

### 2.3. `cerrar_sesion_caja`

```
cerrar_sesion_caja(p_tenant_id UUID, p_usuario_id UUID, p_sesion_id UUID,
                   p_efectivo_contado NUMERIC, p_motivo TEXT DEFAULT NULL,
                   p_observaciones TEXT DEFAULT NULL)
RETURNS TABLE (sesion_id UUID, saldo_teorico_efectivo NUMERIC,
               efectivo_contado NUMERIC, diferencia NUMERIC)
```

```
BEGIN
  SELECT * INTO v_sesion FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;
  IF v_sesion.estado <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_CLOSED';    END IF;

  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0
     THEN RAISE EXCEPTION 'INVALID_OPENING_BALANCE'; END IF;

  -- RN-CJ2: SOLO los medios con afecta_arqueo entran al teórico. Los pagos con
  -- tarjeta se registran igual —hacen falta para el total vendido— pero no
  -- afectan el efectivo que hay en el cajón. Ahí D-08 se paga sola: una venta en
  -- cuenta corriente no genera pago en efectivo y el arqueo cierra igual (RN-CJ3).
  SELECT v_sesion.saldo_inicial
         + COALESCE(sum(mov.importe * signo_movimiento_caja(mov.tipo)), 0)
    INTO v_teorico
    FROM movimientos_caja mov
    JOIN medios_pago mp ON mp.id = mov.medio_pago_id
   WHERE mov.sesion_caja_id = p_sesion_id
     AND mov.tenant_id      = p_tenant_id
     AND mp.afecta_arqueo;

  v_diferencia := p_efectivo_contado - v_teorico;

  -- RN-CJ7: por encima de la tolerancia del tenant, el motivo es obligatorio.
  SELECT tolerancia_diferencia_arqueo INTO v_tolerancia
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  IF abs(v_diferencia) > COALESCE(v_tolerancia, 0)
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- RN-CJ6: la diferencia se guarda SIEMPRE, incluso en cero. RN-CJ8: el teórico
  -- se CONGELA. Si mañana aparece un movimiento que faltaba cargar, el teórico de
  -- esta sesión no cambia: el ajuste va a la sesión siguiente. Una cifra de
  -- arqueo que se recalcula sola no sirve para controlar a nadie.
  UPDATE sesiones_caja
     SET estado = 'cerrada', cierre_at = now(), cierre_usuario_id = p_usuario_id,
         saldo_teorico_efectivo = v_teorico,
         efectivo_contado = p_efectivo_contado,
         diferencia = v_diferencia,
         motivo_diferencia = p_motivo, observaciones = p_observaciones
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (... 'UPDATE', 'cash_register', p_sesion_id::text,
    jsonb_build_object('saldo_teorico', v_teorico, 'contado', p_efectivo_contado,
                       'diferencia', v_diferencia));

  RETURN QUERY SELECT p_sesion_id, v_teorico, p_efectivo_contado, v_diferencia;
END;
```

**No existe `reabrir_sesion_caja`.** No lo escribas, ni siquiera "para el admin". El pedido va
a llegar; la respuesta es la sesión siguiente con motivo.

Cierre del archivo: `REVOKE`/`GRANT` para los tres, y `NOTIFY pgrst, 'reload schema';`.

### 2.4. Tests

| `it()` | Caso |
|---|---|
| `RN-CJ4: dos aperturas SIMULTÁNEAS de la misma caja → gana exactamente una` | **Copiá el patrón de `guarderia.integration.test.ts`.** `Promise.all` de dos `.rpc("abrir_sesion_caja", …)` sobre la misma caja. `expect(rpcReallyRan(r1.error)).toBe(true)` y lo mismo para r2. Exactamente un éxito y exactamente un fallo, con `CASH_SESSION_ALREADY_OPEN`. Y la garantía dura: `SELECT count(*) FROM sesiones_caja WHERE caja_id = X AND estado = 'abierta'` → **1**. Repetido `N` veces, con `N` desde `process.env.CONCURRENCY_REPS ?? 50`. |
| `RN-CJ2: solo el efectivo afecta el arqueo` | Abrir con saldo inicial 1.000. Registrar `ingreso_venta` de 5.000 en **transferencia** y 2.000 en **efectivo**. Cerrar con 3.000 contados → `saldo_teorico_efectivo = 3.000`, **no 8.000**, y `diferencia = 0`. |
| `RN-CJ5: cerrar es irreversible` | Cerrar. (a) `registrar_movimiento_caja` sobre esa sesión → `CASH_SESSION_CLOSED`. (b) `cerrar_sesion_caja` otra vez → `CASH_SESSION_CLOSED`. (c) **No existe ninguna función que la reabra**: `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%'` → 0. |
| `RN-CJ6: la diferencia se guarda incluso en cero` | Cerrar con el efectivo exacto → `diferencia = 0.00` y **`diferencia IS NOT NULL`**. Asertá las dos cosas: `expect(d).toBe(0)` pasaría con `null` en algunos comparadores laxos. |
| `RN-CJ7: la diferencia sobre la tolerancia exige motivo` | Con `tolerancia_diferencia_arqueo = 0`: cerrar con $50 de faltante **sin motivo** → `REASON_REQUIRED`; con motivo de 10+ caracteres → funciona y el motivo queda en `motivo_diferencia`. Con `tolerancia = 100` y $50 de faltante sin motivo → **funciona**. |
| `RN-CJ8: el teórico se congela` | Cerrar. Insertar a la fuerza un `movimientos_caja` en la sesión cerrada con `serviceDb` (la FK lo permite; lo que no se puede es pasar por el RPC). Releer la sesión → `saldo_teorico_efectivo` **no cambió**. |
| `RN-CJ9: la referencia es obligatoria según el medio` | `transferencia` sin `p_referencia` → `PAYMENT_REFERENCE_REQUIRED`. `efectivo` sin referencia → funciona. |

**El guard `rpcReallyRan()` no es opcional en el test concurrente.** Sin él, si el `NOTIFY
pgrst` faltara, las dos llamadas fallarían con "no se encontró la función", el test contaría
"cero éxitos, dos fallos" y podría interpretarse como que la exclusión funcionó. Es el falso
verde exacto que ese guard existe para atrapar.

**Las repeticiones van por variable de entorno, no editando el test.** El final clásico de esta
historia es que en CI tarda, alguien lo comenta "por ahora", y no vuelve nunca.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CJ2 | Solo el efectivo afecta el arqueo. | `it('RN-CJ2: solo el efectivo afecta el arqueo', …)` |
| RN-CJ4 | Una sola sesión abierta por caja. → `409 CASH_SESSION_ALREADY_OPEN` | `it('RN-CJ4: dos aperturas SIMULTÁNEAS de la misma caja → gana exactamente una', …)` |
| RN-CJ5 | Cerrar es irreversible: no se reabre, no se edita, no admite movimientos. → `409 CASH_SESSION_CLOSED` | `it('RN-CJ5: cerrar es irreversible', …)` |
| RN-CJ6 | La diferencia se registra siempre, incluso en cero. | `it('RN-CJ6: la diferencia se guarda incluso en cero', …)` |
| RN-CJ7 | Diferencia sobre la tolerancia exige motivo. → `422 REASON_REQUIRED` | `it('RN-CJ7: la diferencia sobre la tolerancia exige motivo', …)` |
| RN-CJ8 | El teórico se congela al cerrar. | `it('RN-CJ8: el teórico se congela', …)` |
| RN-CJ9 | Referencia obligatoria según el medio de pago. → `422 PAYMENT_REFERENCE_REQUIRED` | `it('RN-CJ9: la referencia es obligatoria según el medio', …)` |

## 4. Orden de trabajo

1. **Tests primero.** Tienen que fallar con "no se encontró la función `abrir_sesion_caja`".
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde. Corré el concurrente con `CONCURRENCY_REPS=200` **al menos una vez** y
   reportá el resultado.
4. **Verificá RN-CJ4 por mutación:** reemplazá el `INSERT` + `EXCEPTION` por un `SELECT` previo
   de "¿hay alguna abierta?" seguido del `INSERT`, corré el test concurrente con
   `CONCURRENCY_REPS=200`, confirmá que **falla** (dos éxitos en alguna repetición), y volvé al
   original. Reportá en qué repetición falló. Este paso es lo que prueba que el índice parcial
   está haciendo el trabajo y no la suerte.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Los tres RPC existen y ninguno es ejecutable por anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE'),
  has_function_privilege('authenticated', oid, 'EXECUTE')
  FROM pg_proc WHERE proname IN
  ('abrir_sesion_caja','registrar_movimiento_caja','cerrar_sesion_caja');"
# → tres filas, las dos columnas en f

# 2. NO existe ninguna función de reapertura
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%';"
# → cero filas

# 3. El test concurrente con 200 repeticiones
CONCURRENCY_REPS=200 npx vitest run --config vitest.integration.config.ts \
  tests/integration/caja.integration.test.ts -t "RN-CJ4"
# → passed. Si falla aunque sea UNA vez en 200, hay una condición de carrera real.

# 4. Toda la suite de caja
npx vitest run --config vitest.integration.config.ts tests/integration/caja.integration.test.ts
# → "N passed", "0 skipped"

# 5. Suites completas y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C3·T3** — Cuando C3·T2 pasa 200 repeticiones. · **Gemini Flash** · Entrega: Service, Controller y rutas de caja. Cierra C3.

`````markdown
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
`````

**C4·T1** — Cuando C3 está completa. · **Gemini Flash** · Entrega: `ventas`, `ventas_items`, `ventas_pagos`, `contadores_tenant`, `servicios.precio` y los tests de base.

`````markdown
# ETAPA C4 · TANDA 1/5 — Migración de ventas y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C3 completa y en verde, con el concurrente de RN-CJ4 pasando 200
> repeticiones.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1 (redondeo del IVA), §4.7, §10.1, §10.2 | `ventas`, `ventas_items`, `ventas_pagos`, las columnas de `clientes` y de `servicios`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-03, D-08, D-10 | Registro interno sin facturación, cuenta corriente reservada, productos y servicios en la misma venta sin fusionar catálogos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6 | RN-VT1…VT8. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.3 | `servicios` necesita su `UNIQUE (id, tenant_id)`. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Tus FKs compuestas y el CHECK de coherencia documental que hay que completar acá. |
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

1. `supabase/migrations/20260922000001_comercial_ventas.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | **Crealo**: RN-VT3, RN-SC2 sobre las tablas nuevas. |
| `tests/integration/rls.test.ts` | Aislamiento de las tres tablas de venta (RN-SC4). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-VT3. |

## 2. Especificación exacta

### 2.0. Regla de redondeo del IVA — copiala, no la deduzcas

El precio que se carga y se cobra es el **precio final con IVA incluido**, porque así se exhibe
en el mostrador. La descomposición se calcula **por línea**:

```
neto_unitario = round(precio_unitario / (1 + alicuota/100), 2)
iva_unitario  = precio_unitario - neto_unitario     -- POR DIFERENCIA, nunca aparte
importe_linea = round(precio_unitario * cantidad, 2)
```

**El IVA se calcula por diferencia** para que `neto + iva = precio` sea exacto **siempre**. Si
se calculan y redondean los dos por separado, hay casos donde la suma da un centavo de más y el
total del ticket no cuadra con sus líneas. Es R-04 y es el error más fácil de cometer acá.

**El total de la venta es la suma de los importes de línea ya redondeados**, nunca un recálculo
desde los netos.

Esto se implementa en el RPC de C4·T2. Va acá para que la migración deje las columnas con la
precisión correcta y no haya que cambiarla después.

### 2.1. Columnas nuevas en tablas de producción

```sql
-- `servicios` necesita su UNIQUE (id, tenant_id) porque ventas_items.servicio_id
-- es una FK compuesta. El par ya es único por construcción (id es PK).
ALTER TABLE servicios ADD CONSTRAINT servicios_id_tenant_key UNIQUE (id, tenant_id);

-- La tabla no tiene precio, y NINGUNA del sistema lo tiene. Sin esto no se puede
-- cobrar una consulta en el mismo ticket que una pipeta. Nullable porque hay
-- servicios sin precio fijo; la línea de venta lo copia como snapshot.
ALTER TABLE servicios
  ADD COLUMN precio       NUMERIC(14,2) NULL,
  -- Consecuencia directa de D-03: si el IVA se discrimina por ítem y una venta
  -- puede tener líneas de servicio, el servicio necesita su alícuota. Sin esto,
  -- la mitad de las líneas quedaría sin IVA discriminado.
  ADD COLUMN alicuota_iva NUMERIC(5,2) NOT NULL DEFAULT 21.00
    CHECK (alicuota_iva IN (0, 10.50, 21, 27));

ALTER TABLE clientes
  ADD COLUMN condicion_fiscal            condicion_fiscal NOT NULL DEFAULT 'consumidor_final',
  -- D-08: reservadas. La cuenta corriente NO se implementa.
  ADD COLUMN cuenta_corriente_habilitada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN limite_credito              NUMERIC(14,2) NULL;
```

**No se agrega documento a `clientes`.** `dni_cuit` ya existe con `UNIQUE (tenant_id, dni_cuit)`
y la venta lo copia como snapshot. Duplicar el documento en dos columnas es la clase de
decisión que se paga tres meses después.

**Cargar la lista de precios de los servicios es una tarea de datos del dueño**, no del código.
Agregar la columna es una línea; llenarla no lo es, y hasta que esté hecha las líneas de
servicio no se pueden cobrar. Anotalo en el reporte.

### 2.2. `contadores_tenant`

```sql
CREATE TABLE contadores_tenant (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  valor      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nombre)
);
```

**Se implementa con una fila de contador bloqueada con `FOR UPDATE`, no con una `SEQUENCE`.**
Una sequence no es transaccional y deja huecos cuando una transacción falla, y un correlativo
interno con huecos genera preguntas del tipo *"¿dónde está la venta 341?"* que no tienen buena
respuesta. **Costo aceptado:** las ventas de un mismo tenant se serializan en ese contador;
para una clínica con uno o dos mostradores es irrelevante.

RLS: `FOR SELECT` con `tiene_permiso('view_sales')`.

### 2.3. `ventas`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `numero_operacion` | `BIGINT NOT NULL` | Correlativo por tenant. **No es un número de comprobante.** |
| `cliente_id` | `UUID NULL` | FK compuesta → `clientes`, `ON DELETE RESTRICT`. `NULL` = venta de mostrador anónima. |
| `condicion_fiscal_snapshot` | `condicion_fiscal NULL` | Copiada del cliente al registrar. |
| `documento_snapshot` | `TEXT NULL` | Copia de `clientes.dni_cuit`. |
| `sesion_caja_id` | `UUID NOT NULL` | FK compuesta → `sesiones_caja`, `ON DELETE RESTRICT`. **Toda venta pertenece a una sesión**, aunque no mueva efectivo: es lo que responde *"qué se vendió en el turno de la tarde"*. |
| `condicion_pago` | `condicion_pago_venta NOT NULL DEFAULT 'contado'` | |
| `subtotal_neto`, `total_iva`, `descuento_importe`, `total`, `saldo_pendiente` | `NUMERIC(14,2) NOT NULL DEFAULT 0` | |
| `estado` | `estado_venta NOT NULL DEFAULT 'registrada'` | |
| `anulada_at` | `TIMESTAMPTZ NULL` | |
| `anulada_por_usuario_id` | `UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `motivo_anulacion` | `TEXT NULL` | |
| `comprobante_tipo`, `comprobante_punto_venta`, `comprobante_numero`, `cae` | `TEXT NULL` | **Reservadas, sin uso.** |
| `cae_vencimiento` | `DATE NULL` | **Reservada.** |
| `facturacion_estado` | `estado_facturacion NOT NULL DEFAULT 'no_facturada'` | **Reservada.** |
| `observaciones` | `TEXT NULL` | |
| `usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `created_at` | | **Sin `updated_at`: una venta registrada no se edita.** |

```sql
ALTER TABLE ventas ADD CONSTRAINT ventas_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE ventas ADD CONSTRAINT uq_ventas_tenant_numero UNIQUE (tenant_id, numero_operacion);
CREATE INDEX idx_ventas_tenant_fecha   ON ventas (tenant_id, created_at DESC);
CREATE INDEX idx_ventas_tenant_sesion  ON ventas (tenant_id, sesion_caja_id);
CREATE INDEX idx_ventas_tenant_cliente ON ventas (tenant_id, cliente_id);
CREATE INDEX idx_ventas_tenant_usuario ON ventas (tenant_id, usuario_id, created_at DESC);

-- La anulación completa tres columnas de una: o están las tres o no está ninguna.
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_anulacion_completa CHECK (
  (estado = 'registrada' AND anulada_at IS NULL AND anulada_por_usuario_id IS NULL
                          AND motivo_anulacion IS NULL)
  OR
  (estado = 'anulada' AND anulada_at IS NOT NULL AND anulada_por_usuario_id IS NOT NULL
                       AND motivo_anulacion IS NOT NULL)
);
```

El índice por `(tenant_id, usuario_id, created_at)` no es decorativo: **la recepcionista no
tiene `view_sales`** y su listado filtra por `usuario_id` (§8.2, decisión 3).

### 2.4. `ventas_items`

```
id, tenant_id,
venta_id                UUID NOT NULL,  -- FK compuesta → ventas, ON DELETE RESTRICT
tipo_item               tipo_item_venta NOT NULL,
producto_id             UUID NULL,      -- FK compuesta → productos, ON DELETE RESTRICT
servicio_id             UUID NULL,      -- FK compuesta → servicios, ON DELETE RESTRICT
descripcion_snapshot    TEXT NOT NULL,
cantidad                NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
precio_unitario         NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),  -- CON IVA incluido
alicuota_iva            NUMERIC(5,2) NOT NULL,   -- COPIADA, no referenciada
descuento_porcentaje    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (descuento_porcentaje BETWEEN 0 AND 100),
neto_unitario           NUMERIC(14,2) NOT NULL,
iva_unitario            NUMERIC(14,2) NOT NULL,
importe_total           NUMERIC(14,2) NOT NULL,
costo_unitario_efectivo NUMERIC(14,4) NULL,   -- solo productos; promedio ponderado de la línea
mascota_id              UUID NULL,      -- FK compuesta → mascotas, ON DELETE SET NULL
receta_id               UUID NULL,      -- RESERVADA, sin FK
profesional_prescriptor_id UUID NULL,   -- RESERVADA, sin FK
created_at
```

**RN-VT3, el CHECK que define la unión en la línea:**

```sql
ALTER TABLE ventas_items ADD CONSTRAINT chk_ventas_items_tipo CHECK (
  (tipo_item = 'producto' AND producto_id IS NOT NULL AND servicio_id IS NULL)
  OR
  (tipo_item = 'servicio' AND servicio_id IS NOT NULL AND producto_id IS NULL)
);
```

`ALTER TABLE ventas_items ADD CONSTRAINT ventas_items_id_tenant_key UNIQUE (id, tenant_id);`
`CREATE INDEX idx_ventas_items_venta ON ventas_items (tenant_id, venta_id);`

**La línea NO tiene `lote_id`, y es a propósito.** Una línea de 5 unidades puede resolverse
tomando 3 de un lote y 2 de otro por FEFO. La asignación vive en `movimientos_stock`, con N
movimientos por línea. Poner `lote_id` en la línea obligaría a partirla en dos y el cliente
vería dos renglones del mismo producto en su ticket sin entender por qué. **Si te dan ganas de
agregarlo, no lo hagas.**

`costo_unitario_efectivo` se **guarda** —promedio ponderado de los movimientos de la línea—
para el reporte de margen. No se recalcula nunca (RN-MV6).

### 2.5. `ventas_pagos`

```
id, tenant_id,
venta_id       UUID NOT NULL,   -- FK compuesta → ventas, ON DELETE RESTRICT
medio_pago_id  UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
importe        NUMERIC(14,2) NOT NULL CHECK (importe > 0),
referencia     TEXT NULL,
created_at
```

Pago mixto = varias filas. `SUM(importe) + saldo_pendiente = ventas.total` es RN-CJ1 y lo
valida el RPC, no un CHECK: la suma cruza filas y un CHECK no puede verla.

### 2.6. La FK diferida de `movimientos_stock`

C2·T1 declaró `venta_item_id` sin FK porque la tabla no existía:

```sql
ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_venta_item_tenant_fkey
  FOREIGN KEY (venta_item_id, tenant_id) REFERENCES ventas_items (id, tenant_id)
  ON DELETE RESTRICT;
```

Ídem `movimientos_caja.venta_id` → `ventas (id, tenant_id)`, `ON DELETE RESTRICT`.

### 2.7. RLS

| Tabla | Permiso |
|---|---|
| `ventas`, `ventas_items`, `ventas_pagos`, `contadores_tenant` | `view_sales` |

**`view_sales` solo lo tiene el admin** (§8.2). La recepcionista ve sus ventas por la API,
donde el Service filtra por `usuario_id`; por PostgREST directo no ve ninguna, y está bien.

### 2.8. Tests

**`tests/integration/ventas.integration.test.ts`** (crealo, reusando el arnés de
`caja.integration.test.ts`):

| `it()` | Caso |
|---|---|
| `RN-VT3: una línea es de producto o de servicio, nunca las dos` | `INSERT` con `tipo_item='producto'` y los **dos** ids → viola el CHECK. Con `tipo_item='producto'` y **ninguno** → viola. Con `tipo_item='servicio'` y `producto_id` puesto → viola. Con cada combinación válida → funciona. |
| `una venta registrada no se puede dejar a medio anular` | `UPDATE` a `estado='anulada'` sin `motivo_anulacion` → viola `chk_ventas_anulacion_completa`. |
| `el número de operación es único por tenant` | Dos ventas del mismo tenant con `numero_operacion = 1` → falla. El mismo número en otro tenant → funciona. |
| `RN-SC2: una venta de A no puede colgar de una sesión de caja de B` | FK compuesta, `23503`. |
| `RN-SC2: una línea de A no puede referenciar un servicio de B` | Ídem. |

**En `rls.test.ts`:** B no ve `ventas`, `ventas_items` ni `ventas_pagos` de A; A con
`view_sales` sí ve las suyas; B no puede escribirlas por PostgREST.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-VT3 | Línea de producto o de servicio, nunca las dos ni ninguna. → `422 INVALID_ITEM_TYPE` | `it('RN-VT3: una línea es de producto o de servicio, nunca las dos', …)` |
| RN-SC2 | FK compuesta cross-tenant sobre las tablas nuevas. | Dos `it('RN-SC2: …')` más |
| RN-SC4 | Aislamiento por RLS de las cuatro tablas nuevas. **Bloqueante.** | Cuatro `it('RN-SC4: …')` más |

## 4. Orden de trabajo

1. Migración con marca, aplicada.
2. Tests. **Verificá el CHECK de RN-VT3 por mutación**: sacalo, confirmá que el test se pone
   rojo en los tres casos inválidos, volvé a ponerlo. Reportá el mensaje.
3. `rls.test.ts` extendido.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. Las cuatro tablas y sus constraints
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('ventas','ventas_items','ventas_pagos','contadores_tenant');"

# 2. ventas_items NO tiene lote_id
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='ventas_items' AND column_name='lote_id';"
# → CERO FILAS. Si aparece, se rompió la decisión de §4.7 y hay que sacarla.

# 3. contadores_tenant NO es una sequence
psql "$DATABASE_URL" -c "SELECT sequencename FROM pg_sequences
  WHERE schemaname='public' AND sequencename ILIKE '%venta%';"
# → cero filas. El correlativo va por fila bloqueada, no por sequence.

# 4. servicios tiene precio y alicuota_iva
psql "$DATABASE_URL" -c "SELECT column_name, is_nullable, column_default
  FROM information_schema.columns WHERE table_name='servicios'
  AND column_name IN ('precio','alicuota_iva');"
# → precio nullable; alicuota_iva NOT NULL default 21.00

# 5. Las FKs diferidas de C2·T1 quedaron cerradas
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE contype='f'
  AND conname IN ('movimientos_stock_venta_item_tenant_fkey',
                  'movimientos_stock_compra_item_tenant_fkey',
                  'movimientos_caja_venta_tenant_fkey');"
# → las tres. Solo queda pendiente la de recuento_id, que es de C5·T1.

# 6. Los seis UNIQUE (id, tenant_id) de la resolución 0.3 están completos
psql "$DATABASE_URL" -c "SELECT conrelid::regclass FROM pg_constraint
  WHERE contype='u' AND conname LIKE '%_id_tenant_key'
  AND conrelid::regclass::text IN
  ('clientes','mascotas','historial_clinico','plan_vacunacion','servicios');"
# → las cinco

# 7. Tests
npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts tests/integration/rls.test.ts
# → "N passed", "0 skipped"

# 8. Suites completas
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
`````

**C4·T2** — Cuando C4·T1 está en verde. · **Gemini Flash** · Entrega: el RPC `registrar_venta`. **Es el RPC central del módulo y el que más fácil se hace mal.**

`````markdown
# ETAPA C4 · TANDA 2/5 — RPC `registrar_venta`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T1 en verde, con `ventas.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es el RPC central del módulo y el que más fácil se hace mal.** Tres cosas van a estar
> tentadoras y las tres están prohibidas: calcular el IVA neto e IVA por separado (R-04),
> descontar existencia desde el Service (R-01), y bloquear los lotes en el orden en que
> aparecen en la venta en vez de por `lote_id` (deadlock).

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.1 | **El esqueleto de `registrar_venta`, paso por paso.** Copialo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1 | La regla de redondeo del IVA, con su fórmula. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-05 | FEFO con override motivado y la prohibición de despachar vencido. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6, §6.7 | RN-VT1, VT2, VT6, VT7, VT8, RN-CJ1. |
| `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql` | Tu propio RPC de C2·T3: la forma del bucle, la auditoría interna, el `REVOKE`/`GRANT`/`NOTIFY`. |
| `supabase/migrations/20260629000001_crear_estadia_con_cupo_rpc.sql` | El `FOR UPDATE` como mutex y su doc-comment. |
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

1. `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | RN-VT6, VT8, RN-LO6, RN-PR9, PR10, y el caso de stock mínimo. |
| `tests/unit/ventas.service.test.ts` | **Crealo**: RN-VT1, VT2, VT7, RN-CJ1 — la aritmética del IVA se prueba en unit, sin base. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas RN. |

## 2. Especificación exacta

### 2.1. Firma

```sql
registrar_venta(
  p_tenant_id      UUID,
  p_usuario_id     UUID,
  p_sesion_caja_id UUID,
  p_cliente_id     UUID,      -- NULL = venta de mostrador anónima
  p_condicion_pago condicion_pago_venta,
  p_items          JSONB,     -- [{tipoItem, productoId, servicioId, cantidad, precioUnitario,
                              --   descuentoPorcentaje, loteId, motivoFefo, mascotaId}]
  p_pagos          JSONB,     -- [{medioPagoId, importe, referencia}]
  p_descuento      NUMERIC DEFAULT 0,
  p_observaciones  TEXT DEFAULT NULL
)
RETURNS TABLE (venta_id UUID, numero_operacion BIGINT, operacion_id UUID,
               subtotal_neto NUMERIC, total_iva NUMERIC, total NUMERIC,
               saldo_pendiente NUMERIC)
```

### 2.2. Cuerpo, en este orden exacto

```
BEGIN
  v_operacion := gen_random_uuid();

  -- ── 1. Validaciones SIN bloqueo ──────────────────────────────────────────
  -- RN-VT8: toda venta pertenece a una sesión ABIERTA, aunque no mueva efectivo.
  SELECT estado INTO v_estado_sesion FROM sesiones_caja
   WHERE id = p_sesion_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;
  IF v_estado_sesion <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;

  -- RN-VT7: una venta sin ítems no existe.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0
     THEN RAISE EXCEPTION 'SALE_WITHOUT_ITEMS'; END IF;

  -- El cliente, si viene, es de este tenant. Un cliente_id de otra clínica entra
  -- sin que la base diga nada hasta el INSERT: se resuelve acá.
  IF p_cliente_id IS NOT NULL THEN
    SELECT condicion_fiscal, dni_cuit INTO v_cond_fiscal, v_documento
      FROM clientes WHERE id = p_cliente_id AND tenant_id = p_tenant_id AND deleted = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;

  -- ── 2. Ítems: validación, IVA y asignación FEFO ──────────────────────────
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(...) LOOP

    IF v_item.tipoItem = 'producto' THEN
      SELECT activo, es_vendible, precio_venta, alicuota_iva, nombre,
             unidad_medida_id, controla_lote
        INTO v_prod
        FROM productos WHERE id = v_item.productoId AND tenant_id = p_tenant_id;

      IF NOT FOUND              THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND';     END IF;
      IF NOT v_prod.activo      THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';      END IF;  -- RN-PR3
      IF NOT v_prod.es_vendible THEN RAISE EXCEPTION 'PRODUCT_NOT_SELLABLE';  END IF;  -- RN-PR10
      IF v_prod.precio_venta IS NULL AND v_item.precioUnitario IS NULL
                                THEN RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE'; END IF;  -- RN-PR9

      -- RN-PR6: la cantidad respeta los decimales de la unidad.
      IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
         THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

      -- RN-LO5: candidatos FEFO. MISMO criterio que stock.service.ts:
      -- fecha_vencimiento ASC con NULLS LAST, luego fecha_ingreso, luego id.
      -- RN-LO4: los vencidos NO entran, y no hay override. RN-LO7: los
      -- bloqueados tampoco.
      --
      -- RN-LO6: si el usuario forzó un lote distinto del sugerido, exige motivo
      -- y el movimiento va a guardar fefo_respetado = false.
      IF v_item.loteId IS NOT NULL AND v_item.loteId <> v_lote_sugerido THEN
        IF v_item.motivoFefo IS NULL OR length(trim(v_item.motivoFefo)) < 10
           THEN RAISE EXCEPTION 'FEFO_OVERRIDE_WITHOUT_REASON'; END IF;
        v_fefo_ok := false;
      ELSE
        v_fefo_ok := true;
      END IF;

    ELSE  -- servicio
      SELECT activo, precio, alicuota_iva, nombre INTO v_svc
        FROM servicios WHERE id = v_item.servicioId AND tenant_id = p_tenant_id;
      IF NOT FOUND         THEN RAISE EXCEPTION 'SERVICE_NOT_FOUND';   END IF;
      IF NOT v_svc.activo  THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';    END IF;
      IF v_svc.precio IS NULL AND v_item.precioUnitario IS NULL
                           THEN RAISE EXCEPTION 'PRODUCT_WITHOUT_PRICE'; END IF;
    END IF;

    -- ── IVA POR DIFERENCIA. NO calcules neto e IVA por separado. ──────────
    -- El precio que llega es el FINAL, con IVA incluido.
    v_precio  := COALESCE(v_item.precioUnitario, v_prod.precio_venta, v_svc.precio);
    v_alicuota := COALESCE(v_prod.alicuota_iva, v_svc.alicuota_iva);
    v_neto_u  := round(v_precio / (1 + v_alicuota / 100), 2);
    v_iva_u   := v_precio - v_neto_u;              -- POR DIFERENCIA. SIEMPRE.
    v_importe := round(v_precio * v_item.cantidad * (1 - v_item.descuentoPorcentaje/100), 2);

    v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, <los lotes asignados>);
  END LOOP;

  -- ── 3. BLOQUEO. TODOS los lotes en UN SOLO SELECT, ORDENADOS POR lote_id ──
  -- Esto no es un detalle de estilo. Dos ventas simultáneas que toquen los lotes
  -- A y B en orden inverso se bloquean mutuamente y una muere por deadlock.
  -- Ordenar SIEMPRE por la misma clave lo elimina. Es la línea que se olvida.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_a_bloquear)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── 4. Validaciones SOBRE EL VALOR YA BLOQUEADO ──────────────────────────
  -- RN-MV5: existencia suficiente POR LOTE. Esta validación va DESPUÉS del
  -- bloqueo, no antes: leer antes de bloquear es exactamente la ventana por la
  -- que dos ventas de la última unidad pasan las dos.
  --   existencia insuficiente -> INSUFFICIENT_STOCK
  --   lote vencido            -> BATCH_EXPIRED
  --   lote bloqueado          -> BATCH_BLOCKED

  -- ── 5. Numeración: contador del tenant, bloqueado ─────────────────────────
  INSERT INTO contadores_tenant (tenant_id, nombre, valor) VALUES (p_tenant_id, 'venta', 0)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  UPDATE contadores_tenant SET valor = valor + 1
   WHERE tenant_id = p_tenant_id AND nombre = 'venta'
  RETURNING valor INTO v_numero;

  -- ── 6. Escrituras ─────────────────────────────────────────────────────────
  -- RN-VT2: el total es la SUMA DE LOS IMPORTES DE LÍNEA YA REDONDEADOS.
  -- Nunca un recálculo desde los netos.
  INSERT INTO ventas (..., numero_operacion = v_numero,
                      condicion_fiscal_snapshot = v_cond_fiscal,   -- RN-VT6
                      documento_snapshot        = v_documento);

  -- RN-VT6: descripcion_snapshot, precio_unitario y alicuota_iva se CONGELAN.
  -- Cambios posteriores del catálogo no alteran ventas registradas.
  INSERT INTO ventas_items (...);

  -- N movimientos por línea, uno por lote asignado. Todos con el mismo
  -- operacion_id y con fefo_respetado / motivo.
  INSERT INTO movimientos_stock (tipo = 'salida_venta', venta_item_id = ..., ...);

  -- costo_unitario_efectivo de la línea: promedio ponderado de los movimientos
  -- que la resolvieron. Se GUARDA (RN-MV6), no se recalcula después.
  UPDATE ventas_items SET costo_unitario_efectivo = ...;

  INSERT INTO ventas_pagos (...);

  -- RN-CJ1: SUM(pagos) + saldo_pendiente = total, AL CENTAVO.
  IF round(v_suma_pagos + v_saldo_pendiente, 2) <> round(v_total, 2)
     THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;

  -- saldo_pendiente > 0 solo si la condición de pago lo admite.
  IF v_saldo_pendiente > 0 AND p_condicion_pago = 'contado'
     THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;

  -- RN-CJ9: referencia obligatoria según el medio.
  -- Un movimiento de caja POR CADA PAGO, incluidos los que no afectan arqueo:
  -- hacen falta para el total vendido. Solo el efectivo entra al arqueo, y eso
  -- lo resuelve cerrar_sesion_caja filtrando por afecta_arqueo.
  INSERT INTO movimientos_caja (tipo = 'ingreso_venta', ...);

  -- ── 6b. Alerta de stock mínimo, POR FLANCO ────────────────────────────────
  -- Se crea al cruzar el mínimo HACIA ABAJO y se ELIMINA al cruzarlo hacia
  -- arriba, de modo que el UNIQUE (tenant_id, origen, referencia_id, canal) de
  -- `notificaciones` deje de bloquear y el próximo faltante vuelva a avisar.
  -- Con referencia_id = producto_id y sin el borrado, el segundo faltante NO
  -- avisaría NUNCA. Se evalúa acá, después de los movimientos, no por tarea
  -- programada: así la alerta llega cuando pasa y no al día siguiente.
  --   existencia total del producto < stock_minimo -> INSERT ... ON CONFLICT DO NOTHING
  --   existencia total >= stock_minimo             -> DELETE de la notificación

  -- ── 7. Auditoría, misma transacción ───────────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'CREATE', 'sales', v_venta_id::text, ...);

  RETURN QUERY SELECT ...;
END;
```

**Cada lectura y cada escritura filtra por `p_tenant_id`**, salvo la de `medios_pago`, que es
catálogo global. Contá los `WHERE` y verificalo.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.3. Tests unitarios de la aritmética — `tests/unit/ventas.service.test.ts`

**La descomposición del IVA se prueba en unit, sin base.** Extraé la fórmula a una función pura
exportada desde `ventas.service.ts` (que se escribe en C4·T4; adelantá **solo esa función** acá,
en un archivo `supabase/functions/api/src/modules/ventas/ventas.calculo.ts`) y probala:

```ts
export function descomponerLinea(precioUnitario: number, alicuota: number, cantidad: number) {
  const netoUnitario = redondear2(precioUnitario / (1 + alicuota / 100));
  const ivaUnitario  = redondear2(precioUnitario - netoUnitario);  // POR DIFERENCIA
  const importeTotal = redondear2(precioUnitario * cantidad);
  return { netoUnitario, ivaUnitario, importeTotal };
}
```

| `it()` | Caso |
|---|---|
| `RN-VT1: el IVA se calcula por diferencia y neto + iva = precio` | $1.000 al 21 % → neto **826,45**, IVA **173,55**. Tres líneas así → total exacto **3.000,00**. |
| `RN-VT1: barrido de precios verificando la identidad` | Para cada precio de **$0,01 a $10.000 en pasos de $0,01** y cada alícuota de `[0, 10.5, 21, 27]`: `neto + iva === precio`, exacto. Sin excepciones, sin tolerancia de centavo. Si el barrido completo tarda demasiado, usá pasos de $0,01 hasta $100 y después de $0,13 hasta $10.000 — pero **no bajes de 100.000 combinaciones probadas**. |
| `RN-VT2: el total es la suma de las líneas redondeadas` | Cinco líneas con alícuotas mixtas (0, 10.5, 21, 27, 21) → `total === suma de importe_total`, al centavo. **Y comprobá que NO coincide** con el recálculo desde los netos en al menos un caso: eso es lo que prueba que la regla importa. |
| `RN-VT7: una venta sin ítems no existe` | Arreglo vacío → `SALE_WITHOUT_ITEMS`. |
| `RN-CJ1: los pagos cubren el total` | $1.000 con pagos por $900 al contado → `PAYMENT_MISMATCH`. $600 efectivo + $400 transferencia → OK. $900 en cuenta corriente con `condicion_pago='cuenta_corriente'` → OK, `saldo_pendiente = 100`. |

### 2.4. Tests de integración

| `it()` | Caso |
|---|---|
| `RN-VT8: sin sesión de caja abierta, la venta falla` | Sin sesión → `CASH_SESSION_REQUIRED`. Con sesión **cerrada** → también. |
| `RN-VT6: la línea congela descripción, precio y alícuota` | Vender; después renombrar el producto **y** cambiarle la alícuota de 21 a 10,5; releer la línea → conserva los tres valores viejos. |
| `RN-LO6: el override de FEFO exige motivo` | Con dos lotes (uno vence antes), forzar el segundo **sin** motivo → `FEFO_OVERRIDE_WITHOUT_REASON`. Con motivo → funciona, y el movimiento queda con `fefo_respetado = false` y el texto en `motivo`. Vender sin forzar → `fefo_respetado = true` y sale del lote que vence primero. |
| `RN-LO4: un lote vencido no se vende, ni siendo admin` | Único lote disponible vencido → `BATCH_EXPIRED`, con el JWT de admin. |
| `RN-PR9 y RN-PR10 contra una venta real` | Producto sin `precio_venta` → `PRODUCT_WITHOUT_PRICE`. Producto con `es_vendible = false` → `PRODUCT_NOT_SELLABLE`. **Cierra lo que C1·T4 dejó probado solo con mocks.** |
| `la venta genera un movimiento de caja por CADA pago` | Pago mixto de 2 medios → 2 filas en `movimientos_caja`, las dos con `venta_id`. |
| `la alerta de stock mínimo es por flanco` | Producto con `stock_minimo = 10` y existencia 12. Vender 5 → existencia 7, **una** notificación `stock_minimo`. Vender 1 más → existencia 6, **sigue habiendo una** (el `UNIQUE` la absorbe). Comprar 10 → existencia 16, la notificación **se borró**. Vender 8 → existencia 8, **vuelve a haber una**. Los cuatro pasos, en orden: es el único test que prueba que la alerta es por flanco y no por nivel. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-VT1 | IVA por línea, calculado por diferencia; `neto + iva = precio` siempre. | `it('RN-VT1: el IVA se calcula por diferencia y neto + iva = precio', …)` |
| RN-VT2 | El total es la suma de las líneas redondeadas, nunca un recálculo. | `it('RN-VT2: el total es la suma de las líneas redondeadas', …)` |
| RN-VT6 | Snapshot de la línea: descripción, precio y alícuota se congelan. | `it('RN-VT6: la línea congela descripción, precio y alícuota', …)` |
| RN-VT7 | Una venta sin ítems no existe. → `422 SALE_WITHOUT_ITEMS` | `it('RN-VT7: una venta sin ítems no existe', …)` |
| RN-VT8 | Toda venta pertenece a una sesión abierta. → `409 CASH_SESSION_REQUIRED` | `it('RN-VT8: sin sesión de caja abierta, la venta falla', …)` |
| RN-CJ1 | `SUM(pagos) + saldo_pendiente = total`, al centavo. → `422 PAYMENT_MISMATCH` | `it('RN-CJ1: los pagos cubren el total', …)` |
| RN-LO6 | Override de FEFO con motivo obligatorio y `fefo_respetado = false`. → `422 FEFO_OVERRIDE_WITHOUT_REASON` | `it('RN-LO6: el override de FEFO exige motivo', …)` |
| RN-PR9, RN-PR10 | Sin precio no se vende; no vendible no se vende. | Se completan contra una venta real. |

## 4. Orden de trabajo

1. **Escribí `ventas.calculo.ts` y `tests/unit/ventas.service.test.ts` primero.** El barrido de
   RN-VT1 tiene que correr y **fallar** antes de que la función exista. Es la parte más barata
   de verificar y la que más plata cuesta si sale mal.
2. Migración del RPC, con marca y `NOTIFY`, aplicada.
3. Tests de integración en verde.
4. **Verificá RN-VT1 por mutación:** cambiá `v_iva_u := v_precio - v_neto_u` por
   `v_iva_u := round(v_precio * v_alicuota / (100 + v_alicuota), 2)` —que es el cálculo
   "por separado", intuitivo y equivocado—, corré el barrido, confirmá que **falla** y anotá
   con qué precio falló. Volvé al original. Reportalo: ese precio es la prueba de que R-04 es
   real y no una precaución teórica.
5. **Verificá el orden del bloqueo por lectura del código**: el `ORDER BY lote_id` tiene que
   estar en el `FOR UPDATE`. Sin él no hay test que lo detecte de forma confiable, así que la
   verificación es visual y va en el reporte.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe, no lo ejecuta anon, y su migración lleva NOTIFY
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='registrar_venta';"
tail -3 supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql

# 2. EL BLOQUEO ESTÁ ORDENADO POR lote_id
grep -n -B4 -A2 "FOR UPDATE" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
# → tiene que aparecer "ORDER BY lote_id" inmediatamente antes del FOR UPDATE.
#   Si no está, hay un deadlock esperando a dos ventas simultáneas.

# 3. El IVA se calcula POR DIFERENCIA
grep -n "iva_u\|iva_unitario" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
# → la línea del IVA tiene que ser una RESTA (v_precio - v_neto_u), no una
#   multiplicación por la alícuota.

# 4. Ningún service lee existencias para decidir
grep -rn 'from("existencias_lote")' supabase/functions/api/src/modules/ | grep -v "select"
# → sin resultados

# 5. El barrido de RN-VT1
npx vitest run tests/unit/ventas.service.test.ts -t "RN-VT1"
# → passed. Reportá cuántas combinaciones probó.

# 6. Integración
npx vitest run --config vitest.integration.config.ts tests/integration/ventas.integration.test.ts
# → "N passed", "0 skipped"

# 7. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C4·T3** — Cuando C4·T2 está en verde con el barrido de RN-VT1 pasando. · **Gemini Flash** · Entrega: el RPC `anular_venta` con contra-asientos.

`````markdown
# ETAPA C4 · TANDA 3/5 — RPC `anular_venta`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T2 en verde, con el barrido de RN-VT1 pasando.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Una venta registrada no se edita: se anula.** Y anular no borra nada — genera
> contra-asientos de existencia y de caja que quedan visibles al lado de los originales. Es el
> mismo criterio que la eutanasia (`CLAUDE.md` regla 8) y que la anulación de compra de C2·T4.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6 | RN-VT4 y RN-VT5 con sus casos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.3 | RN-MV9: nada se borra, se compensa. |
| `supabase/migrations/20260908000005_comercial_anular_compra_rpc.sql` | **Tu propio RPC de C2·T4**: el patrón de contra-asientos, incluida la trampa del CHECK de coherencia documental. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | El RPC que estás compensando. |
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

1. `supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | RN-VT4, VT5, RN-MV9 sobre ventas. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-VT4, VT5. |

## 2. Especificación exacta

```
anular_venta(p_tenant_id UUID, p_usuario_id UUID, p_venta_id UUID, p_motivo TEXT)
RETURNS TABLE (venta_id UUID, operacion_id UUID,
               movimientos_stock_generados INTEGER, movimientos_caja_generados INTEGER)
```

```
BEGIN
  v_operacion := gen_random_uuid();

  SELECT * INTO v_venta FROM ventas
   WHERE id = p_venta_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                      THEN RAISE EXCEPTION 'SALE_NOT_FOUND';     END IF;

  -- RN-VT4: anular dos veces falla.
  IF v_venta.estado = 'anulada'     THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- ── RN-VT5: el egreso va a la sesión ABIERTA ACTUAL, no a la de la venta ──
  -- Una sesión cerrada no se toca: su saldo_teorico_efectivo está congelado
  -- (RN-CJ8) y meterle un movimiento haría que el arqueo de un turno ya cerrado
  -- dejara de cuadrar. La corrección va a la sesión siguiente, con motivo.
  SELECT s.id INTO v_sesion_actual
    FROM sesiones_caja s
   WHERE s.tenant_id = p_tenant_id AND s.estado = 'abierta'
     AND s.caja_id = (SELECT caja_id FROM sesiones_caja
                       WHERE id = v_venta.sesion_caja_id AND tenant_id = p_tenant_id)
   LIMIT 1;

  IF v_sesion_actual IS NULL THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;

  -- ── Contra-asientos de EXISTENCIA ────────────────────────────────────────
  -- RN-MV9: se COMPENSA. Los `salida_venta` originales NO se borran ni se tocan:
  -- quedan en el kárdex con el contra-asiento al lado.
  --
  -- La mercadería vuelve AL LOTE DEL QUE SALIÓ. Por eso el contra-asiento se
  -- construye recorriendo los movimientos originales, y no "buscando un lote
  -- disponible": devolver a otro lote rompería el costo y la trazabilidad.
  --
  -- TRAMPA: el contra-asiento va SIN venta_item_id. El CHECK de coherencia
  -- documental exige que `salida_venta` lo lleve, pero el contra-asiento es
  -- `entrada_devolucion`, que no admite documento. Si lo copiás del original,
  -- el INSERT rebota contra el CHECK.
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  SELECT p_tenant_id, v_operacion, 'entrada_devolucion', m.producto_id, m.lote_id,
         m.cantidad, m.costo_unitario, m.costo_total, p_motivo, p_usuario_id
  FROM movimientos_stock m
  JOIN ventas_items vi ON vi.id = m.venta_item_id AND vi.tenant_id = p_tenant_id
  WHERE m.tenant_id = p_tenant_id
    AND m.tipo = 'salida_venta'
    AND vi.venta_id = p_venta_id;
  GET DIAGNOSTICS v_movs_stock = ROW_COUNT;

  -- ── Contra-asientos de CAJA ──────────────────────────────────────────────
  -- Un egreso por cada pago original, en la sesión ABIERTA, con el mismo medio.
  -- Los pagos que no afectan arqueo también se compensan: hacen falta para que
  -- el total vendido de la sesión cierre.
  INSERT INTO movimientos_caja (tenant_id, sesion_caja_id, tipo, medio_pago_id,
                                importe, venta_id, motivo, usuario_id)
  SELECT p_tenant_id, v_sesion_actual, 'egreso_devolucion', vp.medio_pago_id,
         vp.importe, p_venta_id, p_motivo, p_usuario_id
  FROM ventas_pagos vp
  WHERE vp.tenant_id = p_tenant_id AND vp.venta_id = p_venta_id;
  GET DIAGNOSTICS v_movs_caja = ROW_COUNT;

  -- ── Estado ───────────────────────────────────────────────────────────────
  -- La venta NO se borra: queda visible en el listado, marcada como anulada.
  UPDATE ventas
     SET estado = 'anulada', anulada_at = now(),
         anulada_por_usuario_id = p_usuario_id, motivo_anulacion = p_motivo
   WHERE id = p_venta_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'CANCEL', 'sales', p_venta_id::text,
    jsonb_build_object('motivo', p_motivo, 'sesion_devolucion', v_sesion_actual,
                       'movimientos_stock', v_movs_stock, 'movimientos_caja', v_movs_caja));

  RETURN QUERY SELECT p_venta_id, v_operacion, v_movs_stock, v_movs_caja;
END;
```

**La acción de auditoría es `CANCEL`, no `UPDATE`.** El enum `AuditAction` la tiene y es lo que
hace que la anulación sea filtrable en la pantalla de auditoría.

**No hay `FOR UPDATE` sobre `existencias_lote` acá**, y es correcto: una devolución **suma**
existencia, así que no puede dejar nada en negativo y no compite con nadie por una unidad. El
`FOR UPDATE` sobre `ventas` alcanza para que dos anulaciones simultáneas de la misma venta no
generen contra-asientos dobles: la segunda ve `estado = 'anulada'` y rebota con
`SALE_ALREADY_VOIDED`.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.2. Tests

| `it()` | Caso |
|---|---|
| `RN-VT4: anular devuelve la existencia y deja la venta visible` | Vender 5 de un lote con existencia 20 → existencia 15. Anular con motivo → existencia **20** otra vez. La venta **sigue en el listado**, con `estado = 'anulada'`, `motivo_anulacion` y `anulada_at`. |
| `RN-VT4: anular dos veces falla` | Segunda llamada → `SALE_ALREADY_VOIDED`. |
| `RN-VT4: anular sin motivo falla` | Sin motivo y con `"error"` (5 caracteres) → `REASON_REQUIRED` en los dos. |
| `RN-VT4: la anulación genera el egreso de caja` | Venta con pago mixto (efectivo + transferencia) → anular genera **2** `egreso_devolucion`, uno por medio. |
| `RN-VT5: el egreso va a la sesión abierta, no a la de la venta` | (1) Abrir sesión S1, vender, cerrar S1 con arqueo. (2) Abrir S2. (3) Anular la venta de S1. (4) El `egreso_devolucion` tiene `sesion_caja_id = S2`. (5) **El `saldo_teorico_efectivo` de S1 no cambió.** Los cinco pasos. |
| `RN-VT5: sin sesión abierta no se puede anular` | Con S1 cerrada y ninguna abierta → `CASH_SESSION_REQUIRED`. |
| `RN-MV9: nada se borra, se compensa` | Después de anular una venta de 2 líneas resueltas en 3 lotes: contar `movimientos_stock` de la operación → **6** (3 salidas + 3 entradas), no 0. Los 3 `salida_venta` originales **siguen** con su `venta_item_id`. |
| `la mercadería vuelve al lote del que salió` | Venta resuelta con 3 unidades del lote A y 2 del lote B → tras anular, A recuperó 3 y B recuperó 2. **No 5 en uno solo.** |

**El caso de RN-VT5 con sus cinco pasos es el que más fácil se implementa mal.** Lo natural es
insertar el egreso en `v_venta.sesion_caja_id`, que es la sesión de la venta. Eso funciona
mientras la sesión siga abierta y rompe el arqueo del turno anterior en cuanto no lo esté.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-VT4 | Una venta registrada no se edita: se anula con motivo, con contra-asientos, y queda visible. → `409 SALE_ALREADY_VOIDED` | `it('RN-VT4: anular devuelve la existencia y deja la venta visible', …)` |
| RN-VT5 | La anulación no toca una sesión cerrada: el egreso va a la sesión abierta actual. | `it('RN-VT5: el egreso va a la sesión abierta, no a la de la venta', …)` |
| RN-MV9 | Nada se borra: se compensa con contra-asientos visibles. | `it('RN-MV9: nada se borra, se compensa', …)` — completa lo de C2·T4 sobre ventas |

## 4. Orden de trabajo

1. Tests primero, en rojo por función inexistente.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-VT5 por mutación:** cambiá `v_sesion_actual` por `v_venta.sesion_caja_id`,
   corré el test de los cinco pasos, confirmá que **falla** en el paso 4 o 5, y volvé al
   original. Reportá cuál de los dos falló.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='anular_venta';"

# 2. El contra-asiento NO copia venta_item_id
grep -n -A12 "entrada_devolucion" supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql
# → la lista de columnas del INSERT NO debe incluir venta_item_id

# 3. La sesión del egreso se resuelve, no se copia de la venta
grep -n "sesion_caja_id" supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql
# → el INSERT de movimientos_caja usa v_sesion_actual, NO v_venta.sesion_caja_id

# 4. No existe ninguna función que "desanule" una venta
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desanul%' OR proname ILIKE '%restaurar_venta%';"
# → cero filas

# 5. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ventas.integration.test.ts
# → "N passed", "0 skipped"

# 6. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C4·T4** — Cuando C4·T3 está en verde. · **Gemini Flash** · Entrega: Services, Controllers, rutas y las dos vistas de venta.

`````markdown
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
`````

**C4·T5** — Cuando C4·T4 está en verde. · **Gemini Flash** · Entrega **un solo test**: RN-SC8. Tiene su propia tanda porque sin él la condición de carrera se va a producción.

`````markdown
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
`````

**C5·T1** — Cuando C4 está completa con RN-SC8 pasando 200 repeticiones. · **Gemini Flash** · Entrega: `recuentos`, `recuentos_detalle` y los tests de base.

`````markdown
# ETAPA C5 · TANDA 1/4 — Migración de recuentos y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4 completa y en verde, con RN-SC8 pasando 200 repeticiones.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **C5 va antes que C6, y no es negociable.** D-06.c define que un fraccionamiento mal hecho se
> corrige con un ajuste motivado. Si el fraccionamiento se habilita antes de que exista el
> ajuste, el único camino de corrección no existe y el primer error de carga se va a "arreglar"
> por SQL directo contra producción.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.9, §4.10 | `recuentos`, `recuentos_detalle` y por qué las devoluciones no tienen tabla propia. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-09 | Ajustes, mermas, devoluciones y recuento son tipos del mismo libro mayor. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.9 | RN-AJ1…AJ7. |
| `supabase/migrations/20260922000001_comercial_ventas.sql` | Tu migración de C4·T1: la forma de las FKs compuestas y de los CHECK de completitud. |
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

1. `supabase/migrations/20260929000001_comercial_recuentos.sql`
2. `tests/integration/ajustes.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/rls.test.ts` | Aislamiento de `recuentos` y `recuentos_detalle` (RN-SC4). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Lo que la base hace cumplir de esta tanda. |

## 2. Especificación exacta

### 2.1. `recuentos`

```
id, tenant_id,
fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
estado                  estado_recuento NOT NULL DEFAULT 'borrador',
familia_id              UUID NULL,   -- FK compuesta → familias_producto, ON DELETE RESTRICT
producto_id             UUID NULL,   -- FK compuesta → productos, ON DELETE RESTRICT
usuario_id              UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
aplicado_at             TIMESTAMPTZ NULL,
aplicado_por_usuario_id UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
observaciones           TEXT NULL,
created_at
```

`familia_id` y `producto_id` son el **alcance** del recuento: los dos `NULL` significa "todo el
inventario".

```sql
ALTER TABLE recuentos ADD CONSTRAINT recuentos_id_tenant_key UNIQUE (id, tenant_id);
CREATE INDEX idx_recuentos_tenant ON recuentos (tenant_id, estado, fecha DESC);

-- RN-AJ6: aplicar un recuento es irreversible. El CHECK garantiza que un
-- recuento aplicado tiene su quién y su cuándo: sin eso, "aplicado" es un
-- estado que nadie puede auditar.
ALTER TABLE recuentos ADD CONSTRAINT chk_recuento_aplicado_completo CHECK (
  (estado <> 'aplicado' AND aplicado_at IS NULL AND aplicado_por_usuario_id IS NULL)
  OR
  (estado = 'aplicado'  AND aplicado_at IS NOT NULL AND aplicado_por_usuario_id IS NOT NULL)
);

-- Un solo recuento en borrador por tenant. Dos personas contando en paralelo
-- sobre el mismo inventario producen ajustes que se pisan entre sí.
CREATE UNIQUE INDEX uq_recuento_borrador ON recuentos (tenant_id) WHERE estado = 'borrador';
```

### 2.2. `recuentos_detalle`

```
id, tenant_id,
recuento_id       UUID NOT NULL,  -- FK compuesta → recuentos, ON DELETE CASCADE
lote_id           UUID NOT NULL,  -- FK compuesta → lotes, ON DELETE RESTRICT
cantidad_sistema  NUMERIC(14,3) NULL,   -- NULL mientras el recuento está en borrador
cantidad_contada  NUMERIC(14,3) NOT NULL CHECK (cantidad_contada >= 0),
diferencia        NUMERIC(14,3) NULL,
motivo            TEXT NULL,
created_at
```

- `ALTER TABLE recuentos_detalle ADD CONSTRAINT recuentos_detalle_id_tenant_key UNIQUE (id, tenant_id);`
- `ALTER TABLE recuentos_detalle ADD CONSTRAINT uq_recuento_lote UNIQUE (recuento_id, lote_id);`
- `CREATE INDEX idx_recuentos_detalle ON recuentos_detalle (tenant_id, recuento_id);`
- **`ON DELETE CASCADE` en `recuento_id`**: mismo criterio que `compras_items`. Un detalle de un
  borrador no tiene vida propia. Es el segundo y último CASCADE del módulo.

**`cantidad_sistema` arranca en `NULL` y se completa AL APLICAR, no al crear el borrador.**
Es la sutileza central de RN-AJ3: entre que se empieza a contar y que se aplica se sigue
vendiendo. Si `cantidad_sistema` se congelara al abrir el borrador, se generarían ajustes que
**borran ventas reales**. La columna es nullable justamente para que no haya forma de
completarla antes de tiempo.

### 2.3. La FK diferida de `movimientos_stock`

C2·T1 declaró `recuento_id` sin FK porque la tabla no existía:

```sql
ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_recuento_tenant_fkey
  FOREIGN KEY (recuento_id, tenant_id) REFERENCES recuentos (id, tenant_id)
  ON DELETE RESTRICT;
```

Con esto quedan cerradas **las cuatro** FKs diferidas del libro mayor.

### 2.4. RLS

Las dos tablas, `FOR SELECT` con `tiene_permiso('manage_stock')`. `manage_stock` cubre
"ajustes, mermas, recuento, bloqueo y desbloqueo de lotes" (§8.1) y **solo lo tiene el admin**
(§8.2).

### 2.5. Tests

`tests/integration/ajustes.integration.test.ts` (crealo, reusando el arnés de
`ventas.integration.test.ts`):

| `it()` | Caso |
|---|---|
| `un recuento aplicado no puede quedar sin autor` | `UPDATE` a `estado='aplicado'` con `aplicado_por_usuario_id = NULL` → viola `chk_recuento_aplicado_completo`. |
| `hay un solo recuento en borrador por tenant` | Dos `INSERT` con `estado='borrador'` en el mismo tenant → el segundo falla. Uno en cada tenant → funcionan. Aplicar el primero y crear otro → funciona. |
| `un lote no se cuenta dos veces en el mismo recuento` | Dos detalles con el mismo `(recuento_id, lote_id)` → falla. |
| `la cantidad contada no es negativa` | `cantidad_contada = -1` → viola el CHECK. `= 0` → funciona: contar cero es un resultado válido y frecuente. |
| `RN-SC2: un detalle de A no puede referenciar un lote de B` | FK compuesta, `23503`. |
| `borrar un recuento en borrador se lleva sus detalles` | `DELETE` del recuento → sus detalles se van (CASCADE). Con el recuento **aplicado**, el `DELETE` falla por el `RESTRICT` de `movimientos_stock.recuento_id`. |

**En `rls.test.ts`:** B no ve `recuentos` ni `recuentos_detalle` de A; A con `manage_stock` sí
ve los suyos; B no puede escribirlos por PostgREST.

## 3. RN que cubre esta tanda

Ninguna RN se cierra completa. Esta tanda deja las restricciones que los RPC de T2 y T3 van a
apoyarse. En la matriz, RN-AJ1…AJ7 siguen `PENDIENTE`.

| Lo que sí queda verificado | Dónde |
|---|---|
| RN-AJ6 parcial: la base exige autor y fecha en un recuento aplicado. | `chk_recuento_aplicado_completo` |
| RN-SC2 sobre las tablas nuevas. | `ajustes.integration.test.ts` |
| RN-SC4 sobre las tablas nuevas. **Bloqueante.** | `rls.test.ts` |

## 4. Orden de trabajo

1. Migración con marca, aplicada.
2. Tests. Verificá por mutación el índice `uq_recuento_borrador`: sacalo, confirmá que el test
   se pone rojo, volvé a ponerlo.
3. `rls.test.ts` extendido.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. cantidad_sistema es NULLABLE (es RN-AJ3 escrita en la columna)
psql "$DATABASE_URL" -c "SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name='recuentos_detalle' AND column_name='cantidad_sistema';"
# → is_nullable = YES. Si fuera NOT NULL, alguien la completaría al crear el
#   borrador y RN-AJ3 quedaría rota desde la migración.

# 2. Las CUATRO FKs diferidas del libro mayor están cerradas
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE contype='f'
  AND conrelid='movimientos_stock'::regclass AND conname LIKE '%_tenant_fkey';"
# → incluye venta_item, compra_item, recuento, lote, producto, lote_destino,
#   historial, plan_vacunacion, mascota

# 3. El módulo tiene exactamente DOS CASCADE
psql "$DATABASE_URL" -c "SELECT conrelid::regclass, conname FROM pg_constraint
  WHERE contype='f' AND confdeltype='c'
  AND conrelid::regclass::text IN ('compras_items','recuentos_detalle','ventas_items',
  'ventas_pagos','movimientos_stock','movimientos_caja','lotes','recuentos');"
# → solo compras_items→compras y recuentos_detalle→recuentos

# 4. Tests
npx vitest run --config vitest.integration.config.ts \
  tests/integration/ajustes.integration.test.ts tests/integration/rls.test.ts
# → "N passed", "0 skipped"

# 5. Suites completas
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
`````

**C5·T2** — Cuando C5·T1 está en verde. · **Gemini Flash** · Entrega: `ajustar_existencia`, `bloquear_lote`, `desbloquear_lote` y `registrar_devolucion`.

`````markdown
# ETAPA C5 · TANDA 2/4 — RPCs `ajustar_existencia` y `registrar_devolucion`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5·T1 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Este es el único mecanismo de corrección del módulo.** Nada se borra ni se edita: se
> compensa con un asiento nuevo y motivo. A partir de esta tanda, un error de carga tiene
> arreglo dentro del sistema — y por eso C6 puede existir.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-09 | Ajustes, mermas y devoluciones como tipos del mismo libro mayor. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.10 | La devolución como **operación**, sin tabla nueva. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.9 | RN-AJ1, AJ2, AJ4, AJ5, AJ7 con sus casos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.4 | RN-LO7: el lote bloqueado solo admite ajuste, merma o desbloqueo. |
| `supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql` | Tu RPC de C4·T3: el patrón de contra-asiento y la trampa del CHECK documental. |
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

1. `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ajustes.integration.test.ts` | RN-AJ1, AJ2, AJ4, AJ5, AJ7, RN-LO7. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas seis RN. |

## 2. Especificación exacta

### 2.0. Motivo obligatorio y sustantivo — RN-AJ1, transversal a todo el archivo

**Los ajustes, las mermas, las devoluciones y todo override exigen `motivo` de al menos 10
caracteres.** Un motivo de tres caracteres es no tener motivo. Escribí un helper y usalo en los
tres RPC, en vez de repetir la condición:

```sql
CREATE OR REPLACE FUNCTION public.motivo_valido(p_motivo TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_motivo IS NOT NULL AND length(trim(p_motivo)) >= 10;
$$;

REVOKE ALL ON FUNCTION public.motivo_valido(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.motivo_valido(TEXT) TO service_role;
```

### 2.1. `ajustar_existencia`

```
ajustar_existencia(
  p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID,
  p_tipo tipo_movimiento_stock,   -- entrada_ajuste | salida_ajuste | merma_vencimiento
                                  -- | merma_rotura | entrada_inicial
  p_cantidad NUMERIC, p_motivo TEXT
)
RETURNS TABLE (movimiento_id UUID, operacion_id UUID, existencia_resultante NUMERIC)
```

```
BEGIN
  IF NOT motivo_valido(p_motivo) THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- Solo estos cinco tipos. Un ajuste NO puede fabricar una salida_venta ni una
  -- entrada_compra: esas tienen su propio camino con su documento.
  IF p_tipo NOT IN ('entrada_ajuste','salida_ajuste','merma_vencimiento',
                    'merma_rotura','entrada_inicial')
     THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;

  SELECT l.*, p.unidad_medida_id, p.activo AS producto_activo
    INTO v_lote
    FROM lotes l JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  IF NOT cantidad_valida_para_unidad(p_cantidad, v_lote.unidad_medida_id)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;   -- RN-PR6

  -- ── RN-AJ7: la ÚNICA salida posible de un lote vencido es merma_vencimiento ──
  -- Es el complemento de RN-LO4: el vencido no se despacha, pero sí se da de
  -- baja. Sin esta excepción, la mercadería vencida quedaría en el inventario
  -- para siempre y la valorización mentiría.
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE
     AND p_tipo <> 'merma_vencimiento' AND signo_movimiento(p_tipo) = -1
     THEN RAISE EXCEPTION 'BATCH_EXPIRED'; END IF;

  -- ── RN-LO7: un lote bloqueado admite ajuste y merma, y nada más ─────────────
  -- Que el bloqueado acepte ajustes es deliberado: es lo que permite darlo de
  -- baja. Lo que no acepta es venta, consumo ni fraccionamiento, y eso lo
  -- garantizan los otros RPC al filtrar por estado = 'disponible'.

  -- Bloqueo antes de validar. Igual que en la venta: leer antes de bloquear es
  -- la ventana por la que pasan dos ajustes simultáneos.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id FOR UPDATE;

  -- La existencia no queda negativa. El CHECK de existencias_lote es la última
  -- red; esta validación da el error legible.
  IF signo_movimiento(p_tipo) = -1 AND v_existencia_actual < p_cantidad
     THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

  v_operacion := gen_random_uuid();
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, p_tipo, v_lote.producto_id, p_lote_id,
          p_cantidad, v_lote.costo_unitario_efectivo,
          round(p_cantidad * v_lote.costo_unitario_efectivo, 2), p_motivo, p_usuario_id)
  RETURNING id INTO v_mov_id;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'inventory', v_mov_id::text,
    jsonb_build_object('tipo', p_tipo, 'lote_id', p_lote_id,
                       'cantidad', p_cantidad, 'motivo', p_motivo));

  RETURN QUERY SELECT v_mov_id, v_operacion, <existencia resultante>;
END;
```

**No existe `revertir_ajuste` (RN-AJ2).** Un ajuste mal hecho se corrige con **otro ajuste**,
de signo contrario y con su propio motivo, que queda visible en el historial del lote al lado
del primero. No escribas ningún RPC, endpoint ni permiso de "deshacer ajuste".

### 2.2. `bloquear_lote` y `desbloquear_lote`

```
bloquear_lote(p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID, p_motivo TEXT)
desbloquear_lote(p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID, p_motivo TEXT)
```

Los dos exigen `motivo_valido(p_motivo)`. `bloquear_lote` pone
`estado = 'bloqueado', motivo_bloqueo = p_motivo`; `desbloquear_lote` vuelve a `'disponible'` y
**deja `motivo_bloqueo` como estaba**: es el registro de por qué estuvo bloqueado, y borrarlo
sería perder el dato. Los dos auditan con `module: 'inventory'`.

**No cambian existencia**, así que no bloquean `existencias_lote`. Sí hacen `FOR UPDATE` sobre
la fila de `lotes`, para que dos bloqueos simultáneos no se pisen.

### 2.3. `registrar_devolucion`

**No hay tabla nueva** (§4.10). Una devolución es una **operación** que genera
`entrada_devolucion` al lote original —o a un lote nuevo bloqueado si no es revendible— y, si
se reintegra dinero, un `egreso_devolucion` en la caja.

```
registrar_devolucion(
  p_tenant_id UUID, p_usuario_id UUID, p_venta_id UUID,
  p_items JSONB,          -- [{ventaItemId, cantidad, revendible}]
  p_motivo TEXT,
  p_reintegra_efectivo BOOLEAN DEFAULT true,
  p_sesion_caja_id UUID DEFAULT NULL
)
RETURNS TABLE (operacion_id UUID, movimientos_generados INTEGER, importe_reintegrado NUMERIC)
```

```
BEGIN
  IF NOT motivo_valido(p_motivo) THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_venta FROM ventas
   WHERE id = p_venta_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                   THEN RAISE EXCEPTION 'RETURN_WITHOUT_SALE'; END IF;
  IF v_venta.estado = 'anulada'  THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED';  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(...) LOOP

    SELECT * INTO v_linea FROM ventas_items
     WHERE id = v_item.ventaItemId AND tenant_id = p_tenant_id AND venta_id = p_venta_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_WITHOUT_SALE'; END IF;

    -- ── RN-AJ4: no se devuelve más de lo vendido, ACUMULANDO las devoluciones
    -- previas de la misma venta. Sin la acumulación, devolver 3 y después 3 de
    -- una línea de 5 pasa las dos veces.
    SELECT COALESCE(sum(m.cantidad), 0) INTO v_ya_devuelto
      FROM movimientos_stock m
     WHERE m.tenant_id = p_tenant_id
       AND m.tipo = 'entrada_devolucion'
       AND m.venta_item_id IS NULL
       AND m.motivo IS NOT NULL
       AND m.lote_id IN (SELECT lote_id FROM movimientos_stock
                          WHERE venta_item_id = v_linea.id AND tenant_id = p_tenant_id);
    -- NOTA: si esta acumulación te resulta frágil, agregá una columna
    -- `venta_item_devuelto_id` a movimientos_stock en ESTA migración y usala.
    -- Lo que NO se puede es no acumular.

    IF v_ya_devuelto + v_item.cantidad > v_linea.cantidad
       THEN RAISE EXCEPTION 'RETURN_EXCEEDS_SOLD'; END IF;

    IF v_item.revendible THEN
      -- Vuelve AL LOTE DEL QUE SALIÓ. Devolver a otro lote rompería el costo y
      -- la trazabilidad.
      INSERT INTO movimientos_stock (tipo='entrada_devolucion', lote_id=<el original>, ...);
    ELSE
      -- ── RN-AJ5: lo no revendible entra a un lote BLOQUEADO ──────────────
      -- Con motivo. Un lote bloqueado no aparece entre los candidatos FEFO, así
      -- que la mercadería queda contabilizada y fuera de circulación, que es
      -- exactamente lo que se quiere: existe, vale, y no se vende.
      INSERT INTO lotes (..., estado = 'bloqueado', motivo_bloqueo = p_motivo,
                         origen = 'devolucion', lote_padre_id = <el lote original>,
                         costo_unitario_neto     = <el del original>,
                         costo_unitario_efectivo = <el del original>)
      RETURNING id INTO v_lote_bloqueado;
      INSERT INTO movimientos_stock (tipo='entrada_devolucion', lote_id=v_lote_bloqueado, ...);
    END IF;
  END LOOP;

  -- Reintegro en la sesión ABIERTA, con el mismo criterio de RN-VT5: una sesión
  -- cerrada no se toca.
  IF p_reintegra_efectivo AND v_importe > 0 THEN
    <resolver la sesión abierta; si no hay -> CASH_SESSION_REQUIRED>
    INSERT INTO movimientos_caja (tipo='egreso_devolucion', ...);
  END IF;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'sales', p_venta_id::text, ...);
  RETURN QUERY SELECT v_operacion, v_movs, v_importe;
END;
```

**La devolución audita con `module: 'sales'`**, no `'inventory'`: es un hecho comercial que
tiene una consecuencia de inventario, y quien la busca la busca junto a la venta.

Cierre del archivo: `REVOKE`/`GRANT` para los cuatro RPC + `motivo_valido`, y
`NOTIFY pgrst, 'reload schema';`.

### 2.4. Tests

| `it()` | Caso |
|---|---|
| `RN-AJ1: el motivo es obligatorio y sustantivo` | `ajustar_existencia` sin motivo → `REASON_REQUIRED`. Con `"error"` (5 caracteres) → `REASON_REQUIRED`. Con `"          "` (10 espacios) → `REASON_REQUIRED`, porque el helper hace `trim`. Con `"Rotura en el traslado"` → funciona. **Los cuatro casos.** |
| `RN-AJ1: los tres RPC exigen motivo` | El mismo barrido en `bloquear_lote`, `desbloquear_lote` y `registrar_devolucion`. Un helper puesto en tres de cuatro pasa un test que solo prueba uno. |
| `RN-AJ2: un ajuste no se revierte, se compensa` | (a) `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%revertir%' OR proname ILIKE '%deshacer%'` → **0**. (b) Un ajuste de −5 seguido de otro de +5 con motivo → el kárdex del lote muestra **los dos**, y la existencia volvió al original. |
| `RN-AJ4: una devolución no excede lo vendido` | Vender 5. Devolver 3 → funciona. Devolver 3 otra vez → `RETURN_EXCEEDS_SOLD`. Devolver 2 → funciona. Devolver 1 → falla. |
| `RN-AJ5: lo no revendible entra a un lote bloqueado` | Devolver con `revendible: false` → se creó un lote nuevo con `estado='bloqueado'` y `motivo_bloqueo`, apuntando al original por `lote_padre_id`. **Y ese lote NO aparece entre los candidatos FEFO.** Las dos aserciones. |
| `RN-AJ7: la única salida de un lote vencido es la merma por vencimiento` | Lote vencido: `ajustar_existencia` con `merma_vencimiento` → funciona. Con `salida_ajuste` → `BATCH_EXPIRED`. Con `merma_rotura` → `BATCH_EXPIRED`. Con `entrada_ajuste` → **funciona** (es una entrada, no una salida). |
| `RN-LO7: un lote bloqueado acepta ajuste pero no venta` | Bloquear un lote. `ajustar_existencia` sobre él → funciona. `registrar_venta` de ese lote → `BATCH_BLOCKED`. |
| `desbloquear conserva el motivo del bloqueo` | Después de desbloquear, `motivo_bloqueo` **sigue teniendo el texto**. Es el registro de por qué estuvo bloqueado. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-AJ1 | Motivo obligatorio de al menos 10 caracteres en ajustes, mermas, devoluciones y todo override. → `422 REASON_REQUIRED` | `it('RN-AJ1: el motivo es obligatorio y sustantivo', …)` |
| RN-AJ2 | Un ajuste no se revierte: se compensa, y la compensación queda visible. | `it('RN-AJ2: un ajuste no se revierte, se compensa', …)` |
| RN-AJ4 | Una devolución no excede lo vendido, acumulando las previas. → `422 RETURN_EXCEEDS_SOLD` | `it('RN-AJ4: una devolución no excede lo vendido', …)` |
| RN-AJ5 | La devolución no revendible va a un lote bloqueado, fuera de los candidatos FEFO. | `it('RN-AJ5: lo no revendible entra a un lote bloqueado', …)` |
| RN-AJ7 | La única salida de un lote vencido es `merma_vencimiento`. | `it('RN-AJ7: la única salida de un lote vencido es la merma por vencimiento', …)` |
| RN-LO7 | Un lote bloqueado solo admite ajuste, merma o desbloqueo. → `422 BATCH_BLOCKED` | `it('RN-LO7: un lote bloqueado acepta ajuste pero no venta', …)` — cierra lo de C2·T4 |

## 4. Orden de trabajo

1. Tests primero, en rojo por funciones inexistentes.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-AJ4 por mutación:** sacá la acumulación de devoluciones previas (dejá solo
   `v_item.cantidad > v_linea.cantidad`), corré el caso de "devolver 3 y después 3 de una línea
   de 5", confirmá que **pasa las dos veces** —que es el bug—, y volvé al original.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Los cuatro RPC + motivo_valido existen y ninguno lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname IN ('ajustar_existencia','bloquear_lote','desbloquear_lote',
  'registrar_devolucion','motivo_valido');"
# → cinco filas, todas en f

# 2. NO existe ninguna función de reversión de ajuste
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%revertir%' OR proname ILIKE '%deshacer%'
     OR proname ILIKE '%undo%';"
# → cero filas

# 3. Ningún RPC del módulo acepta un motivo corto
grep -c "motivo_valido" supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql
# → al menos 4 (uno por RPC)

# 4. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ajustes.integration.test.ts
# → "N passed", "0 skipped"

# 5. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C5·T3** — Cuando C5·T2 está en verde. · **Gemini Flash** · Entrega: `aplicar_recuento`, con el congelado al aplicar que evita que los ajustes borren ventas reales.

`````markdown
# ETAPA C5 · TANDA 3/4 — RPC `aplicar_recuento`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5·T2 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **La sutileza de esta tanda es una sola y hay que implementarla bien:** entre que se empieza a
> contar y que se aplica el recuento, **se sigue vendiendo**. Si `cantidad_sistema` se congela
> al abrir el borrador, se generan ajustes que **borran ventas reales**. Se recalcula **al
> aplicar**, y si cambió respecto de lo que vio el usuario, el RPC devuelve una advertencia con
> los lotes que se movieron y exige confirmación explícita.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.9 | La sutileza de `cantidad_sistema`, textual. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.9 | RN-AJ3 y RN-AJ6. |
| `supabase/migrations/20260929000001_comercial_recuentos.sql` | Tu migración de C5·T1: `cantidad_sistema` es nullable a propósito. |
| `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql` | `ajustar_existencia` y `motivo_valido`, que este RPC reusa. |
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

1. `supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ajustes.integration.test.ts` | RN-AJ3 y RN-AJ6. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-AJ3, AJ6 — y con eso, **las 7 RN-AJ cerradas**. |

## 2. Especificación exacta

```
aplicar_recuento(
  p_tenant_id UUID, p_usuario_id UUID, p_recuento_id UUID,
  p_confirmar_desvios BOOLEAN DEFAULT false
)
RETURNS TABLE (recuento_id UUID, operacion_id UUID,
               ajustes_generados INTEGER, lotes_movidos JSONB)
```

```
BEGIN
  SELECT * INTO v_recuento FROM recuentos
   WHERE id = p_recuento_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_NOT_FOUND'; END IF;

  -- RN-AJ6: aplicar un recuento es IRREVERSIBLE. Aplicar dos veces falla.
  IF v_recuento.estado = 'aplicado' THEN RAISE EXCEPTION 'COUNT_ALREADY_APPLIED'; END IF;
  IF v_recuento.estado <> 'borrador' THEN RAISE EXCEPTION 'COUNT_ALREADY_APPLIED'; END IF;

  IF NOT EXISTS (SELECT 1 FROM recuentos_detalle
                  WHERE recuento_id = p_recuento_id AND tenant_id = p_tenant_id)
     THEN RAISE EXCEPTION 'COUNT_WITHOUT_DETAIL'; END IF;

  -- ── BLOQUEO de todos los lotes del recuento, ORDENADO POR lote_id ─────────
  -- Mismo criterio que registrar_venta: el orden fijo elimina el deadlock entre
  -- un recuento y una venta que toquen los mismos lotes.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id
     AND lote_id IN (SELECT lote_id FROM recuentos_detalle
                      WHERE recuento_id = p_recuento_id AND tenant_id = p_tenant_id)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── RN-AJ3: la cantidad de sistema se congela AHORA, no al abrir el borrador ──
  -- Entre que se contó y que se aplica, se siguió vendiendo. Si se hubiera
  -- congelado al abrir, los ajustes que salen de acá BORRARÍAN esas ventas.
  --
  -- `lotes_movidos` son los lotes cuya existencia cambió respecto de lo que el
  -- usuario tenía en pantalla. Se detecta comparando la existencia ACTUAL contra
  -- la que quedó guardada en cantidad_sistema si el borrador ya la tenía (una
  -- pre-carga informativa), o contra la que el cliente mandó al abrir el conteo.
  SELECT jsonb_agg(jsonb_build_object(
           'loteId', d.lote_id,
           'cantidadVistaPorElUsuario', d.cantidad_sistema,
           'cantidadActual', e.cantidad))
    INTO v_lotes_movidos
    FROM recuentos_detalle d
    JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
   WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
     AND d.cantidad_sistema IS NOT NULL
     AND d.cantidad_sistema <> e.cantidad;

  IF v_lotes_movidos IS NOT NULL AND NOT p_confirmar_desvios THEN
    -- El usuario tiene que ver QUÉ se movió antes de decidir. Se devuelven los
    -- lotes en el mensaje, como hace CUPO_GUARDERIA_AGOTADO con los días llenos.
    RAISE EXCEPTION 'COUNT_STALE:%', v_lotes_movidos::text;
  END IF;

  v_operacion := gen_random_uuid();

  -- ── Un ajuste por cada lote con diferencia, EN UNA SOLA OPERACIÓN ─────────
  FOR v_det IN SELECT d.*, e.cantidad AS existencia_actual, l.producto_id,
                      l.costo_unitario_efectivo
                 FROM recuentos_detalle d
                 JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
                 JOIN lotes l            ON l.id = d.lote_id      AND l.tenant_id = p_tenant_id
                WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
                ORDER BY d.lote_id
  LOOP
      -- Se GUARDA la cantidad de sistema del momento de aplicar.
      v_diferencia := v_det.cantidad_contada - v_det.existencia_actual;

      UPDATE recuentos_detalle
         SET cantidad_sistema = v_det.existencia_actual,
             diferencia       = v_diferencia
       WHERE id = v_det.id AND tenant_id = p_tenant_id;

      CONTINUE WHEN v_diferencia = 0;   -- sin diferencia, sin asiento

      -- sobrante_recuento (+) o faltante_recuento (−). Los dos tipos existen en
      -- el ENUM desde C1·T1 justamente para que el recuento no use
      -- entrada_ajuste/salida_ajuste y se pueda reportar aparte.
      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
        costo_unitario, costo_total, motivo, recuento_id, usuario_id
      ) VALUES (
        p_tenant_id, v_operacion,
        CASE WHEN v_diferencia > 0 THEN 'sobrante_recuento' ELSE 'faltante_recuento' END,
        v_det.producto_id, v_det.lote_id, abs(v_diferencia),
        v_det.costo_unitario_efectivo,
        round(abs(v_diferencia) * v_det.costo_unitario_efectivo, 2),
        COALESCE(v_det.motivo, 'Ajuste por recuento físico'),
        p_recuento_id, p_usuario_id
      );
      v_ajustes := v_ajustes + 1;
  END LOOP;

  -- RN-AJ6: irreversible.
  UPDATE recuentos
     SET estado = 'aplicado', aplicado_at = now(), aplicado_por_usuario_id = p_usuario_id
   WHERE id = p_recuento_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'inventory', p_recuento_id::text,
    jsonb_build_object('ajustes', v_ajustes, 'operacion_id', v_operacion));

  RETURN QUERY SELECT p_recuento_id, v_operacion, v_ajustes, v_lotes_movidos;
END;
```

**Los movimientos del recuento llevan `recuento_id`**, y el CHECK de coherencia documental de
C2·T1 exige que **solo** `sobrante_recuento` y `faltante_recuento` lo lleven. Verificá que tu
CHECK lo permite; si lo prohíbe, la migración de C2·T1 tenía el CHECK mal y hay que **frenar y
reportar**, no relajarlo desde acá.

**Los ajustes se generan en UNA operación** (`operacion_id` compartido). Eso es lo que permite
después preguntar "qué cambió el recuento del 30 de septiembre" con una sola consulta.

**El `RAISE EXCEPTION 'COUNT_STALE:%'` lleva el JSON adjunto**, igual que
`CUPO_GUARDERIA_AGOTADO` lleva los días sin cupo. El Service parsea lo que viene después de los
dos puntos y lo pone en `details` del `DomainError`. Es lo que hace que la advertencia sea
accionable en vez de un "algo cambió, fijate".

**No existe `revertir_recuento`.** Un recuento mal aplicado se corrige con ajustes motivados,
igual que todo lo demás.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.2. Tests

| `it()` | Caso |
|---|---|
| `RN-AJ3: el recuento congela la cantidad de sistema AL APLICAR` | (1) Lote con existencia 10. (2) Abrir recuento y cargar detalle con `cantidad_contada = 10` y `cantidad_sistema = 10` (lo que el usuario vio). (3) **Vender 3 del lote** → existencia 7. (4) `aplicar_recuento` sin `p_confirmar_desvios` → falla con `COUNT_STALE`, y el mensaje **contiene el `loteId`** con `cantidadVistaPorElUsuario: 10` y `cantidadActual: 7`. (5) `aplicar_recuento` con `p_confirmar_desvios = true` → funciona, y el ajuste generado es **+3** (10 contados − 7 actuales), **no 0**. (6) La existencia final es **10**, la que se contó. Los seis pasos. |
| `RN-AJ3: sin desvíos no pide confirmación` | Sin ventas entre medio → `aplicar_recuento` sin confirmar funciona directo. |
| `RN-AJ3: el ajuste NO borra la venta` | Después del paso 5, el `salida_venta` de los 3 **sigue en el kárdex**, y hay un `sobrante_recuento` de 3 al lado. La venta no desapareció: el recuento la reconoció. |
| `RN-AJ6: aplicar un recuento es irreversible` | Aplicar dos veces → `COUNT_ALREADY_APPLIED`. Y `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%revertir_recuento%'` → 0. |
| `RN-AJ6: un recuento sin detalle no se aplica` | Recuento en borrador sin filas de detalle → `COUNT_WITHOUT_DETAIL`. |
| `los ajustes del recuento comparten operacion_id` | Recuento con 3 lotes con diferencia → 3 movimientos con el **mismo** `operacion_id` y con `recuento_id` apuntando al recuento. |
| `un lote sin diferencia no genera asiento` | Recuento de 3 lotes donde 1 cuadra → **2** movimientos, no 3. Un asiento de cantidad 0 violaría el `CHECK (cantidad > 0)`. |

**El paso 5 de RN-AJ3 es el que define si esto está bien implementado.** Si `cantidad_sistema`
se hubiera congelado al abrir el borrador, el ajuste sería 0 (10 contados − 10 congelados) y la
venta de 3 quedaría **borrada del inventario**: la existencia terminaría en 7 con el sistema
creyendo que hay 10.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-AJ3 | El recuento congela la cantidad de sistema **al aplicar**; si hubo movimientos, advierte y exige confirmación. → `409 COUNT_STALE` | `it('RN-AJ3: el recuento congela la cantidad de sistema AL APLICAR', …)` |
| RN-AJ6 | Aplicar un recuento es irreversible. → `409 COUNT_ALREADY_APPLIED` | `it('RN-AJ6: aplicar un recuento es irreversible', …)` |

## 4. Orden de trabajo

1. Tests primero, en rojo por función inexistente.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-AJ3 por mutación:** cambiá el RPC para que use la `cantidad_sistema` guardada
   en el borrador en vez de la existencia actual. Corré el test de los seis pasos. **Tiene que
   fallar en el paso 5 o 6**, con la existencia final en 7 en vez de 10. Anotá cuál falló y
   volvé al original.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz: **las 7 RN-AJ tienen que quedar en ✅.**

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='aplicar_recuento';"

# 2. El RPC lee la existencia ACTUAL, no la guardada en el borrador
grep -n "existencia_actual\|e.cantidad" supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql
# → la diferencia se calcula contra existencias_lote, no contra
#   recuentos_detalle.cantidad_sistema

# 3. El bloqueo está ordenado por lote_id
grep -n -B3 "FOR UPDATE" supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql
# → ORDER BY lote_id

# 4. No existe reversión de recuento
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname ILIKE '%recuento%';"
# → solo aplicar_recuento

# 5. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ajustes.integration.test.ts
# → "N passed", "0 skipped"

# 6. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C5·T4** — Cuando C5·T3 está en verde con las 7 RN-AJ en ✅. · **Gemini Flash** · Entrega: Services, Controllers y rutas de ajustes. Cierra C5.

`````markdown
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
`````

**C6·T1** — Cuando C5 está completa. · **Gemini Flash** · Entrega: el RPC `fraccionar_lote`. **La operación central del módulo**, con sus dos errores clásicos cubiertos por test.

`````markdown
# ETAPA C6 · TANDA 1/4 — RPC `fraccionar_lote`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5 completa y en verde, con las 7 RN-AJ en ✅.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es la operación central del módulo, y hay exactamente dos puntos donde se implementa mal:**
>
> 1. **Dividir el costo por el rendimiento teórico en vez de por la cantidad realmente
>    obtenida.** Da un costo prolijo y equivocado, y hace desaparecer el costo de fraccionar.
> 2. **Imputarle costo a la merma.** Parece contable —"se perdió producto, se perdió plata"—
>    y cuenta el mismo peso dos veces, sobrevaluando el inventario.
>
> Los dos tienen su test. Si alguno falla, no lo relajes: está detectando exactamente lo que
> existe para detectar.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.2 | **El esqueleto de `fraccionar_lote`, línea por línea.** Copialo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06, D-06.a, D-06.b, D-06.d | Conversión entre productos, rendimiento real, herencia de costo, decimales por unidad. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.8 | RN-FR1…FR13 con sus casos exactos. |
| `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql` | `motivo_valido`, que este RPC reusa. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | El patrón del `FOR UPDATE` y de la auditoría interna. |
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

1. `supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql`
2. `tests/integration/fraccionamiento.integration.test.ts`
3. `tests/unit/fraccionamiento.service.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR1, FR3, FR5, FR6, FR7, FR8, FR10, FR11, FR13. |

**Esta tanda no crea ninguna tabla.** `lote_padre_id` existe desde C2·T1 (D-13) y
`producto_conversiones` desde C1·T3. Eso es exactamente lo que se planificó: el fraccionamiento
se **implementa** en C6, pero se **decide** en C2.

## 2. Especificación exacta

### 2.1. Firma

```sql
fraccionar_lote(
  p_tenant_id UUID, p_usuario_id UUID,
  p_lote_origen_id UUID, p_producto_destino_id UUID,
  p_cantidad_origen NUMERIC, p_cantidad_obtenida NUMERIC,
  p_fecha_vencimiento_destino DATE, p_codigo_lote_destino TEXT,
  p_motivo TEXT
)
RETURNS TABLE (operacion_id UUID, lote_destino_id UUID,
               cantidad_teorica NUMERIC, cantidad_obtenida NUMERIC,
               desvio_porcentaje NUMERIC, costo_unitario_hijo NUMERIC,
               merma_registrada NUMERIC)
```

### 2.2. Cuerpo

```
BEGIN
  v_operacion := gen_random_uuid();

  -- ── RN-FR1: solo por conversión DEFINIDA y ACTIVA ────────────────────────
  -- No hay fraccionamiento libre entre dos productos cualesquiera.
  SELECT * INTO v_conv FROM producto_conversiones
   WHERE tenant_id = p_tenant_id
     AND producto_origen_id  = (SELECT producto_id FROM lotes
                                 WHERE id = p_lote_origen_id AND tenant_id = p_tenant_id)
     AND producto_destino_id = p_producto_destino_id
     AND activo;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSION_NOT_DEFINED'; END IF;

  SELECT l.*, p.unidad_medida_id AS unidad_origen
    INTO v_lote
    FROM lotes l JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_origen_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  SELECT * INTO v_destino FROM productos
   WHERE id = p_producto_destino_id AND tenant_id = p_tenant_id;
  IF NOT FOUND            THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT v_destino.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';  END IF;

  -- ── RN-FR13: los decimales se validan contra la unidad de CADA producto ──
  -- El origen contra la unidad del origen, el destino contra la del destino.
  -- Fraccionar 0,5 cajas falla si "caja" no admite decimales, AUNQUE el destino
  -- (kg) sí los admita.
  IF NOT cantidad_valida_para_unidad(p_cantidad_origen, v_lote.unidad_origen)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;
  IF NOT cantidad_valida_para_unidad(p_cantidad_obtenida, v_destino.unidad_medida_id)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

  -- ── Bloqueo del lote origen ──────────────────────────────────────────────
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_origen_id
     FOR UPDATE;

  IF v_existencia < p_cantidad_origen THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

  -- RN-LO4: un lote vencido NO se fracciona. No es overrideable.
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE
     THEN RAISE EXCEPTION 'BATCH_EXPIRED'; END IF;
  IF v_lote.estado <> 'disponible' THEN RAISE EXCEPTION 'BATCH_BLOCKED'; END IF;

  -- ── Rendimiento ──────────────────────────────────────────────────────────
  v_teorico := p_cantidad_origen * v_conv.factor_teorico;

  -- RN-FR5: obtener MÁS que el teórico no es rendimiento: es error de carga o
  -- factor mal definido. Se rechaza.
  IF p_cantidad_obtenida <= 0 OR p_cantidad_obtenida > v_teorico
     THEN RAISE EXCEPTION 'INVALID_YIELD'; END IF;

  v_desvio := (v_teorico - p_cantidad_obtenida) / v_teorico * 100;

  -- ── RN-FR6: menos que el teórico es MERMA, no error ──────────────────────
  -- El sistema ADVIERTE si el desvío supera la tolerancia y exige motivo, pero
  -- NO BLOQUEA: el rendimiento real es un hecho, no una infracción. Si el
  -- sistema obligara a que rendimiento = factor, la gente falsearía los
  -- recuentos para cuadrar y el inventario dejaría de significar algo.
  SELECT tolerancia_rendimiento_porcentaje INTO v_tolerancia
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  IF v_desvio > COALESCE(v_tolerancia, 10) AND NOT motivo_valido(p_motivo)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- ── RN-FR10 y RN-FR11: vencimiento del hijo ──────────────────────────────
  -- El contenido no dura más que el envase del que salió.
  IF v_lote.fecha_vencimiento IS NOT NULL
     AND p_fecha_vencimiento_destino IS NOT NULL
     AND p_fecha_vencimiento_destino > v_lote.fecha_vencimiento
     THEN RAISE EXCEPTION 'EXPIRY_AFTER_PARENT'; END IF;

  -- Sugerencia si no vino: LEAST(vencimiento del padre, hoy + vida útil post apertura).
  v_vencimiento := COALESCE(
    p_fecha_vencimiento_destino,
    LEAST(v_lote.fecha_vencimiento,
          CURRENT_DATE + COALESCE(v_destino.vida_util_post_apertura_dias, 36500))
  );

  -- ── RN-FR7: COSTO HEREDADO. Dividido por lo REALMENTE OBTENIDO. ──────────
  --   costo_total_consumido = cantidad_origen × costo_unitario_lote_padre
  --   costo_unitario_hijo   = costo_total_consumido / cantidad_REAL_obtenida
  --
  -- Con rendimiento menor al teórico el costo unitario del hijo SUBE, y está
  -- bien que suba: el kilo suelto efectivamente cuesta más porque para obtenerlo
  -- hubo que perder producto.
  --
  -- ERROR CLÁSICO: dividir por v_teorico. Da un costo prolijo, equivocado, y
  -- hace desaparecer el costo de fraccionar.
  v_costo_consumido := p_cantidad_origen * v_lote.costo_unitario_efectivo;
  v_costo_hijo      := round(v_costo_consumido / p_cantidad_obtenida, 4);

  -- ── Lote hijo ────────────────────────────────────────────────────────────
  INSERT INTO lotes (
    tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
    costo_unitario_neto, costo_unitario_efectivo,
    lote_padre_id,          -- RN-FR4: obligatorio cuando origen = 'conversion'
    origen, proveedor_id, estado, usuario_id
  ) VALUES (
    p_tenant_id, p_producto_destino_id, p_codigo_lote_destino, v_vencimiento, CURRENT_DATE,
    v_costo_hijo, v_costo_hijo,
    p_lote_origen_id,
    'conversion', v_lote.proveedor_id, 'disponible', p_usuario_id
  )
  RETURNING id INTO v_lote_hijo;

  -- ── Los tres movimientos, MISMO operacion_id (RN-FR3) ────────────────────
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total,
                                 lote_destino_id, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, 'salida_conversion', v_lote.producto_id, p_lote_origen_id,
          p_cantidad_origen, v_lote.costo_unitario_efectivo, round(v_costo_consumido, 2),
          v_lote_hijo, p_motivo, p_usuario_id);

  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, 'entrada_conversion', p_producto_destino_id, v_lote_hijo,
          p_cantidad_obtenida, v_costo_hijo,
          round(p_cantidad_obtenida * v_costo_hijo, 2), p_motivo, p_usuario_id);

  -- ── RN-FR8: la merma se registra EN CANTIDAD, con COSTO TOTAL CERO ───────
  -- El costo ya se reasignó ÍNTEGRAMENTE al lote hijo. Si además se le imputara
  -- costo a la merma, el mismo peso se contaría DOS VECES y el inventario
  -- quedaría sobrevaluado. El costo de fraccionar NO se registra como pérdida:
  -- se manifiesta como costo unitario más alto en el hijo.
  --
  -- Se registra SOBRE EL LOTE HIJO y en unidades de DESTINO: es la única forma
  -- de que la resta cierre, y es donde el usuario la ve ("esperaba 15 kg, saqué 14,2").
  IF p_cantidad_obtenida < v_teorico THEN
    INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                   cantidad, costo_unitario, costo_total, motivo, usuario_id)
    VALUES (p_tenant_id, v_operacion, 'merma_fraccionamiento', p_producto_destino_id, v_lote_hijo,
            v_teorico - p_cantidad_obtenida,
            0, 0,                              -- CERO. Los dos.
            p_motivo, p_usuario_id);
  END IF;

  -- ── Auditoría, misma transacción ─────────────────────────────────────────
  INSERT INTO registros_auditoria (..., 'CREATE', 'inventory', v_operacion::text,
    jsonb_build_object('lote_origen', p_lote_origen_id, 'lote_destino', v_lote_hijo,
      'cantidad_origen', p_cantidad_origen, 'cantidad_obtenida', p_cantidad_obtenida,
      'cantidad_teorica', v_teorico, 'desvio_porcentaje', v_desvio,
      'costo_unitario_hijo', v_costo_hijo));

  RETURN QUERY SELECT v_operacion, v_lote_hijo, v_teorico, p_cantidad_obtenida,
                      v_desvio, v_costo_hijo, GREATEST(v_teorico - p_cantidad_obtenida, 0);
END;
```

**La merma va sobre el lote HIJO**, no sobre el padre. El padre ya entregó su cantidad completa
en `salida_conversion`; lo que falta es en unidades de destino y por eso se descuenta del hijo.

**No existe `desfraccionar_lote`. Nunca.** No hay conversión inversa, no hay RPC, no hay
permiso. Un error se corrige con **ajustes motivados** (C5), que quedan visibles como
corrección. Físicamente además es la verdad: la bolsa abierta no se vuelve a cerrar.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.3. Tests unitarios — la aritmética del costo

Extraé el cálculo a `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.calculo.ts`:

```ts
export function costoUnitarioHijo(cantidadOrigen: number, costoPadre: number, cantidadObtenida: number) {
  return redondear4((cantidadOrigen * costoPadre) / cantidadObtenida);
}
export function desvioPorcentaje(teorico: number, obtenido: number) {
  return redondear2(((teorico - obtenido) / teorico) * 100);
}
```

| `it()` | Caso |
|---|---|
| `RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido` | Bolsa de **$45.000**, factor **15**, rendimiento **14,2** → costo del hijo **$3.169,0141/kg**. Asertá el valor exacto. **Y asertá que NO es $3.000,0000**, que es lo que da dividir por el teórico. Los dos `expect`. |
| `RN-FR7: el costo del hijo es MAYOR que el teórico cuando rinde menos` | Barrido de rendimientos de 100 % a 50 % → el costo unitario del hijo crece monótonamente. |
| `RN-FR7: con rendimiento 100 % el costo del hijo es exactamente el teórico` | Factor 15, obtenido 15 → $3.000,0000. Es el caso borde que confirma que la fórmula no introduce un sesgo. |
| `RN-FR11: el vencimiento sugerido es el menor de los dos` | Padre vence 2027-06-01, `vida_util_post_apertura_dias = 30`, hoy 2026-10-06 → sugiere **2026-11-05**. Padre vence 2026-10-20 con vida útil 30 → sugiere **2026-10-20**. |

### 2.4. Tests de integración

| `it()` | Caso |
|---|---|
| `RN-FR1: sin conversión definida no se fracciona` | Sin relación → `CONVERSION_NOT_DEFINED`. Con la relación **desactivada** → también. Los dos casos. |
| `RN-FR3: la operación es atómica` | Provocar el fallo **después** de la salida (por ejemplo, con un producto destino inactivo, que se valida antes; o forzando un vencimiento posterior al del padre) → **no quedó el lote hijo ni ningún movimiento**. Contá filas de `lotes` y `movimientos_stock` antes y después. |
| `RN-FR3: los tres movimientos comparten operacion_id` | Fraccionamiento con merma → **3** movimientos con el mismo `operacion_id`: `salida_conversion`, `entrada_conversion`, `merma_fraccionamiento`. |
| `RN-FR5: la cantidad obtenida no supera la teórica` | Bolsa con factor 15, declarar **15,5 kg** obtenidos → `INVALID_YIELD`. Declarar 15 → funciona. Declarar 0 → `INVALID_YIELD`. |
| `RN-FR6: menos que el teórico es merma, no error` | Factor 15, obtener **14,2** → funciona, y genera un `merma_fraccionamiento` de **0,8**. Con desvío 20 % y tolerancia 10 % **sin motivo** → `REASON_REQUIRED`. Con motivo → funciona. |
| `RN-FR8: la merma de fraccionamiento tiene costo cero` | Después del fraccionamiento: `SUM(costo_total * signo_movimiento(tipo))` de los tres movimientos de la operación → **0,00**. Y el valor total del inventario (`SUM(existencias_lote.cantidad * lotes.costo_unitario_efectivo)`) **es el mismo antes y después**. Las dos aserciones: fraccionar no cambia el valor del inventario. |
| `RN-FR10: el hijo no vence después que el padre` | Padre 2027-03-01, hijo declarado 2027-06-01 → `EXPIRY_AFTER_PARENT`. |
| `RN-FR13: los decimales se validan por producto` | Origen "caja" (`admite_decimales = false`), destino "comprimido": fraccionar **0,5** cajas → `UNIT_NO_DECIMALS`. Fraccionar 1 caja obteniendo 11,5 comprimidos (que tampoco admite decimales) → `UNIT_NO_DECIMALS`. Origen "bolsa" hacia destino "kg" con 1 bolsa → 14,2 kg → **funciona**. |
| `RN-LO4: un lote vencido no se fracciona` | Lote origen vencido → `BATCH_EXPIRED`, incluso con JWT de admin. |
| `el caso real del dueño: bolsa de 15 kg → kilos sueltos` | Bolsa de $45.000 con factor 15, obtener 14,2 kg. Verificar: lote hijo creado con `lote_padre_id`, `origen = 'conversion'`, costo $3.169,0141, existencia del padre bajó 1, existencia del hijo 14,2, merma 0,8 con costo 0. |

**RN-FR8 es el test que atrapa el segundo error clásico.** Si alguien le imputa costo a la
merma, la suma firmada de costos de la operación deja de dar cero y el valor del inventario
sube después de fraccionar, que es imposible físicamente.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR1 | Solo por conversión definida y activa. → `422 CONVERSION_NOT_DEFINED` | `it('RN-FR1: sin conversión definida no se fracciona', …)` |
| RN-FR3 | Operación atómica: salida, alta del hijo, entrada y merma comparten `operacion_id` y transacción. | `it('RN-FR3: la operación es atómica', …)` |
| RN-FR5 | La cantidad obtenida no supera la teórica. → `422 INVALID_YIELD` | `it('RN-FR5: la cantidad obtenida no supera la teórica', …)` |
| RN-FR6 | Menos que el teórico es merma: advierte sobre la tolerancia y exige motivo, pero registra. | `it('RN-FR6: menos que el teórico es merma, no error', …)` |
| RN-FR7 | El costo del hijo se calcula sobre lo **realmente obtenido**. | `it('RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido', …)` |
| RN-FR8 | La merma de fraccionamiento tiene costo **cero**. | `it('RN-FR8: la merma de fraccionamiento tiene costo cero', …)` |
| RN-FR10 | El hijo no vence después que el padre. → `422 EXPIRY_AFTER_PARENT` | `it('RN-FR10: el hijo no vence después que el padre', …)` |
| RN-FR11 | Vencimiento sugerido por vida útil post apertura. | `it('RN-FR11: el vencimiento sugerido es el menor de los dos', …)` |
| RN-FR13 | Decimales por producto: origen contra su unidad, destino contra la suya. → `422 UNIT_NO_DECIMALS` | `it('RN-FR13: los decimales se validan por producto', …)` |

## 4. Orden de trabajo

1. **Escribí `fraccionamiento.calculo.ts` y sus unit tests primero.** RN-FR7 es la regla más
   cara de descubrir tarde y la más barata de probar sin base.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests de integración en verde.
4. **Verificá RN-FR7 por mutación:** cambiá `v_costo_consumido / p_cantidad_obtenida` por
   `v_costo_consumido / v_teorico`, corré el caso real del dueño, confirmá que el costo da
   $3.000,0000 en vez de $3.169,0141 y que el test **falla**. Volvé al original.
5. **Verificá RN-FR8 por mutación:** ponele a la merma
   `costo_unitario = v_costo_hijo, costo_total = round(...)`, corré RN-FR8, confirmá que la
   suma deja de dar cero y que el valor del inventario **sube**. Anotá en cuánto subió. Volvé
   al original.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='fraccionar_lote';"

# 2. NO existe ninguna función inversa
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%'
     OR proname ILIKE '%unir_lote%';"
# → cero filas

# 3. El costo se divide por la cantidad OBTENIDA
grep -n "costo_hijo" supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql
# → la división es por p_cantidad_obtenida, NO por v_teorico

# 4. La merma tiene costo cero
grep -n -A6 "merma_fraccionamiento" supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql
# → costo_unitario y costo_total en 0, los dos

# 5. Fraccionar no cambia el valor del inventario
#    (lo verifica RN-FR8, pero corroboralo a mano en la base de pruebas)

# 6. Tests
npx vitest run tests/unit/fraccionamiento.service.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/fraccionamiento.integration.test.ts
# → "N passed", "0 skipped"

# 7. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
```

**En el reporte, obligatorio:** el costo que dio la mutación de RN-FR7 y cuánto subió el valor
del inventario con la mutación de RN-FR8. Son los dos números que prueban que los tests
detectan los dos errores clásicos y no están pasando por casualidad.
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
`````

**C6·T2** — Cuando C6·T1 está en verde con las dos mutaciones reportadas. · **Gemini Flash** · Entrega: alta de producto derivado desde plantilla y RN-FR9.

`````markdown
# ETAPA C6 · TANDA 2/4 — Producto derivado desde plantilla
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T1 en verde, con las dos verificaciones por mutación reportadas.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **El catálogo crece, y esta tanda es la mitigación.** Cada fraccionamiento necesita un
> producto destino; a los seis meses hay 400 fichas y nadie encuentra nada. Crear el derivado
> desde la plantilla del padre —copiando familia, alícuota, marca y condición de venta, y
> creando la conversión— en **un solo endpoint** es lo que evita que cada derivado se cargue a
> mano con un criterio distinto.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06.e | La explosión del catálogo y sus tres mitigaciones. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06.c y §6.8 RN-FR9 | Por qué no existe des-fraccionar. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | Tu Service de C1·T4: `ProductoService.crear` y `ConversionService.crear`, que este endpoint compone. |
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
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `CrearDerivadoSchema`. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | `ProductoService.crearDerivado`. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | `POST /productos/:id/derivado`. |
| `tests/unit/productos.service.test.ts` | Los casos de `crearDerivado` y RN-FR9. |
| `tests/unit/fraccionamiento.service.test.ts` | RN-FR9 como test estructural. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR9. |

**No se crea ninguna migración ni ningún módulo nuevo.** El derivado es un producto normal: lo
único distinto es de dónde salen sus valores por defecto.

## 2. Especificación exacta

### 2.1. `CrearDerivadoSchema`

```ts
/**
 * Alta de un producto derivado desde la plantilla del padre (D-06.e).
 *
 * Lo que se hereda del padre y NO se pide: familia, alícuota de IVA, marca,
 * condición de venta, `trazable`, `requiere_frio`, `es_consumible_clinico`.
 * Heredarlos es la mitigación: si cada derivado se carga a mano, a los seis
 * meses la mitad del catálogo tiene la alícuota mal.
 *
 * Lo que SÍ se pide, porque el derivado no lo comparte con el padre:
 */
export const CrearDerivadoSchema = z.object({
  codigo:                   z.string().trim().min(1).max(50),
  nombre:                   z.string().trim().min(3).max(150),
  unidadMedidaId:           z.string().uuid(),
  factorTeorico:            z.number().positive(),
  mermaEsperadaPorcentaje:  z.number().min(0).max(100).default(0),
  // El precio NO se deriva del factor: el kilo suelto no vale 1/15 de la bolsa
  // de 15 kg, casi siempre vale más. Un factor impondría una relación aritmética
  // entre precios que el negocio no respeta (D-06).
  precioVenta:              z.number().nonnegative().nullish(),
  vidaUtilPostAperturaDias: z.number().int().min(1).max(3650).nullish(),
  stockMinimo:              z.number().nonnegative().nullish(),
  descripcion:              z.string().max(500).nullish(),
});
```

**El precio del derivado no se calcula.** Si el DTO no lo trae, el producto queda con
`precio_venta = NULL` y no es vendible hasta que alguien le ponga precio (RN-PR9). Es
preferible a inventar un precio dividido por el factor, que es exactamente la relación que D-06
descarta.

### 2.2. `ProductoService.crearDerivado(padreId, dto, ctx)`

```
1. Resolver el padre filtrando por tenant. Si no está o está inactivo:
     PRODUCT_NOT_FOUND / PRODUCT_INACTIVE
2. Verificar que la unidad del derivado EXISTE y es distinta de la del padre.
     Si es la misma → VALIDATION_ERROR: "El derivado tiene que tener una unidad
     distinta de la del producto de origen". Un derivado en la misma unidad no
     es una conversión, es un duplicado.
3. Crear el producto, heredando del padre:
     familia_id, alicuota_iva, marca, condicion_venta,
     controla_lote, controla_vencimiento, trazable, requiere_frio,
     es_consumible_clinico
   y tomando del DTO:
     codigo, nombre, descripcion, unidad_medida_id, precio_venta,
     vida_util_post_apertura_dias, stock_minimo
   con es_vendible = true y activo = true.
4. Crear la conversión padre → derivado con factor_teorico y
   merma_esperada_porcentaje del DTO.
5. Auditar UNA VEZ, con module 'products', action 'CREATE', y en new_values
   tanto el producto como la conversión.
```

**Los pasos 3 y 4 tienen que ser atómicos.** Si el `INSERT` de la conversión falla —por ejemplo
por el trigger anti-ciclo—, el producto **no puede quedar creado**: sería una ficha huérfana que
nadie sabe de dónde salió.

Como los dos `INSERT` van por PostgREST y **no hay transacción entre dos llamadas de
supabase-js**, resolvelo así:

```ts
// El producto se crea primero y la conversión después; si la conversión falla,
// el producto recién creado se da de baja lógica y se relanza el error. NO se
// borra: RN-PR2 dice que un producto no se elimina, y además el DELETE podría
// fallar por una FK y dejar el estado peor.
//
// Es el mismo criterio del "rollback a mano" que usa el alta de usuarios cuando
// falla el INSERT en `usuarios` después de crear la cuenta de Auth.
```

Si al escribirlo te parece que esto pide un RPC, tenés razón — pero **no lo escribas en esta
tanda**: cambiar el alta de productos a un RPC afecta a C1·T4 y sale del alcance. Anotalo en el
reporte como mejora propuesta.

### 2.3. Endpoint

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/v1/productos/:id/derivado` | `manage_products` — 201 |

Errores: `404 PRODUCT_NOT_FOUND`, `422 PRODUCT_INACTIVE`, `409 PRODUCT_CODE_DUPLICATE`,
`409 PRODUCT_NAME_DUPLICATE`, `409 CONVERSION_CYCLE`, `422 VALIDATION_ERROR`.

### 2.4. RN-FR9 — que no exista la conversión inversa

**No es una funcionalidad: es la ausencia de una.** Se prueba de tres formas, y las tres van:

| `it()` | Caso |
|---|---|
| `RN-FR9: no existe ningún RPC de des-fraccionamiento` | En `fraccionamiento.service.test.ts`, un test que consulta las funciones de la base (o, si el test es unit, que revisa las migraciones): ninguna se llama `desfraccionar`, `reagrupar`, `unir_lote` ni similar. |
| `RN-FR9: no existe ninguna ruta que genere una conversión inversa` | Recorré los routers registrados y verificá que no hay ningún endpoint cuyo handler llame a `fraccionar_lote` con origen y destino invertidos, ni ningún `POST` con "desfraccionar" en la ruta. Un `grep` sobre `src/modules/` alcanza y se escribe como test. |
| `RN-FR9: registrar la relación inversa falla por el anti-ciclo` | Con la conversión A→B creada por `crearDerivado`, intentar crear B→A → falla con `CONVERSION_CYCLE`. **Este es el que importa**: aunque alguien escribiera el endpoint, la base no lo dejaría cargar la relación que lo haría posible. |

El tercer caso es la razón por la que el trigger anti-ciclo de C1·T3 vale la pena: RN-FR9 no
depende de que nadie escriba el endpoint, depende de que la base no admita el grafo que lo
habilitaría.

### 2.5. Otros tests

| `it()` | Caso |
|---|---|
| `el derivado hereda familia, alícuota, marca y condición de venta` | Padre con `familia_id = F`, `alicuota_iva = 10.5`, `marca = "X"`, `condicion_venta = 'bajo_receta'` → el derivado sale con los cuatro valores, aunque el DTO no los mande. |
| `el derivado NO hereda el precio` | Padre con `precio_venta = 45000` y DTO sin precio → el derivado queda con `precio_venta = NULL`. El kilo suelto no vale 1/15 de la bolsa. |
| `la conversión se crea con el factor del DTO` | `factorTeorico: 15` → la fila de `producto_conversiones` queda con `15.0000`. |
| `si la conversión falla, el producto queda inactivo` | Mock donde el `INSERT` de la conversión devuelve el error del anti-ciclo → el producto se dio de baja lógica y el error que sale es `CONVERSION_CYCLE`, no `INTERNAL_ERROR`. |
| `un derivado con la misma unidad que el padre se rechaza` | `unidadMedidaId` igual al del padre → `VALIDATION_ERROR`. |
| `RN-SC5: el alta del derivado deja un solo asiento` | `recordAudit` se llamó **una** vez, con `module: "products"`. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR9 | No existe la conversión inversa: ni RPC, ni endpoint, ni permiso, y la relación inversa falla por el anti-ciclo. → `422 CONVERSION_REVERSE_NOT_ALLOWED` | Los tres `it('RN-FR9: …')` de 2.4 |

## 4. Orden de trabajo

1. Tests primero, en rojo.
2. `CrearDerivadoSchema` → `crearDerivado` → el endpoint.
3. Los tres tests de RN-FR9.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. No existe nada que des-fraccione
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%' OR proname ILIKE '%unir_lote%';"
# → cero filas
grep -rniE "desfraccion|reagrupar|des-fraccion" supabase/functions/api/src/modules/
# → sin resultados, salvo comentarios que expliquen por qué no existe

# 2. El derivado no hereda el precio
grep -n -A20 "crearDerivado" supabase/functions/api/src/modules/productos/productos.service.ts | grep -n "precio_venta"
# → precio_venta sale del DTO, NUNCA del padre ni de una división por el factor

# 3. Tests
npx vitest run tests/unit/productos.service.test.ts tests/unit/fraccionamiento.service.test.ts
npm test && npm run typecheck
# → todo passed, 0 skipped
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
`````

**C6·T3** — Cuando C6·T2 está en verde. · **Gemini Flash** · Entrega: `v_costo_fraccionamiento`, `v_stock_familia_unidad_base` y el CTE recursivo de trazabilidad.

`````markdown
# ETAPA C6 · TANDA 3/4 — Vistas de fraccionamiento y cadena de trazabilidad
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T2 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **La vista `v_stock_familia_unidad_base` es la más peligrosa del módulo.** Sirve para
> responder *"¿cuánta amoxicilina tengo en total?"* sumando en la unidad base vía
> `factor_teorico`. **Cualquier uso de ella en un camino de escritura es un bug** (RN-FR12): un
> descuento que atraviese la conversión rompe la trazabilidad de lote y es exactamente el
> modelo que D-06 descartó. Por eso lleva su `COMMENT ON VIEW` diciéndolo.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 | `v_costo_fraccionamiento` y `v_stock_familia_unidad_base` con su advertencia. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06, D-06.a, D-06.b | El multi-nivel gratis y el reporte de costo de fraccionar. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.8 | RN-FR4 y RN-FR12. |
| `supabase/migrations/20260901000004_comercial_catalogo_tenant.sql` | El CTE recursivo del trigger anti-ciclo: el de trazabilidad es el mismo recorrido en la otra dirección. |
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

1. `supabase/migrations/20261006000002_comercial_vistas_fraccionamiento.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/modules/stock/stock.service.ts` | `cadenaTrazabilidad(loteId, ctx)`, con el CTE recursivo. |
| `supabase/functions/api/src/modules/stock/stock.controller.ts` | `GET /lotes/:id/trazabilidad`. |
| `tests/integration/fraccionamiento.integration.test.ts` | RN-FR4 (cadena de tres niveles). |
| `tests/unit/fraccionamiento.service.test.ts` | RN-FR12. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR4, FR12. |

## 2. Especificación exacta

### 2.1. `v_costo_fraccionamiento`

Responde *"cuánto me cuesta fraccionar"*, que es el dato de gestión de D-06.a: si un producto
rinde sistemáticamente 12 % menos, eso tiene que estar en el precio del suelto.

```sql
CREATE OR REPLACE VIEW public.v_costo_fraccionamiento AS
WITH operaciones AS (
  SELECT m.tenant_id, m.operacion_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.producto_id END) AS producto_origen_id,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.producto_id END) AS producto_destino_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.cantidad END)    AS cantidad_origen,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.cantidad END)    AS cantidad_obtenida,
         COALESCE(max(CASE WHEN m.tipo = 'merma_fraccionamiento' THEN m.cantidad END), 0) AS merma,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.costo_total END) AS costo_consumido,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.costo_unitario END) AS costo_unitario_hijo,
         min(m.created_at) AS fraccionado_at
  FROM movimientos_stock m
  WHERE m.tipo IN ('salida_conversion','entrada_conversion','merma_fraccionamiento')
  GROUP BY m.tenant_id, m.operacion_id
)
SELECT o.*,
       po.nombre AS producto_origen_nombre,
       pd.nombre AS producto_destino_nombre,
       pc.factor_teorico,
       o.cantidad_origen * pc.factor_teorico                       AS cantidad_teorica,
       -- El sobrecosto de fraccionar NO es una pérdida registrada: se manifiesta
       -- como costo unitario más alto en el hijo (D-06.b). Este es el número que
       -- lo hace visible.
       CASE WHEN pc.factor_teorico > 0 AND o.cantidad_obtenida > 0
            THEN (o.costo_unitario_hijo
                  - (o.costo_consumido / NULLIF(o.cantidad_origen * pc.factor_teorico, 0)))
                 * o.cantidad_obtenida
       END AS sobrecosto
FROM operaciones o
JOIN productos po ON po.id = o.producto_origen_id  AND po.tenant_id = o.tenant_id
JOIN productos pd ON pd.id = o.producto_destino_id AND pd.tenant_id = o.tenant_id
LEFT JOIN producto_conversiones pc
       ON pc.tenant_id = o.tenant_id
      AND pc.producto_origen_id  = o.producto_origen_id
      AND pc.producto_destino_id = o.producto_destino_id;
```

### 2.2. `v_stock_familia_unidad_base` — con su advertencia

```sql
CREATE OR REPLACE VIEW public.v_stock_familia_unidad_base AS
SELECT f.tenant_id, f.id AS familia_id, f.nombre AS familia_nombre,
       f.unidad_base_id, um.abreviatura AS unidad_base,
       sum(
         e.cantidad * COALESCE(
           -- Si el producto NO es la unidad base de la familia, se convierte
           -- dividiendo por el factor hacia la unidad base. Es una APROXIMACIÓN
           -- de reporte: el factor es teórico y el rendimiento real difiere.
           (SELECT 1 / NULLIF(pc.factor_teorico, 0)
              FROM producto_conversiones pc
             WHERE pc.tenant_id = e.tenant_id
               AND pc.producto_destino_id = e.producto_id
               AND pc.activo
             LIMIT 1),
           1)
       ) AS cantidad_en_unidad_base
FROM existencias_lote e
JOIN productos p         ON p.id = e.producto_id AND p.tenant_id = e.tenant_id
JOIN familias_producto f ON f.id = p.familia_id  AND f.tenant_id = p.tenant_id
JOIN unidades_medida um  ON um.id = f.unidad_base_id
WHERE e.cantidad > 0
GROUP BY f.tenant_id, f.id, f.nombre, f.unidad_base_id, um.abreviatura;

COMMENT ON VIEW public.v_stock_familia_unidad_base IS
  'SOLO REPORTE. Agrega existencias de una familia en su unidad base usando factor_teorico. CUALQUIER USO DE ESTA VISTA EN UN CAMINO DE ESCRITURA ES UN BUG (RN-FR12): descontar atravesando el factor rompe la trazabilidad de lote y es exactamente el modelo que D-06 descartó. Si falta existencia del derivado, el sistema OFRECE FRACCIONAR; no descuenta de la caja.';
```

### 2.3. Cadena de trazabilidad — RN-FR4

**Multi-nivel sale gratis:** caja→blíster es una conversión y blíster→comprimido es otra. No hay
jerarquía de niveles ni columna `nivel`, y la cadena se recorre siguiendo `lote_padre_id` con un
CTE recursivo.

```sql
CREATE OR REPLACE FUNCTION public.cadena_trazabilidad_lote(p_tenant_id UUID, p_lote_id UUID)
RETURNS TABLE (
  lote_id UUID, producto_id UUID, producto_nombre TEXT, codigo_lote TEXT,
  fecha_vencimiento DATE, costo_unitario_efectivo NUMERIC,
  nivel INTEGER, direccion TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- ASCENDENTE: de este lote hacia sus padres.
  WITH RECURSIVE ancestros AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, a.nivel - 1
    FROM lotes l JOIN ancestros a ON a.lote_padre_id = l.id
    WHERE l.tenant_id = p_tenant_id
  ),
  -- DESCENDENTE: de este lote hacia sus hijos.
  descendientes AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, d.nivel + 1
    FROM lotes l JOIN descendientes d ON l.lote_padre_id = d.id
    WHERE l.tenant_id = p_tenant_id
  )
  SELECT x.id, x.producto_id, p.nombre, x.codigo_lote, x.fecha_vencimiento,
         x.costo_unitario_efectivo, x.nivel,
         CASE WHEN x.nivel < 0 THEN 'ancestro'
              WHEN x.nivel > 0 THEN 'derivado'
              ELSE 'origen' END
  FROM (SELECT * FROM ancestros UNION SELECT * FROM descendientes) x
  JOIN productos p ON p.id = x.producto_id AND p.tenant_id = p_tenant_id
  ORDER BY x.nivel;
$$;

REVOKE ALL ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) TO service_role;
```

**El `UNION` (no `UNION ALL`) de la consulta final** deduplica el lote de origen, que aparece en
las dos ramas con `nivel = 0`. **Cada rama recursiva filtra por `p_tenant_id`**: sin eso, un
`lote_padre_id` que apuntara a otro tenant traería sus datos, y aunque la FK compuesta lo
impide, el filtro documenta el alcance y sobrevive al próximo refactor.

Cierre del archivo: `NOTIFY pgrst, 'reload schema';`.

### 2.4. `stock.service.ts` y el endpoint

```ts
/** RN-FR4: la cadena completa de un lote, hacia arriba y hacia abajo. */
async cadenaTrazabilidad(loteId: string, ctx: CallerContext) {
  const db = getServiceDb();
  const { data, error } = await db.rpc("cadena_trazabilidad_lote", {
    p_tenant_id: ctx.tenantId,
    p_lote_id:   loteId,
  });
  …
}
```

`GET /api/v1/lotes/:id/trazabilidad`, con `view_stock`.

### 2.5. Tests

**RN-FR4 en `fraccionamiento.integration.test.ts` — el caso real del dueño, tres niveles:**

| `it()` | Caso |
|---|---|
| `RN-FR4: la cadena recorre los tres niveles caja → blíster → comprimido` | (1) Crear producto "caja de 10 blísters", derivado "blíster" (factor 10) y derivado del blíster "comprimido" (factor 12). (2) Comprar 1 caja. (3) Fraccionar caja → 10 blísters. (4) Fraccionar 1 blíster → 12 comprimidos. (5) `cadena_trazabilidad_lote` desde el lote de comprimidos → **3 filas**, con niveles −2, −1 y 0. (6) Desde el lote de la caja → **3 filas**, con niveles 0, 1 y 2. Los seis pasos. |
| `RN-FR4: todo lote de origen conversión tiene padre` | `SELECT count(*) FROM lotes WHERE tenant_id = A AND origen = 'conversion' AND lote_padre_id IS NULL` → **0**. |
| `la cadena no cruza tenants` | Un lote de B no aparece en la cadena pedida con el tenant de A. |

**RN-FR12 en `fraccionamiento.service.test.ts` — el test que define el módulo:**

| `it()` | Caso |
|---|---|
| `RN-FR12: vender el derivado con existencia 0 falla, aunque haya existencia del padre` | Existencia **0** en "comprimido" y **positiva** en "caja", con la conversión caja→comprimido **activa**. `registrar_venta` de 1 comprimido → **falla con `INSUFFICIENT_STOCK`**. El sistema ofrece fraccionar; **no descuenta de la caja**. |
| `RN-FR12: ningún camino de escritura lee la vista de familia` | Guardrail estático: `grep` sobre `src/modules/` — ningún archivo que contenga `.rpc("registrar_venta"`, `.rpc("fraccionar_lote"`, `.rpc("ajustar_existencia"` o `.rpc("registrar_consumo_clinico"` menciona `v_stock_familia_unidad_base`. Escribilo como test, no como revisión manual. |
| `RN-FR12: ningún camino de escritura multiplica por factor_teorico` | Mismo criterio: ningún `.service.ts` del módulo usa `factor_teorico` fuera de `crearDerivado` y de las lecturas de reporte. |

**El primer caso de RN-FR12 es el que hay que escribir con más cuidado**, porque el fallo que
previene es el más "razonable" de todos: el usuario pide un comprimido, hay cajas, y total es lo
mismo. No es lo mismo: descontar atravesando el factor rompe la trazabilidad de lote y deja el
inventario diciendo que hay 0,916 cajas.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR4 | El hijo guarda su padre y la cadena se recorre en los dos sentidos. | `it('RN-FR4: la cadena recorre los tres niveles caja → blíster → comprimido', …)` |
| RN-FR12 | El factor no descuenta existencia. **Nunca.** Se usa exclusivamente para reportes. → `409 INSUFFICIENT_STOCK` | Los tres `it('RN-FR12: …')` de 2.5 |

## 4. Orden de trabajo

1. Tests primero, en rojo.
2. Migración con marca y `NOTIFY`, aplicada.
3. `cadenaTrazabilidad` y el endpoint.
4. Los tres tests de RN-FR12.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Las dos vistas existen y la peligrosa tiene su COMMENT
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_stock_familia_unidad_base'::regclass,'pg_class');"
# → el texto tiene que decir "SOLO REPORTE" y "ES UN BUG"

# 2. Ningún camino de escritura menciona la vista de familia
grep -rn "v_stock_familia_unidad_base" supabase/functions/api/src/modules/
# → solo en el service/controller de REPORTES, nunca junto a un .rpc() de escritura

# 3. Ningún lote de conversión quedó sin padre
psql "$DATABASE_URL" -c "SELECT count(*) FROM lotes
  WHERE origen='conversion' AND lote_padre_id IS NULL;"
# → 0

# 4. La función de trazabilidad no la ejecuta anon
psql "$DATABASE_URL" -c "SELECT has_function_privilege('anon',
  'public.cadena_trazabilidad_lote(uuid,uuid)', 'EXECUTE');"
# → f

# 5. Tests
npx vitest run tests/unit/fraccionamiento.service.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/fraccionamiento.integration.test.ts
# → "N passed", "0 skipped"

# 6. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C6·T4** — Cuando C6·T3 está en verde. · **Gemini Flash** · Entrega: Service, Controller, rutas y el cierre de la matriz de C1–C6.

`````markdown
# ETAPA C6 · TANDA 4/4 — Service, Controller y cierre de la matriz
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T3 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Última tanda del alcance planificado (C1–C6).** Al terminarla, corré el prompt de auditoría
> `C6_AUDITORIA.md`. Las 85 RN del alcance tienen que quedar en ✅; las 5 de consumo clínico
> (RN-CC1…CC5) siguen en `N/A` hasta que se planifique C7.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/ajustes/ajustes.service.ts` | Tu Service de C5·T4: el mapper de errores de RPC y la forma de componer. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | El patrón de permisos por método. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §8.1, §8.2 | `split_stock` es un permiso **propio**: no se deduce de `manage_stock`. |
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

1. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.schemas.ts`
2. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.service.ts`
3. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts`
4. `tests/unit/fraccionamiento.controller.test.ts`

`fraccionamiento.calculo.ts` ya existe desde C6·T1. **No lo reescribas**: importalo.

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/fraccionamientos", fraccionamientoRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"fraccionamiento"` a `MODULOS_COMERCIALES`. |
| `tests/unit/fraccionamiento.service.test.ts` | Los casos del Service. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **El cierre de C1–C6.** |

## 2. Especificación exacta

### 2.1. `fraccionamiento.schemas.ts`

```ts
export const FraccionarSchema = z.object({
  loteOrigenId:              z.string().uuid(),
  productoDestinoId:         z.string().uuid(),
  cantidadOrigen:            z.number().positive(),
  // La cantidad REALMENTE obtenida, no la teórica. Es entrada del usuario y es
  // el dato que hace que el inventario signifique algo: si el sistema obligara
  // a que rendimiento = factor, la gente falsearía los recuentos para cuadrar
  // (D-06.a).
  cantidadObtenida:          z.number().positive(),
  fechaVencimientoDestino:   z.string().date().nullish(),
  codigoLoteDestino:         z.string().trim().max(80).nullish(),
  // Obligatorio solo si el desvío supera la tolerancia del tenant; eso lo decide
  // el RPC, que es quien conoce la tolerancia. Acá se acepta opcional y se valida
  // la longitud SI viene.
  motivo:                    z.string().trim().min(10).max(500).nullish(),
});

export const ListarFraccionamientosQuerySchema = z.object({
  productoOrigenId:  z.string().uuid().optional(),
  productoDestinoId: z.string().uuid().optional(),
  desde:  z.string().date().optional(),
  hasta:  z.string().date().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});
```

### 2.2. `fraccionamiento.service.ts`

| Método | Qué hace |
|---|---|
| `fraccionar(dto, ctx)` | Llama a `fraccionar_lote`. **No calcula nada**: el rendimiento, el costo y la merma los resuelve el RPC bajo bloqueo. |
| `simular(dto, ctx)` | **Solo lectura, sin escribir nada.** Dado el lote origen, el producto destino y la cantidad de origen, devuelve la cantidad teórica, el vencimiento sugerido y el costo unitario que tendría el hijo con la cantidad obtenida propuesta. Usa `fraccionamiento.calculo.ts`, no el RPC. Es lo que alimenta la pantalla antes de confirmar. |
| `listar(opts, ctx)` | Desde `v_costo_fraccionamiento`, paginado. |
| `costoPorProducto(opts, ctx)` | Merma acumulada y sobrecosto por producto origen, desde `v_costo_fraccionamiento`. |

**`simular` no escribe y no reserva.** Entre la simulación y la confirmación la existencia puede
cambiar, y quien decide es el RPC bajo `FOR UPDATE`. Dejá este comentario:

```ts
// `simular` es informativa: NO reserva existencia y NO garantiza que el
// fraccionamiento vaya a proceder. Entre la simulación y la confirmación puede
// entrar una venta que consuma el lote. La decisión la toma fraccionar_lote,
// bajo bloqueo. Si esta función validara existencia y el RPC confiara en eso,
// sería exactamente el patrón leer-validar-escribir que R-01 describe.
```

`mapFraccionamientoRpcError` cubriendo `CONVERSION_NOT_DEFINED`, `CONVERSION_CYCLE`,
`INVALID_YIELD`, `EXPIRY_AFTER_PARENT`, `REASON_REQUIRED`, `UNIT_NO_DECIMALS`,
`INSUFFICIENT_STOCK`, `BATCH_EXPIRED`, `BATCH_BLOCKED`, `BATCH_NOT_FOUND`,
`PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`. `INTERNAL_ERROR` genérico al final.

**No hay ningún método que revierta un fraccionamiento.** Si te sale escribir `desfraccionar`,
`revertirFraccionamiento` o `deshacerConversion`, pará: RN-FR9. La corrección es un ajuste
motivado, que ya existe desde C5.

### 2.3. Controller y rutas

```ts
// split_stock es un permiso PROPIO: no se deduce de manage_stock. Es una
// operación irreversible con implicancias distintas (§8.1). Lo tienen el admin,
// el veterinario y la recepcionista (§8.2): abrir una caja de comprimidos ocurre
// al atender, no cuando el administrador está disponible. Si se restringe, se
// fracciona igual y se registra mal o no se registra, que es peor.
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"), requirePermission("view_stock"),
];
const splitStock = requirePermission("split_stock");
```

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/fraccionamientos` | `view_stock` |
| GET | `/api/v1/fraccionamientos/costo-por-producto` | `view_stock` |
| POST | `/api/v1/fraccionamientos/simular` | `view_stock` — no escribe nada |
| POST | `/api/v1/fraccionamientos` | **`split_stock`** — 201 |

**No hay `PUT`, `PATCH`, `DELETE` ni ninguna ruta inversa.**

### 2.4. Tests

**`tests/unit/fraccionamiento.service.test.ts`** (agregá a los que ya tenés):

| `it()` | Caso |
|---|---|
| `el Service no calcula el rendimiento ni el costo al fraccionar` | `fraccionar` pasa `p_cantidad_obtenida` tal cual vino del DTO y **no** lo compara contra el factor antes de llamar. Verificalo sobre los argumentos del mock. |
| `simular no escribe nada` | `simular` no llama a `.rpc()`, ni a `.insert()`, ni a `.update()`. |
| `RN-FR9: no existe ningún método de reversión` | `expect(FraccionamientoService.desfraccionar).toBeUndefined()`, ídem `revertir`, `deshacer`. |
| `los errores del RPC se traducen` | `CONVERSION_NOT_DEFINED` → 422 con ese código, no 500. |
| `un error desconocido no filtra el mensaje interno` | Mensaje con nombre de constraint → `INTERNAL_ERROR` 500 sin ese texto. |

**`tests/unit/fraccionamiento.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo `stock` |
|---|:--:|:--:|:--:|:--:|
| `GET /fraccionamientos` | 200 | 200 | 200 | 403 `MODULE_NOT_LICENSED` |
| `POST /fraccionamientos/simular` | 200 | 200 | 200 | 403 |
| `POST /fraccionamientos` | 201 | **201** | **201** | 403 |
| `GET /fraccionamientos/costo-por-producto` | 200 | 200 | 200 | 403 |

**Acá las celdas interesantes son los 201 del veterinario y de la recepcionista**, no un 403:
`split_stock` lo tienen los tres roles, y el test lo confirma. Agregá además un caso con un rol
al que se le quitó `split_stock` → **403**, para probar que el permiso se está exigiendo de
verdad y no es que el endpoint no valida nada.

Más `RN-SC1` (el `tenantId` del body se ignora) y el test estructural de que no hay rutas
inversas.

## 3. RN que cubre esta tanda

Ninguna RN nueva: C6·T1, T2 y T3 cerraron las trece RN-FR contra la base. Esta tanda completa la
cobertura de aplicación y **cierra el alcance C1–C6**.

| RN | Qué agrega |
|---|---|
| RN-FR9 | El test estructural del lado del Service y del Controller. |
| RN-SC1, SC5, SC7 | El `tenantId` del JWT, la auditoría y la matriz rol × endpoint, con el caso del permiso quitado. |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo.
2. `fraccionamiento.schemas.ts` → `.service.ts` → `.controller.ts`.
3. Ruta en `main.ts`.
4. `"fraccionamiento"` a `MODULOS_COMERCIALES` en G1.
5. `npm test && npm run typecheck && npm run test:integration` — **todo, no solo lo de esta
   tanda**.
6. **Cerrá `MATRIZ_RN_TESTS_COMERCIAL.md`.** Recorré las 90 filas:
   - 85 tienen que estar en ✅.
   - 5 (RN-CC1…CC5) en `N/A`.
   - **Si alguna quedó en `PENDIENTE`, decilo en el reporte. No la marques ✅.** Un pendiente
     aprobado es deuda invisible, y el prompt de auditoría lo va a encontrar igual.

## 5. Definición de hecho

```bash
# 1. No existe nada inverso, en ninguna capa
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%';"
grep -rniE "desfraccion|reagrupar|revertirFraccion" supabase/functions/api/src/modules/
# → cero filas y sin resultados

# 2. split_stock se exige en la ruta de escritura
grep -n "split_stock" supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts
# → en el POST /fraccionamientos, y NO en los GET

# 3. Los cuatro guardrails, juntos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → todo passed, 0 skipped. El it.each de cobertura de G1 corre con 8 módulos:
#   productos, proveedores, stock, compras, caja, ventas, ajustes, fraccionamiento

# 4. TODA la suite del módulo
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts
# → "N passed", "0 skipped". Un solo skipped significa que faltan credenciales y
#   que el alcance C1–C6 NO está verificado.

# 5. Recuento de la matriz
grep -c "PENDIENTE" MATRIZ_RN_TESTS_COMERCIAL.md
# → 0 (fuera del encabezado que explica el formato)
grep -c "N/A" MATRIZ_RN_TESTS_COMERCIAL.md
# → 5 filas de RN-CC más las menciones del encabezado
```

**Al terminar esta tanda, corré `prompts_etapas/C6_AUDITORIA.md`.**
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
`````

**AUDITORÍA C3→C6** — Después de C6·T4, ANTES de empezar C7. · **Gemini Flash** · Checklist mecánica de 8 controles obligatorios + 8 específicos, y veredicto.

`````markdown
# AUDITORÍA — ETAPAS C3 a C6 (cierre del alcance planificado)
> **Modelo:** Gemini Flash · **Rol:** auditoría y control
> **Cuándo:** después de C6·T4. Es la auditoría de cierre de C1–C6.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **No implementás nada.** Corrés la checklist, anotás el resultado real de cada control y
> emitís un veredicto. Si algo falla, escribís el prompt de corrección para una sesión de
> ejecución.
>
> **Checklist mecánica, no revisión de criterio.** Si el resultado no coincide con el esperado,
> el control **falla**, aunque "se entienda por qué".
>
> **Esta auditoría cubre las cuatro etapas donde el módulo escribe dinero y existencia.** C6 es
> además la última oportunidad de detectar que algo de C2 estaba mal antes de que haya datos
> históricos que dependan de ello.

---

## 0. Preparación

```bash
git log --oneline | head -50
export SHA_C3=<sha del último commit anterior a C3·T1>
git diff --stat $SHA_C3..HEAD
```

**Material:** `docs/ESPEC_MODULO_COMERCIAL.md` §4.7–4.12, §5, §6.6–6.9, §12;
`PLAN_ETAPAS_COMERCIAL.md`; los reportes de las tandas C3·T1 a C6·T4.

---

## 1. Los ocho controles obligatorios

### Control 1 — RN cubiertas

```bash
# 1.1 Ninguna RN del alcance quedó PENDIENTE
grep -cE "^\| RN-[A-Z]+[0-9]+ \|.*PENDIENTE" MATRIZ_RN_TESTS_COMERCIAL.md
```
**Esperado: `0`.**

```bash
# 1.2 Exactamente 5 filas en N/A, y las cinco son RN-CC
grep -E "^\| RN-[A-Z]+[0-9]+ \|.*N/A" MATRIZ_RN_TESTS_COMERCIAL.md
```
**Esperado: las cinco filas RN-CC1…CC5 y ninguna más.** Una RN de C1–C6 marcada `N/A` es una
regla que alguien decidió no cubrir sin decirlo.

```bash
# 1.3 Las 85 RN del alcance tienen test que cita su código
for rn in VT1 VT2 VT3 VT4 VT5 VT6 VT7 VT8 \
          CJ1 CJ2 CJ3 CJ4 CJ5 CJ6 CJ7 CJ8 CJ9 \
          FR1 FR2 FR3 FR4 FR5 FR6 FR7 FR8 FR9 FR10 FR11 FR12 FR13 \
          AJ1 AJ2 AJ3 AJ4 AJ5 AJ6 AJ7 \
          SC1 SC2 SC3 SC4 SC5 SC6 SC7 SC8; do
  n=$(grep -rho "RN-$rn[^0-9]" tests/ | wc -l)
  [ "$n" -eq 0 ] && echo "SIN TEST: RN-$rn"
done
```
**Esperado: sin salida.**

### Control 2 — Filtro de tenant en cada consulta

```bash
# 2.1 El guardrail, con cobertura de los ocho módulos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts
```
**Esperado: passed, y el `it.each` de cobertura corre con 8 módulos**: `productos`,
`proveedores`, `stock`, `compras`, `caja`, `ventas`, `ajustes`, `fraccionamiento`. Si corre con
menos, los módulos faltantes **no están verificados** aunque el guardrail dé verde.

```bash
# 2.2 Los RPC de C3–C6
for m in supabase/migrations/2026091*_comercial_*.sql supabase/migrations/2026092*_comercial_*.sql \
         supabase/migrations/2026093*_comercial_*.sql supabase/migrations/202610*_comercial_*.sql; do
  echo "$m  p_tenant_id=$(grep -c 'p_tenant_id' "$m")  WHERE=$(grep -ci 'where' "$m")"
done
```
**Esperado: `p_tenant_id >= WHERE` en cada uno.** Excepciones legítimas: `medios_pago`,
`unidades_medida`, `pg_*`. Listá cualquier otra y verificá a mano.

### Control 3 — Aislamiento

```bash
npx vitest run --config vitest.integration.config.ts \
  tests/integration/rls.test.ts tests/integration/aislamiento-api.integration.test.ts
```
**Esperado: passed, `0 skipped`.** Un `skipped` = SIN VERIFICAR, no PASA.

```bash
# Las tablas de C3–C6 tienen RLS y solo políticas de SELECT
psql "$DATABASE_URL" -c "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
  (SELECT string_agg(DISTINCT p.cmd, ',') FROM pg_policies p WHERE p.tablename=c.relname) AS cmds
  FROM pg_class c WHERE c.relname IN
  ('cajas','sesiones_caja','movimientos_caja','ventas','ventas_items','ventas_pagos',
   'contadores_tenant','recuentos','recuentos_detalle');"
```
**Esperado: `relrowsecurity = t`, `relforcerowsecurity = f`, `cmds = SELECT`** en las nueve.
Un `INSERT`, `UPDATE`, `DELETE` o `ALL` en `cmds` es FALLA: `authenticated` perdió el DML y no
hay motivo para devolvérselo.

### Control 4 — Auditoría

```bash
npx vitest run tests/unit/audit-modulo-enum.test.ts
grep -l "registros_auditoria" supabase/migrations/*_comercial_*.sql
```
**Esperado: passed, y el `INSERT INTO registros_auditoria` presente en las migraciones de
`registrar_venta`, `anular_venta`, los tres RPC de caja, `ajustar_existencia`,
`aplicar_recuento`, `registrar_devolucion` y `fraccionar_lote`.** Un RPC transaccional sin
asiento adentro es FALLA.

```bash
# El módulo de auditoría correcto por operación
grep -hoE "'(CREATE|UPDATE|CANCEL)', '(products|suppliers|purchases|inventory|sales|cash_register)'" \
  supabase/migrations/*_comercial_*.sql | sort | uniq -c
```
**Esperado:** `sales` para venta, anulación y devolución; `cash_register` para los tres de caja;
`inventory` para ajuste, recuento y fraccionamiento; `purchases` para compras. Una anulación de
venta con `module = 'inventory'` es FALLA: quien busca la anulación la busca junto a la venta.

```bash
# La anulación audita con CANCEL, no con UPDATE
grep -n "'CANCEL'" supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql
```
**Esperado: aparece.**

### Control 5 — Permisos y licenciamiento

```bash
# 5.1 Cada controller tiene su requireModule y su requirePermission
for f in supabase/functions/api/src/modules/{caja,ventas,ajustes,fraccionamiento}/*.controller.ts; do
  echo "$f: module=$(grep -c requireModule "$f") perm=$(grep -c requirePermission "$f")"
done
```
**Esperado: los dos `>= 1` en los cuatro.**

```bash
# 5.2 El módulo correcto en cada uno
grep -hn 'requireModule("' supabase/functions/api/src/modules/{caja,ventas,ajustes,fraccionamiento}/*.controller.ts
```
**Esperado:** `caja` → `"ventas"`. `ventas` → `"ventas"`. `ajustes` → `"stock"` para ajustes y
recuentos, `"ventas"` para devoluciones. `fraccionamiento` → `"stock"`.
**Si `caja` usa `"stock"`, es FALLA**: un tenant `profesional` tendría arqueo sin poder vender.

```bash
# 5.3 Los permisos restringidos están donde corresponde
grep -rn "void_sales" supabase/functions/api/src/modules/ventas/ventas.controller.ts
grep -rn "split_stock" supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts
grep -rn "manage_stock" supabase/functions/api/src/modules/ajustes/ajustes.controller.ts
```
**Esperado: los tres aparecen, cada uno solo en sus rutas de escritura.**

```bash
# 5.4 Las matrices rol × endpoint prueban los 403
grep -c "403" tests/unit/{caja,ventas,ajustes,fraccionamiento}.controller.test.ts
```
**Esperado: al menos 4 por archivo.**

### Control 6 — Concurrencia

**Es el control más importante de esta auditoría.**

```bash
# 6.1 Los dos tests concurrentes, con 200 repeticiones
CONCURRENCY_REPS=200 npx vitest run --config vitest.integration.config.ts \
  tests/integration/caja.integration.test.ts -t "RN-CJ4"
CONCURRENCY_REPS=200 npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts -t "RN-SC8"
```
**Esperado: passed los dos.** Si falla **una sola repetición de 200**, hay una condición de
carrera real y la etapa **no está cerrada**.

```bash
# 6.2 El guard rpcReallyRan está en los dos
grep -c "rpcReallyRan" tests/integration/caja.integration.test.ts \
  tests/integration/ventas.integration.test.ts
```
**Esperado: `>= 2` en cada uno** (una por llamada concurrente). Sin el guard, un `NOTIFY`
faltante haría fallar las dos llamadas y el test contaría "cero éxitos, dos fallos", que se
puede leer como que la exclusión funcionó.

```bash
# 6.3 EL ORDEN DE BLOQUEO ES POR lote_id
grep -n -B6 "FOR UPDATE" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql \
  supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql
```
**Esperado: `ORDER BY lote_id` inmediatamente antes de cada `FOR UPDATE` que bloquee más de una
fila.** `registrar_venta` y `aplicar_recuento` tocan varios lotes: sin el orden fijo, dos
operaciones que los tomen en secuencia inversa se deadlockean.
**Si falta en alguno de los dos, es FALLA.** No hay test que lo detecte de forma confiable, así
que este control es la única verificación que hay.

```bash
# 6.4 Los reportes declaran las verificaciones por mutación
```
Revisá los reportes de C3·T2 (RN-CJ4), C4·T2 (RN-VT1 y el orden del bloqueo), C4·T3 (RN-VT5),
C4·T5 (RN-SC8 ×2), C5·T2 (RN-AJ4), C5·T3 (RN-AJ3), C6·T1 (RN-FR7 y RN-FR8).
**Cada uno tenía que reportar la mutación con su resultado numérico.** Anotá cuáles faltan.

> El reporte de C4·T5 tiene que decir **en qué repetición falló** la mutación de RN-SC8. Si dice
> que la mutación *no* hizo fallar el test en 200 repeticiones, **el test no está probando
> nada** y el control 6 FALLA aunque el test dé verde.

### Control 7 — Grants y PostgREST

```bash
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
```
**Esperado: passed, `0 skipped`, y el `it.each` con al menos 19 casos.** Anotá el número.

```bash
# Contá las funciones que debería haber descubierto
grep -hoE "CREATE\s+(OR REPLACE\s+)?FUNCTION\s+(public\.)?[a-z0-9_]+" \
  supabase/migrations/*_comercial_*.sql | sed 's/.*[. ]//' | sort -u | wc -l
```
**Esperado: el mismo número que los casos del `it.each`.** Si el `it.each` corre con menos, hay
migraciones sin la marca `-- @modulo: comercial`.

```bash
grep -L "@modulo: comercial" supabase/migrations/*_comercial_*.sql
for m in $(grep -l "CREATE OR REPLACE FUNCTION" supabase/migrations/*_comercial_*.sql); do
  tail -5 "$m" | grep -q "NOTIFY pgrst" || echo "SIN NOTIFY: $m"
done
```
**Esperado: sin salida en los dos.**

### Control 8 — Los tests prueban algo

```bash
# 8.1 Toda la integración corre y NADA se saltea
npx vitest run --config vitest.integration.config.ts 2>&1 | tail -20
```
**Esperado: `0 skipped`.**

```bash
# 8.2 Nada de expect(true) ni asserts vacíos
grep -rn "expect(true)\|expect(1).toBe(1)" tests/unit tests/integration
```
**Esperado: sin salida.**

```bash
# 8.3 Las reglas de base se prueban contra la base
grep -c "23505\|23503\|23514\|MOVEMENT_IMMUTABLE" \
  tests/integration/{ventas,caja,ajustes,fraccionamiento}.integration.test.ts
```
**Esperado: `>= 1` en cada archivo.**

```bash
# 8.4 El barrido de RN-VT1 probó una cantidad significativa de combinaciones
grep -n -A15 "RN-VT1.*barrido\|barrido.*RN-VT1" tests/unit/ventas.service.test.ts
```
**Esperado: el bucle recorre al menos 100.000 combinaciones de precio × alícuota.** Un barrido
de 20 casos no es un barrido: R-04 aparece en una fracción de los precios.

```bash
# 8.5 Los tests concurrentes siembran datos nuevos por repetición
grep -n -A10 "RN-SC8.*última unidad" tests/integration/ventas.integration.test.ts
```
**Esperado: dentro del `for` de repeticiones hay una siembra de producto/lote/sesión.** Si el
lote se siembra **fuera** del bucle, a partir de la segunda repetición la existencia es 0, las
dos llamadas fallan, y el test pasa sin haber probado la carrera ni una sola vez.

---

## 2. Controles específicos de C3 a C6

### 2.1 — R-04: el IVA no se redondea por separado

```bash
grep -n "iva_u\|iva_unitario" supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql
grep -n -A6 "export function descomponerLinea" supabase/functions/api/src/modules/ventas/ventas.calculo.ts
```
**Esperado: en los dos, el IVA es una RESTA (`precio − neto`), no una multiplicación por la
alícuota.** Si en alguno es `round(precio * alicuota / (100 + alicuota), 2)`, hay casos donde
`neto + iva ≠ precio` y el ticket no cuadra con sus líneas → **FALLA**.

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM ventas_items
  WHERE round(neto_unitario + iva_unitario, 2) <> round(precio_unitario, 2);"
```
**Esperado: `0`.** Es la comprobación sobre datos reales.

### 2.2 — R-05: la merma de fraccionamiento tiene costo cero

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM movimientos_stock
  WHERE tipo='merma_fraccionamiento' AND (costo_unitario <> 0 OR costo_total <> 0);"
```
**Esperado: `0`.** Cualquier fila cuenta el mismo peso dos veces y sobrevalúa el inventario.

```bash
psql "$DATABASE_URL" -c "SELECT operacion_id,
  sum(costo_total * signo_movimiento(tipo)) AS suma_firmada
  FROM movimientos_stock
  WHERE tipo IN ('salida_conversion','entrada_conversion','merma_fraccionamiento')
  GROUP BY operacion_id HAVING abs(sum(costo_total * signo_movimiento(tipo))) > 0.01;"
```
**Esperado: cero filas.** Fraccionar no cambia el valor del inventario.

### 2.3 — R-07: no se descuenta atravesando el factor

```bash
grep -rn "v_stock_familia_unidad_base" supabase/functions/api/src/modules/
grep -rn "factor_teorico" supabase/functions/api/src/modules/ | grep -v "crearDerivado\|reporte\|costo_fraccionamiento"
```
**Esperado: la vista aparece **solo** en lecturas de reporte; `factor_teorico` solo en
`crearDerivado` y en reportes.** Si un camino de escritura los toca, es el modelo que D-06
descartó → **FALLA**.

```bash
npx vitest run tests/unit/fraccionamiento.service.test.ts -t "RN-FR12"
```
**Esperado: passed los tres casos.**

### 2.4 — R-08: no existe des-fraccionar

```bash
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%' OR proname ILIKE '%unir_lote%';"
grep -rniE "desfraccion|reagrupar|revertirFraccion" supabase/functions/api/src/modules/
```
**Esperado: cero filas y sin resultados** (salvo comentarios que expliquen por qué no existe).

### 2.5 — R-09: no se reabre una caja cerrada

```bash
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%';"
grep -nE '\.(put|patch|delete)\(' supabase/functions/api/src/modules/caja/caja.controller.ts
psql "$DATABASE_URL" -c "SELECT count(*) FROM sesiones_caja
  WHERE estado='cerrada' AND (diferencia IS NULL OR saldo_teorico_efectivo IS NULL);"
```
**Esperado: cero filas · sin resultados · `0`.** La tercera consulta verifica RN-CJ6 y RN-CJ8
sobre datos reales: una sesión cerrada sin diferencia registrada es una que no se arqueó.

### 2.6 — R-10: el rendimiento real no está forzado al teórico

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM v_costo_fraccionamiento
  WHERE cantidad_obtenida = cantidad_teorica;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM v_costo_fraccionamiento;"
```
**Si TODOS los fraccionamientos tienen rendimiento exactamente igual al teórico**, revisá que el
RPC no esté forzando `cantidad_obtenida := v_teorico` en algún camino. En datos de prueba puede
ser coincidencia; anotalo como observación y verificá el código:

```bash
grep -n "cantidad_obtenida" supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql
```
**Esperado: `p_cantidad_obtenida` se usa tal como llega, nunca se le asigna `v_teorico`.**

### 2.7 — R-11: la zona horaria en el corte de caja

```bash
grep -rn "now()\|CURRENT_DATE\|CURRENT_TIMESTAMP" supabase/migrations/20260915000002_comercial_caja_rpcs.sql
```
**Esto NO es un fallo del módulo**: la zona horaria configurable es transversal al sistema y el
plan decidió no introducirla. **Verificá que existe el test de la sesión que abre 21:00 y cierra
01:30**, y si no está, anotalo como observación para C7, no como falla de C6.

```bash
grep -rn "21:00\|medianoche\|cruza el día" tests/integration/caja.integration.test.ts
```

### 2.8 — Las decisiones irrecuperables de §12.2, ya con datos

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM lotes
  WHERE origen='conversion' AND lote_padre_id IS NULL;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM movimientos_stock WHERE operacion_id IS NULL;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM ventas_items WHERE alicuota_iva IS NULL;"
```
**Esperado: `0` en las tres.** Un lote de conversión sin padre es una cadena de trazabilidad que
ya no se puede reconstruir.

---

## 3. Veredicto

Uno de los tres, explícito, con las dos tablas de controles.

### APROBADA
Los ocho controles pasan, los ocho específicos pasan, las 85 RN del alcance están en ✅ y las 5
de RN-CC en `N/A`. **El alcance C1–C6 está cerrado.** Lo que sigue es planificar C7 y C8.

### APROBADA CON CORRECCIONES
Lista numerada, cada una con archivo, qué está mal y qué tiene que decir. Al final, el prompt de
corrección listo para pegar, con el formato de los prompts de tanda.

**No apruebes con pendientes "menores".**

### RECHAZADA
Si falla el control 6 (concurrencia), el control 3 (aislamiento), 2.1 (IVA), 2.2 (merma con
costo), 2.3 (descuento por factor) o 2.8. Decí qué decisión de diseño se violó y por qué rehacer
es más barato que parchar.

> **El control 6 merece una nota aparte.** Si el test concurrente pasa pero su verificación por
> mutación no está reportada, el veredicto **no puede ser APROBADA**: no hay evidencia de que el
> test detecte la condición de carrera. Es APROBADA CON CORRECCIONES, y la corrección es correr
> la mutación y reportar el número de repetición.

---

## 4. Qué NO hacer

- **No implementes las correcciones.** Escribí el prompt para la sesión de ejecución.
- **No apruebes un control que no pudiste correr.** SIN VERIFICAR es un resultado distinto de
  PASA, y hay que reportarlo como tal.
- **No reinterpretes un resultado que no coincide.** Si el comando esperaba `0` y devolvió otra
  cosa, el control falla.
- No modifiques la spec, el plan, los prompts ni la matriz.
- **No relajes un test que falla.** Si RN-FR7, RN-FR8, RN-VT1 o RN-SC8 se ponen rojos, están
  detectando exactamente lo que existen para detectar.

## 5. Reporte final (obligatorio, va al chat)

1. **Tabla de los ocho controles obligatorios**: número, comando, resultado obtenido,
   PASA/FALLA/SIN VERIFICAR.
2. **Tabla de los ocho controles específicos** (2.1 a 2.8), mismo formato.
3. **Tabla de verificaciones por mutación**: qué tanda, qué RN, qué reportó, y si el número
   está o falta.
4. **Veredicto**, uno de los tres.
5. Si hay correcciones: la lista numerada y el prompt de corrección.
6. **Cuántos controles quedaron SIN VERIFICAR y por qué.**
7. **Estado final de la matriz**: cuántas en ✅, cuántas en `PENDIENTE`, cuántas en `N/A`.
`````

**C7·T1** — Cuando C6 está aprobada por su auditoría. · **Gemini Flash** · Entrega: el RPC `registrar_consumo_clinico`. **Activa las cinco RN-CC en la matriz.** No crea ninguna tabla ni columna: todo lo que necesita está desde C2·T1.

`````markdown
# ETAPA C7 · TANDA 1/3 — RPC `registrar_consumo_clinico`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6 completa y aprobada por `C6_AUDITORIA.md`, con los cuatro guardrails en
> verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Aplicar una vacuna, usar un sedante o gastar una jeringa descuenta existencia y NO es una
> venta ni un ajuste.** Es una salida atada a un evento clínico, con profesional responsable y
> paciente. Se modeló así desde el día uno —el tipo `consumo_clinico` y las tres columnas
> clínicas están en el ENUM y en la tabla desde C1·T1 y C2·T1— justamente para no tener que
> reclasificar dos años de ajustes después.
>
> **Esta tanda NO crea ninguna tabla ni ninguna columna.** Todo lo que necesita ya existe.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-01 | Por qué el consumo clínico es un movimiento de primera clase y qué se pierde si entra como ajuste. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-14, D-15 | Receta y prescriptor sin validación; por qué no se construye el puente a SIGTRAZAVET. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.10 | RN-CC1…CC5 con sus casos exactos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §10.3 | **La dirección de la dependencia.** El movimiento apunta al evento clínico; el módulo clínico no se entera. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | **El patrón exacto a copiar.** Las validaciones sin bloqueo, la asignación FEFO, el `FOR UPDATE` ordenado por `lote_id`, las validaciones sobre el valor ya bloqueado, la auditoría interna. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | El CHECK de coherencia documental: ya exige `historial_id` para `consumo_clinico`. |
| `supabase/migrations/20260630000002_marcar_dosis_aplicada_rpc.sql` | El RPC clínico existente. **Leelo pero NO lo toques**: ya crea el evento en `historial_clinico` y devuelve su `event_id`, que es el que este RPC va a recibir. |
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

1. `supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql`
2. `tests/integration/consumo.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **Las cinco filas RN-CC pasan de `N/A` a `PENDIENTE`** — es la primera tarea de esta tanda, ver sección 4 — y después RN-CC1, CC2, CC5 a ✅. |

**No se toca `marcar_dosis_aplicada`, ni `historial_clinico`, ni `plan_vacunacion`, ni ninguna
migración de C1 a C6.** Si al escribir el RPC te parece que necesitás una columna nueva en una
tabla clínica, **frená y reportá**: eso rompería la independencia de §10.3.

## 2. Especificación exacta

### 2.0. La dirección de la dependencia — leelo antes que nada

```
        movimientos_stock.historial_id  ──────►  historial_clinico.id
        movimientos_stock.mascota_id    ──────►  mascotas.id
        movimientos_stock.plan_vacunacion_id ─►  plan_vacunacion.id
```

**Las flechas van en un solo sentido y no se invierten.** Es deliberado y tiene tres motivos:

1. **El módulo clínico no depende del comercial.** Un tenant sin `stock` contratado usa el
   historial exactamente igual que hoy.
2. La dirección inversa —una columna `producto_id` en `historial_clinico`— obligaría al módulo
   clínico a conocer el catálogo y rompería la independencia de módulos vendibles, que es lo que
   `requireModule` protege.
3. Para mostrar "qué se le aplicó" en la ficha se consulta `movimientos_stock` filtrando por
   `historial_id`, que ya está indexado desde C2·T1 (`idx_mov_historial`).

**Consecuencia operativa:** el evento clínico se crea **primero**, por el camino que ya existe
(`registrar_evento_clinico` o `marcar_dosis_aplicada`), y **después** se llama a este RPC con el
`historial_id` que aquél devolvió. Son dos llamadas, no una transacción conjunta, y eso también
es a propósito: si el descuento de stock fallara, **el acto clínico ya ocurrió y tiene que quedar
registrado igual**.

### 2.1. Firma

```sql
registrar_consumo_clinico(
  p_tenant_id                 UUID,
  p_usuario_id                UUID,
  p_historial_id              UUID,     -- el evento clínico, YA CREADO
  p_items                     JSONB,    -- [{productoId, cantidad, loteId, motivoFefo}]
  p_plan_vacunacion_id        UUID DEFAULT NULL,
  p_receta_id                 UUID DEFAULT NULL,   -- RESERVADA, sin validar (D-14)
  p_profesional_prescriptor_id UUID DEFAULT NULL   -- RESERVADA, sin validar (D-14)
)
RETURNS TABLE (
  operacion_id      UUID,
  movimientos       INTEGER,
  costo_total       NUMERIC,
  advertencias      JSONB      -- receta, vencimiento próximo: informativas, no bloquean
)
```

### 2.2. Cuerpo

```
BEGIN
  v_operacion := gen_random_uuid();
  v_advertencias := '[]'::jsonb;

  -- ── 1. Validaciones SIN bloqueo ──────────────────────────────────────────
  -- El evento clínico existe y es de este tenant. De acá sale mascota_id, que se
  -- DENORMALIZA en el movimiento para la trazabilidad lote↔animal (RN-CC4).
  SELECT hc.id, hc.pet_id, hc.professional_id
    INTO v_evento
    FROM historial_clinico hc
   WHERE hc.id = p_historial_id AND hc.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORIAL_NOT_FOUND'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0
     THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;

  -- Si vino un plan de vacunación, es de este tenant y de la MISMA mascota.
  -- Sin esta verificación, un plan_vacunacion_id de otra mascota entraría y la
  -- trazabilidad lote↔animal quedaría diciendo una cosa distinta de la verdad.
  IF p_plan_vacunacion_id IS NOT NULL THEN
    PERFORM 1 FROM plan_vacunacion pv
     WHERE pv.id = p_plan_vacunacion_id AND pv.tenant_id = p_tenant_id
       AND pv.pet_id = v_evento.pet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VACCINE_PLAN_NOT_FOUND'; END IF;
  END IF;

  -- Config del tenant: se lee UNA vez, fuera del bucle.
  SELECT exigir_receta_bloqueante, dias_alerta_vencimiento
    INTO v_config
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  -- ── 2. Por ítem: validación y asignación FEFO ────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
                  "productoId" UUID, cantidad NUMERIC, "loteId" UUID, "motivoFefo" TEXT)
  LOOP
    SELECT activo, es_consumible_clinico, condicion_venta, unidad_medida_id, nombre
      INTO v_prod
      FROM productos WHERE id = v_item."productoId" AND tenant_id = p_tenant_id;

    IF NOT FOUND         THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_prod.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';  END IF;   -- RN-PR3

    -- `es_consumible_clinico` habilita seleccionarlo desde el historial. NO es
    -- bloqueante acá: un producto vendible también se puede consumir (una
    -- pipeta que el veterinario aplica en el consultorio). Se registra como
    -- advertencia para que la UI lo señale.
    IF NOT v_prod.es_consumible_clinico THEN
      v_advertencias := v_advertencias || jsonb_build_object(
        'tipo', 'producto_no_marcado_como_consumible',
        'productoId', v_item."productoId", 'nombre', v_prod.nombre);
    END IF;

    -- RN-PR6: decimales según la unidad del producto.
    IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
       THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

    -- ── RN-CC3: la receta es opcional HOY y bloqueante POR CONFIGURACIÓN ────
    -- Con exigir_receta_bloqueante = false, un producto "bajo receta" se
    -- consume con ADVERTENCIA. Con la bandera en true, se exige receta_id.
    -- El día que el negocio decida exigir receta, se enciende la bandera y esta
    -- regla pasa de advertencia a bloqueo SIN MIGRACIÓN. Eso es todo lo que
    -- D-14 compró con dos columnas nullable.
    IF v_prod.condicion_venta IN ('bajo_receta','bajo_receta_archivada') THEN
      IF v_config.exigir_receta_bloqueante AND p_receta_id IS NULL THEN
        RAISE EXCEPTION 'PRESCRIPTION_REQUIRED';
      ELSIF p_receta_id IS NULL THEN
        v_advertencias := v_advertencias || jsonb_build_object(
          'tipo', 'producto_bajo_receta_sin_receta',
          'productoId', v_item."productoId", 'nombre', v_prod.nombre);
      END IF;
    END IF;

    -- ── RN-CC2: descuenta con LAS MISMAS REGLAS que la venta ────────────────
    -- Candidatos FEFO: fecha_vencimiento ASC con NULLS LAST, luego
    -- fecha_ingreso, luego id. Los vencidos NO entran (RN-LO4, no overrideable
    -- por ningún rol). Los bloqueados tampoco (RN-LO7).
    -- Override motivado igual que RN-LO6: si el usuario forzó otro lote,
    -- exige motivo y el movimiento guarda fefo_respetado = false.
    ...
    v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, <lotes asignados>);
  END LOOP;

  -- ── 3. BLOQUEO. Todos los lotes en UN SOLO SELECT, ORDENADOS POR lote_id ──
  -- Igual que en registrar_venta y por el mismo motivo: dos operaciones que
  -- toquen los mismos lotes en orden inverso se bloquean mutuamente y una muere
  -- por deadlock. Y acá hay un caso REAL de concurrencia: dos veterinarios
  -- aplicando vacunas del mismo frasco a la misma hora.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_a_bloquear)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── 4. Validaciones SOBRE EL VALOR YA BLOQUEADO ──────────────────────────
  --   existencia insuficiente -> INSUFFICIENT_STOCK
  --   lote vencido            -> BATCH_EXPIRED
  --   lote bloqueado          -> BATCH_BLOCKED

  -- ── 5. Escrituras ────────────────────────────────────────────────────────
  -- Un movimiento por lote asignado. TODOS con:
  --   tipo = 'consumo_clinico'
  --   historial_id = p_historial_id          (lo exige el CHECK documental de C2·T1)
  --   mascota_id   = v_evento.pet_id         (denormalizado, RN-CC4)
  --   plan_vacunacion_id, receta_id, profesional_prescriptor_id  si vinieron
  --   costo_unitario = costo_unitario_efectivo DEL LOTE, congelado
  --   operacion_id compartido
  --
  -- trazabilidad_estado se deja en su DEFAULT 'no_aplica'. NO lo escribas.
  -- RN-CC5 es el test de que ese puente NO se construyó (D-15): no hay cliente
  -- HTTP, no hay cola de reintentos, no hay mapeo de códigos, no hay credencial.
  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
    costo_unitario, costo_total, fefo_respetado, motivo,
    historial_id, plan_vacunacion_id, mascota_id,
    receta_id, profesional_prescriptor_id, usuario_id
  ) VALUES (...);

  -- ── 5b. Alerta de stock mínimo, por FLANCO ───────────────────────────────
  -- Mismo mecanismo que en registrar_venta: se crea al cruzar el mínimo hacia
  -- abajo y se ELIMINA al cruzarlo hacia arriba. Un consumo clínico baja la
  -- existencia igual que una venta y tiene que avisar igual.

  -- ── 6. NO se genera venta. NO se genera movimiento de caja. ───────────────
  -- Es RN-CC1 y es la razón de existir del tipo propio. Modelarlo como venta a
  -- precio cero rompería todos los reportes de venta y obligaría a un cliente
  -- ficticio; como ajuste, perdería el vínculo clínico.

  -- ── 7. Auditoría, misma transacción ──────────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'CREATE', 'inventory', v_operacion::text,       -- module = 'inventory'
    jsonb_build_object('historial_id', p_historial_id, 'mascota_id', v_evento.pet_id,
                       'movimientos', v_movs, 'costo_total', v_costo_total));

  RETURN QUERY SELECT v_operacion, v_movs, v_costo_total, v_advertencias;
END;
```

**Cada lectura y cada escritura filtra por `p_tenant_id`.** Es `SECURITY DEFINER`: no hay RLS.

Cierre: `REVOKE ALL … FROM PUBLIC;`, `GRANT EXECUTE … TO service_role;`,
`NOTIFY pgrst, 'reload schema';`, y la marca `-- @modulo: comercial` en la primera línea.

### 2.3. Tests — `tests/integration/consumo.integration.test.ts`

Arnés: reusá el de `fraccionamiento.integration.test.ts`. Vas a necesitar sembrar una mascota,
un cliente, un evento de `historial_clinico` y un lote con existencia; escribí el helper una vez
y exportalo, porque C7·T2 y C7·T3 lo reusan.

| `it()` | Caso |
|---|---|
| `RN-CC1: el consumo clínico es un tipo propio, no una venta ni un ajuste` | Aplicar una vacuna desde el historial → **un** movimiento `consumo_clinico` con `historial_id` y `mascota_id` poblados. **Y**: `SELECT count(*) FROM ventas WHERE tenant_id = A` no cambió, y `SELECT count(*) FROM movimientos_caja WHERE tenant_id = A` tampoco. Las tres aserciones: sin las dos últimas, el test pasaría aunque el RPC generara una venta a precio cero. |
| `RN-CC1: el consumo no lleva venta_item_id ni compra_item_id` | El movimiento tiene los dos en `NULL`. Y forzar un `INSERT` de `consumo_clinico` **sin** `historial_id` por PostgREST → viola el CHECK documental de C2·T1. |
| `RN-CC2: consumir de un lote vencido falla` | Único lote disponible vencido → `BATCH_EXPIRED`. Repetilo con JWT de **admin**: tampoco. RN-LO4 no es overrideable. |
| `RN-CC2: consumir más de lo disponible falla` | Existencia 2, consumir 3 → `INSUFFICIENT_STOCK`. La existencia siguió en 2. |
| `RN-CC2: el lote sugerido es el de FEFO` | Tres lotes que vencen en 2027-01, 2027-03 y `NULL` → el movimiento sale del de enero. |
| `RN-CC2: un lote bloqueado no se consume` | `BATCH_BLOCKED`. |
| `RN-CC3: la receta es advertencia con la bandera en false` | Producto `condicion_venta = 'bajo_receta'`, `exigir_receta_bloqueante = false`, sin `p_receta_id` → **funciona**, y `advertencias` trae `producto_bajo_receta_sin_receta`. |
| `RN-CC3: la receta es bloqueante con la bandera en true` | **El mismo producto y el mismo llamado**, cambiando **solo** `configuracion_tenant.exigir_receta_bloqueante` a `true` → `PRESCRIPTION_REQUIRED`. Con `p_receta_id` puesto → funciona. **Sin migración de por medio**: eso es lo que el test tiene que demostrar. |
| `RN-CC5: las columnas de trazabilidad externa no se usan` | Después de un ciclo completo —una compra, una venta, un fraccionamiento, un ajuste y un consumo clínico—: `SELECT count(*) FROM movimientos_stock WHERE tenant_id = A AND trazabilidad_estado <> 'no_aplica'` → **0**. Y `SELECT count(*) FROM movimientos_stock WHERE trazabilidad_referencia_externa IS NOT NULL` → **0**. |
| `RN-CC5: no existe ningún cliente HTTP hacia un organismo externo` | Guardrail estático: ningún archivo de `supabase/functions/api/src/modules/` contiene `fetch(` hacia un host externo, ni `SIGTRAZAVET`, ni `senasa`. Escribilo como test, no como revisión manual. |
| `dos consumos simultáneos del mismo frasco no sobrevenden` | `Promise.all` de dos `.rpc("registrar_consumo_clinico")` sobre un lote con existencia 1, con el guard `rpcReallyRan()`. Exactamente uno tiene éxito. **Es un caso real**: dos veterinarios aplicando del mismo frasco a la misma hora. |
| `el consumo audita con module inventory` | El asiento existe, con `module = 'inventory'` y `action = 'CREATE'`. Si el RPC falla, **no** queda asiento. |

**RN-CC5 es un test de que algo NO se construyó**, y es raro escribirlo pero vale: la presión
para "ir agregando el puente de a poco" aparece cuando alguien lee la resolución de SENASA. El
test es lo que hace que agregarlo sea una decisión explícita y no un goteo.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CC1 | El consumo clínico es un tipo propio: no se registra como venta ni como ajuste. | `it('RN-CC1: el consumo clínico es un tipo propio, no una venta ni un ajuste', …)` |
| RN-CC2 | Descuenta con las mismas reglas que la venta: FEFO, bloqueo de fila, prohibición de vencidos, existencia no negativa. | `it('RN-CC2: …', …)` — cuatro casos |
| RN-CC3 | La receta es opcional hoy y bloqueante por configuración. → `422 PRESCRIPTION_REQUIRED` | `it('RN-CC3: la receta es bloqueante con la bandera en true', …)` |
| RN-CC5 | Las columnas de trazabilidad externa no se usan: `trazabilidad_estado` queda en `no_aplica`. | `it('RN-CC5: las columnas de trazabilidad externa no se usan', …)` |

**RN-CC4** (trazabilidad lote↔animal consultable) es de C7·T3: necesita las consultas, no solo
el movimiento. Dejala en `PENDIENTE`.

## 4. Orden de trabajo

1. **Primero, activá las cinco RN-CC en la matriz.** Cambiá el estado de las filas RN-CC1…CC5 de
   `N/A` a `PENDIENTE` en `MATRIZ_RN_TESTS_COMERCIAL.md`. Hasta ahora estaban en `N/A` porque C7
   no existía; ahora sí.
2. **Verificá el prerrequisito antes de escribir una línea:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
     WHERE table_name='movimientos_stock' AND column_name IN
     ('historial_id','plan_vacunacion_id','mascota_id','receta_id','profesional_prescriptor_id');"
   ```
   **Esperado: las cinco.** Si falta alguna, **frená y reportá**: la migración de C2·T1 no quedó
   como el plan la especificó y agregarlas ahora es una migración sobre la tabla más grande del
   módulo.
3. Escribí los tests y corrélos: tienen que fallar con "no se encontró la función
   `registrar_consumo_clinico`".
4. Migración con marca y `NOTIFY`, aplicada.
5. Tests en verde.
6. **Verificá RN-CC1 por mutación:** hacé que el RPC además inserte una fila en `ventas` a precio
   cero. Corré RN-CC1 y confirmá que **falla** en la aserción de `count(*) FROM ventas`. Volvé al
   original. Reportalo.
7. `npm test && npm run typecheck && npm run test:integration`.
8. Marcá RN-CC1, CC2, CC3 y CC5 en la matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE'),
  has_function_privilege('authenticated', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='registrar_consumo_clinico';"
# → una fila, las dos columnas en f

# 2. EL BLOQUEO ESTÁ ORDENADO POR lote_id
grep -n -B4 "FOR UPDATE" supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → ORDER BY lote_id inmediatamente antes

# 3. El RPC NO escribe ventas ni caja
grep -nE "INSERT INTO (ventas|movimientos_caja|ventas_items|ventas_pagos)" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → SIN RESULTADOS

# 4. El RPC NO escribe trazabilidad_estado
grep -n "trazabilidad_estado\|trazabilidad_referencia_externa" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → sin resultados, o solo dentro de un comentario que explique por qué no se tocan

# 5. Ninguna tabla ni columna nueva
git diff --stat HEAD -- supabase/migrations/ | tail -3
grep -icE "CREATE TABLE|ALTER TABLE .* ADD COLUMN" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → 0

# 6. No se tocó ninguna migración de C1 a C6
git status --short supabase/migrations/ | grep -v "^??"
# → SIN RESULTADOS. Solo debe aparecer el archivo nuevo, como no rastreado.

# 7. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/consumo.integration.test.ts
# → "N passed", "0 skipped"

# 8. G3 descubrió el RPC nuevo solo
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con un caso más que en C6

# 9. Suites completas y los cuatro guardrails
npm test && npm run typecheck
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
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
`````

**C7·T2** — Cuando C7·T1 está en verde. · **Gemini Flash** · Entrega: Service, Controller, rutas y el enganche clínico. **Es la tanda que toca la frontera con el módulo clínico**; no modifica ni un archivo de `historial/` ni de `vacunacion/`.

`````markdown
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
`````

**C7·T3** — Cuando C7·T2 está en verde. · **Gemini Flash** · Entrega: trazabilidad lote↔animal, costo de insumos por atención y el reporte de pendientes de regularizar (P-04). Cierra C7.

`````markdown
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
`````

**C8·T1** — Cuando C7 está completa con las cinco RN-CC en ✅. · **Gemini Flash** · Entrega **el fixture de volumen VERSIONADO** —la deuda que la Etapa 9 dejó— y la valorización de inventario a una fecha.

`````markdown
# ETAPA C8 · TANDA 1/3 — Fixture de volumen versionado y valorización a fecha
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C7 completa y en verde, con las cinco RN-CC en ✅.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **El fixture va primero y no al final, y esa es toda la razón de ser de esta tanda.**
>
> `docs/EXPLAIN_INDICES.md` deja constancia de que el seed de volumen de la Etapa 9 vivió en
> `scratchpad/s10_seed_volumen.sql`, **no se versionó, y ya no existe** —lo barrió el `db reset`
> del squash DT-8—. Lo mismo pasó con el `predeploy_seed_volumen.sql` de la revisión pre-deploy.
> El documento lo dice con todas las letras: *"Los scripts de S10 no se versionaron y ya no
> existen."*
>
> **Verificar que una consulta usa índice contra una tabla de 12 filas no significa nada**: con
> ese volumen Postgres hace scan secuencial porque es más rápido, y el `EXPLAIN` que se firma
> como evidencia no dice nada sobre producción. Sin el fixture, las tandas T2 y T3 de esta etapa
> no tienen contra qué correr.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/EXPLAIN_INDICES.md` §Metodología y §Reproducción | **El método exacto a replicar**: stack local en `:54322`, 3 tenants, `ANALYZE` tras la carga, `EXPLAIN (ANALYZE, BUFFERS)` sobre las queries reales de los services con los embeds de PostgREST reproducidos como `LEFT JOIN`. Y la constancia de que el fixture anterior se perdió. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §12.3 punto 2 | Por qué el fixture de volumen es una deuda que había que presupuestar. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-02 | Por qué la valorización a fecha se reconstruye desde el libro mayor y no desde la caché. |
| `scripts/seed.mjs` y `scripts/README.md` | El patrón de script del repo: cómo se conecta, cómo se documenta, cómo se invoca desde `package.json`. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Los índices del libro mayor, que son los que el `EXPLAIN` de T3 va a poner a prueba. |
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

1. `supabase/seeds/volumen_comercial.sql` — **el fixture, versionado en el repo**
2. `scripts/README-volumen.md` — cómo correrlo y qué volumen genera
3. `supabase/migrations/20261020000001_comercial_valorizacion_a_fecha.sql`
4. `tests/integration/reportes.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `package.json` | El script `"seed:volumen"`. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` | `valorizacionAFecha`. |
| `supabase/functions/api/src/modules/stock/stock.controller.ts` | `GET /existencias/valorizacion-a-fecha`. |
| `tests/unit/stock.service.test.ts` | Los casos de la valorización a fecha. |

**El fixture NO va en `scratchpad/`, NO va en `/tmp` y NO va fuera del repo.** Ese es el error
que este entregable existe para no repetir.

## 2. Especificación exacta

### 2.1. `supabase/seeds/volumen_comercial.sql`

**Requisitos del archivo, todos verificables:**

1. **Idempotente.** Correrlo dos veces no duplica nada. Arranca borrando lo que él mismo creó,
   identificándolo por los tenants sintéticos que usa, y **nunca toca el tenant demo**.
2. **Tres tenants sintéticos con UUID fijos**, escritos en el archivo, no generados:
   `aaaaaaaa-0000-4000-8000-000000000001`, `…0002`, `…0003`. UUID fijos para que los `EXPLAIN`
   de T3 sean reproducibles entre corridas y entre máquinas.
3. **Genera el volumen con `generate_series`**, no con un bucle de inserts fila por fila: tiene
   que cargar en menos de un minuto o nadie lo va a correr.
4. **Termina con `ANALYZE`** sobre todas las tablas que carga. Sin eso el planificador trabaja
   con estadísticas viejas y el `EXPLAIN` miente.
5. **Respeta todas las reglas del módulo.** Los movimientos se insertan en `movimientos_stock`
   y **la caché la mantiene el trigger**: el fixture **no escribe `existencias_lote`**. Si lo
   hiciera, el guardrail de RN-MV10 no lo vería (solo mira `src/modules/`) pero estaría
   generando un estado que el sistema real no puede producir. Al final del archivo, un
   `SELECT count(*) FROM verificar_existencias(<cada tenant>)` que tiene que dar **0**.

**Volumen por tenant**, calibrado sobre el de `EXPLAIN_INDICES.md` (que usaba 5.000 turnos y
13.000 registros de auditoría por tenant) y escalado a lo que el módulo comercial necesita:

| Tabla | Filas por tenant | Por qué ese número |
|---|---:|---|
| `familias_producto` | 15 | Suficiente para que el filtro por familia discrimine. |
| `productos` | 800 | El escenario de D-06.e: un catálogo con muchos derivados. Con 80 la búsqueda simple alcanza y el índice no se nota. |
| `proveedores` | 40 | |
| `producto_conversiones` | 200 | Una cuarta parte del catálogo es derivada. |
| `lotes` | 6.000 | ~7 lotes por producto. Es la tabla que sostiene FEFO. |
| `movimientos_stock` | **60.000** | La tabla más grande del módulo y la que decide todos los planes. 10 movimientos por lote. |
| `compras` / `compras_items` | 500 / 3.000 | |
| `sesiones_caja` | 400 | ~un año de sesiones diarias. |
| `movimientos_caja` | 25.000 | |
| `ventas` / `ventas_items` / `ventas_pagos` | 8.000 / 20.000 / 10.000 | |
| `recuentos` / `recuentos_detalle` | 20 / 2.000 | |

**Composición de los 60.000 movimientos**, para que los reportes de T2 tengan algo que reportar:

- ~30 % `entrada_compra`
- ~40 % `salida_venta`
- ~8 % `consumo_clinico` (con `historial_id` y `mascota_id` poblados — necesita eventos clínicos
  sintéticos, que el fixture también crea)
- ~10 % repartido entre `salida_conversion`, `entrada_conversion` y `merma_fraccionamiento`,
  **en operaciones completas de tres movimientos con `operacion_id` compartido y merma con costo
  cero**, para que RN-FR8 se pueda reverificar en T3
- ~12 % ajustes, mermas y movimientos de recuento

**Los costos tienen que variar entre lotes del mismo producto.** Si todos los lotes de un
producto tienen el mismo `costo_unitario_efectivo`, el reporte de rentabilidad da lo mismo
calculado bien o mal, y RN-MV6 no se puede reverificar sobre datos reales.

**Al menos un tenant tiene que quedar con lotes vencidos y lotes bloqueados**, para que los
reportes de rotación y los filtros FEFO tengan casos que excluir.

### 2.2. `package.json` y `scripts/README-volumen.md`

```json
"seed:volumen": "psql \"$DATABASE_URL\" -f supabase/seeds/volumen_comercial.sql"
```

El README explica, en no más de una pantalla: qué volumen genera, cuánto tarda, que es
idempotente, que no toca el tenant demo, y **por qué está versionado** —con la cita de
`EXPLAIN_INDICES.md`—. Ese último párrafo es el que evita que alguien lo mueva a `scratchpad/`
la próxima vez que estorbe.

### 2.3. Valorización de inventario a una fecha

**Desde el libro mayor, NO desde la caché.** `existencias_lote` dice cuánto hay **hoy**; la
pregunta *"¿cuánto stock tenía el 31 de diciembre para valuar el inventario?"* no la puede
responder, y ese es exactamente el argumento de reconstrucción histórica de D-02. Con libro mayor
es un `WHERE created_at <= fecha`.

```sql
CREATE OR REPLACE FUNCTION public.valorizacion_inventario_a_fecha(
  p_tenant_id UUID,
  p_fecha     DATE,
  p_familia_id UUID DEFAULT NULL
)
RETURNS TABLE (
  producto_id       UUID,
  producto_nombre   TEXT,
  familia_id        UUID,
  cantidad          NUMERIC(14,3),
  valor_total       NUMERIC(14,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- La existencia a una fecha es la suma firmada de los movimientos HASTA esa
  -- fecha. NO se lee existencias_lote: esa tabla es el saldo de HOY, y usarla
  -- acá daría la valorización de hoy con la etiqueta de otra fecha, que es el
  -- peor error posible en un reporte contable — el número parece razonable.
  WITH saldos AS (
    SELECT m.producto_id, m.lote_id, sum(m.cantidad_con_signo) AS cantidad
    FROM movimientos_stock m
    WHERE m.tenant_id = p_tenant_id
      AND m.created_at < (p_fecha + 1)          -- inclusive del día p_fecha
    GROUP BY m.producto_id, m.lote_id
    HAVING sum(m.cantidad_con_signo) <> 0
  )
  SELECT s.producto_id,
         p.nombre,
         p.familia_id,
         sum(s.cantidad)::NUMERIC(14,3),
         -- Valuado al costo EFECTIVO del lote, congelado al crearlo. Nunca a
         -- costo_reposicion: eso revaluaría hacia atrás mercadería comprada más
         -- barata e inventaría una ganancia que no ocurrió (D-04, RN-MV6).
         round(sum(s.cantidad * l.costo_unitario_efectivo), 2)::NUMERIC(14,2)
  FROM saldos s
  JOIN lotes     l ON l.id = s.lote_id     AND l.tenant_id = p_tenant_id
  JOIN productos p ON p.id = s.producto_id AND p.tenant_id = p_tenant_id
  WHERE (p_familia_id IS NULL OR p.familia_id = p_familia_id)
  GROUP BY s.producto_id, p.nombre, p.familia_id;
$$;

REVOKE ALL ON FUNCTION public.valorizacion_inventario_a_fecha(UUID, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valorizacion_inventario_a_fecha(UUID, DATE, UUID) TO service_role;
```

`created_at < (p_fecha + 1)` y no `created_at::date <= p_fecha`: la segunda forma aplica una
función sobre la columna y **el índice `idx_mov_producto` deja de servir**. Es la diferencia
entre un Index Scan y un Seq Scan sobre 60.000 filas, y T3 lo va a medir.

Cierre: marca `-- @modulo: comercial` y `NOTIFY pgrst, 'reload schema';`.

### 2.4. `stock.service.ts` y el endpoint

```ts
/**
 * Valorización de inventario a una fecha. Reconstruye desde el libro mayor.
 * NO usa existencias_lote: esa caché es el saldo de HOY (D-02).
 */
async valorizacionAFecha(fecha: string, ctx: CallerContext, familiaId?: string)
```

`GET /api/v1/existencias/valorizacion-a-fecha?fecha=2026-12-31&familiaId=…`, con `view_stock`.

**Si `fecha` no viene, es un 422, no "hoy" por defecto.** Un reporte de valorización sin fecha
explícita es el que después alguien imprime y archiva sin saber a qué momento corresponde.

### 2.5. Tests

**`tests/integration/reportes.integration.test.ts`** (crealo; corre **contra el fixture**):

| `it()` | Caso |
|---|---|
| `el fixture es idempotente` | Correr `volumen_comercial.sql` dos veces → los conteos de `productos`, `lotes` y `movimientos_stock` de los tres tenants sintéticos son idénticos. |
| `el fixture no toca el tenant demo` | Contar filas del tenant demo antes y después → sin cambios. |
| `el fixture deja la caché cuadrada` | `verificar_existencias(<cada tenant sintético>)` → **cero filas** en los tres. Es lo que prueba que el fixture no escribió `existencias_lote` a mano. |
| `el fixture tiene volumen suficiente` | `movimientos_stock` del tenant 1 ≥ 50.000; `productos` ≥ 700; `lotes` ≥ 5.000. Sin esta aserción, un fixture que falle a la mitad deja los `EXPLAIN` de T3 midiendo contra nada. |
| `la valorización a fecha reconstruye desde el libro mayor` | Sobre un producto del fixture: valorización al día **anterior** a su primera compra → **no aparece**. Al día de la compra → aparece con la cantidad comprada. Después de una venta, a la fecha de la venta → la cantidad bajó. Los tres momentos. |
| `la valorización a fecha NO es la de hoy` | Un producto que hoy tiene existencia 0 pero el 30 de junio tenía 100 → la valorización al 30 de junio devuelve **100**, no 0. **Es el test que distingue el libro mayor de la caché**, y el único que detecta si alguien "optimizó" la función leyendo `existencias_lote`. |
| `la valorización usa el costo del lote, no el de reposición` | Cambiar `productos.costo_reposicion` después de la compra → la valorización a fecha **no cambia**. |
| `la valorización no cruza tenants` | Los tres tenants sintéticos tienen valorizaciones distintas y ninguna incluye filas de otro. |

## 3. RN que cubre esta tanda

**Ninguna RN nueva.** C8 no agrega reglas: verifica sobre datos reales las que ya están. Lo que
esta tanda entrega es la **condición de posibilidad** de esa verificación.

| RN | Qué prepara esta tanda |
|---|---|
| RN-MV6 | El fixture con costos variables entre lotes, sin el cual el reporte de rentabilidad da lo mismo bien o mal calculado. La reverificación es en T3. |
| RN-FR8 | Las operaciones de fraccionamiento completas del fixture, con merma a costo cero. Reverificación en T3. |

**No toques ninguna fila de `MATRIZ_RN_TESTS_COMERCIAL.md` en esta tanda.**

## 4. Orden de trabajo

1. **Escribí el fixture primero**, antes que cualquier reporte. Correlo, medí cuánto tarda y
   anotalo en el README.
2. Corré los cuatro tests del fixture (idempotencia, tenant demo, caché cuadrada, volumen). Si el
   de la caché falla, el fixture está escribiendo `existencias_lote` a mano: sacá esa escritura y
   dejá que la mantenga el trigger.
3. Migración de la función, con marca y `NOTIFY`, aplicada.
4. `valorizacionAFecha` y su endpoint.
5. Los cuatro tests de valorización.
6. `npm test && npm run typecheck && npm run test:integration`.

## 5. Definición de hecho

```bash
# 1. EL FIXTURE ESTÁ VERSIONADO — es el entregable de esta tanda
git status --short supabase/seeds/volumen_comercial.sql
ls -la supabase/seeds/volumen_comercial.sql
# → el archivo existe en el repo. Si está en scratchpad/ o en /tmp, LA TANDA NO
#   ESTÁ HECHA: es exactamente el error que EXPLAIN_INDICES.md documenta.

# 2. Y no está ignorado por git
git check-ignore -v supabase/seeds/volumen_comercial.sql
# → sin resultados (si devuelve algo, .gitignore lo está excluyendo)

# 3. El fixture carga y deja la caché cuadrada
npm run seed:volumen
psql "$DATABASE_URL" -c "SELECT count(*) FROM verificar_existencias('aaaaaaaa-0000-4000-8000-000000000001');"
# → 0

# 4. Volumen suficiente para que el planificador elija índice
psql "$DATABASE_URL" -c "SELECT count(*) FROM movimientos_stock
  WHERE tenant_id='aaaaaaaa-0000-4000-8000-000000000001';"
# → >= 50000

# 5. El fixture terminó con ANALYZE
grep -c "ANALYZE" supabase/seeds/volumen_comercial.sql
# → >= 1

# 6. El fixture NO escribe existencias_lote
grep -niE "insert into existencias_lote|update existencias_lote" supabase/seeds/volumen_comercial.sql
# → SIN RESULTADOS. La caché la mantiene el trigger.

# 7. La valorización a fecha NO lee la caché
grep -n "existencias_lote" supabase/migrations/20261020000001_comercial_valorizacion_a_fecha.sql
# → SIN RESULTADOS

# 8. Ni el costo de reposición
grep -n "costo_reposicion" supabase/migrations/20261020000001_comercial_valorizacion_a_fecha.sql
# → SIN RESULTADOS

# 9. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/reportes.integration.test.ts
# → "N passed", "0 skipped"

# 10. Suites completas y los cuatro guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
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
`````

**C8·T2** — Cuando C8·T1 está en verde con el fixture cargado. · **Gemini Flash** · Entrega: los seis reportes restantes. Tanda mecánica sobre vistas que ya existen.

`````markdown
# ETAPA C8 · TANDA 2/3 — Los seis reportes comerciales
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C8·T1 en verde, con el fixture cargado y `verificar_existencias` en cero.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Tanda mecánica, y está bien que lo sea.** Son seis consultas de lectura sobre vistas que ya
> existen desde C4, C6 y C7. Lo único que hay que cuidar es que **ninguna recalcule un costo**:
> todas usan el costo efectivo guardado. Un join a `productos.costo_reposicion` es más corto de
> escribir y es el error R-03 de la spec.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §11 Etapa C8 | La lista de los reportes. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 | Las vistas que ya existen: `v_items_vendidos`, `v_margen_venta`, `v_costo_fraccionamiento`, `v_existencia_producto`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04 y §12.1 R-03 | Costo efectivo vs. costo de reposición, y por qué recalcular es el atajo que rompe la rentabilidad. |
| `supabase/migrations/20260922000004_comercial_vistas_venta.sql` | Tus vistas de C4·T4. |
| `supabase/migrations/20261006000002_comercial_vistas_fraccionamiento.sql` | Tus vistas de C6·T3. |
| `supabase/migrations/20261013000002_comercial_vistas_consumo.sql` | Tu vista de C7·T3. |
| `CLAUDE.md` sección de N+1 | Todos los reportes agregan datos relacionados: una consulta cada uno. |
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

1. `supabase/migrations/20261020000002_comercial_vistas_reportes.sql`
2. `supabase/functions/api/src/modules/reportes/reportes.schemas.ts`
3. `supabase/functions/api/src/modules/reportes/reportes.service.ts`
4. `supabase/functions/api/src/modules/reportes/reportes.controller.ts`
5. `tests/unit/reportes.service.test.ts`
6. `tests/unit/reportes.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/reportes", reportesRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"reportes"` a `MODULOS_COMERCIALES`. |
| `tests/integration/reportes.integration.test.ts` | Los casos de los seis reportes contra el fixture. |

**La valorización a fecha ya existe** desde C8·T1: se expone desde `stock`, no se duplica acá.

## 2. Especificación exacta

### 2.0. La regla que gobierna los seis

**Ningún reporte recalcula un costo.** Todos usan lo que quedó guardado cuando la operación
ocurrió: `movimientos_stock.costo_unitario`, `ventas_items.costo_unitario_efectivo`,
`lotes.costo_unitario_efectivo`. **Ninguno joinea `productos.costo_reposicion`.**

El costo de reposición sirve para **fijar el precio de venta**, porque el precio tiene que cubrir
reponer. El costo efectivo sirve para **valuar y calcular el margen histórico**. Los dos números
conviven y se muestran separados: el reporte de rentabilidad usa el primero, la pantalla de
fijación de precios el segundo. Mezclarlos es como se funde un negocio con inflación creyendo
que gana plata.

### 2.1. Rotación y productos sin movimiento

```sql
CREATE OR REPLACE VIEW public.v_rotacion_producto AS
SELECT p.tenant_id, p.id AS producto_id, p.nombre, p.familia_id, p.activo,
       COALESCE(e.cantidad_actual, 0)                    AS existencia_actual,
       COALESCE(s.salidas_90d, 0)                        AS salidas_90d,
       COALESCE(s.salidas_365d, 0)                       AS salidas_365d,
       ult.ultimo_movimiento_at,
       -- Días de cobertura: a la velocidad de salida de los últimos 90 días,
       -- cuánto dura lo que queda. NULL cuando no hubo salidas: dividir por cero
       -- daría "infinito", que en una pantalla se lee como un número.
       CASE WHEN COALESCE(s.salidas_90d, 0) > 0
            THEN round(COALESCE(e.cantidad_actual, 0) / (s.salidas_90d / 90.0), 1)
       END AS dias_cobertura
FROM productos p
LEFT JOIN (
  SELECT el.tenant_id, el.producto_id, sum(el.cantidad) AS cantidad_actual
  FROM existencias_lote el GROUP BY 1, 2
) e ON e.producto_id = p.id AND e.tenant_id = p.tenant_id
LEFT JOIN (
  SELECT m.tenant_id, m.producto_id,
         sum(CASE WHEN m.created_at >= now() - interval '90 days'
                   AND signo_movimiento(m.tipo) = -1 THEN m.cantidad ELSE 0 END) AS salidas_90d,
         sum(CASE WHEN m.created_at >= now() - interval '365 days'
                   AND signo_movimiento(m.tipo) = -1 THEN m.cantidad ELSE 0 END) AS salidas_365d
  FROM movimientos_stock m GROUP BY 1, 2
) s ON s.producto_id = p.id AND s.tenant_id = p.tenant_id
LEFT JOIN (
  SELECT m.tenant_id, m.producto_id, max(m.created_at) AS ultimo_movimiento_at
  FROM movimientos_stock m GROUP BY 1, 2
) ult ON ult.producto_id = p.id AND ult.tenant_id = p.tenant_id;
```

**"Productos sin movimiento" no es una vista aparte**: es esta misma con
`ultimo_movimiento_at IS NULL OR ultimo_movimiento_at < :fecha`. Crear dos vistas que difieren en
un `WHERE` es la clase de duplicación que después diverge.

### 2.2. Rentabilidad por producto y por familia

Sale de `v_margen_venta`, que ya existe desde C4·T4 y **ya usa el costo guardado**. El reporte
agrega:

```sql
CREATE OR REPLACE VIEW public.v_rentabilidad_producto AS
SELECT mv.tenant_id, mv.tipo_item, mv.item_id, mv.item_nombre,
       p.familia_id, f.nombre AS familia_nombre,
       count(*)                       AS lineas,
       sum(mv.cantidad)               AS unidades,
       sum(mv.importe_total)          AS facturado,
       sum(mv.neto_total)             AS neto,
       sum(mv.costo_total)            AS costo,
       sum(mv.margen)                 AS margen,
       CASE WHEN sum(mv.neto_total) > 0
            THEN round(sum(mv.margen) / sum(mv.neto_total) * 100, 2)
       END                            AS margen_porcentaje
FROM v_margen_venta mv
LEFT JOIN productos p         ON p.id = mv.item_id AND p.tenant_id = mv.tenant_id
                              AND mv.tipo_item = 'producto'
LEFT JOIN familias_producto f ON f.id = p.familia_id AND f.tenant_id = p.tenant_id
GROUP BY 1,2,3,4,5,6;
```

El `LEFT JOIN` a `productos` con la condición de `tipo_item` es lo que permite que las líneas de
servicio entren al reporte sin familia, que es correcto: un servicio no tiene familia de
producto. Es el costo de no fusionar los catálogos (D-10), y es todo el costo.

### 2.3. Costo de fraccionamiento

Ya existe: `v_costo_fraccionamiento`, de C6·T3. El reporte la agrega por producto de origen —
merma acumulada, sobrecosto acumulado, cantidad de operaciones, desvío promedio. **No crees una
vista nueva**: agregá sobre la que hay.

### 2.4. Ventas por usuario, por sesión y por medio de pago

```sql
CREATE OR REPLACE VIEW public.v_ventas_por_medio AS
SELECT v.tenant_id, v.sesion_caja_id, v.usuario_id, v.created_at::date AS fecha,
       mp.codigo AS medio_pago, mp.nombre AS medio_pago_nombre, mp.afecta_arqueo,
       count(DISTINCT v.id) AS ventas,
       sum(vp.importe)      AS importe
FROM ventas v
JOIN ventas_pagos vp ON vp.venta_id = v.id AND vp.tenant_id = v.tenant_id
JOIN medios_pago mp  ON mp.id = vp.medio_pago_id
WHERE v.estado = 'registrada'          -- las anuladas NO cuentan como venta
GROUP BY 1,2,3,4,5,6,7;
```

**`WHERE v.estado = 'registrada'` no es opcional.** Una venta anulada tiene contra-asientos de
existencia y de caja, pero su fila sigue en `ventas` (RN-VT4): si el reporte la contara, el total
vendido del turno no cerraría con el arqueo.

Los tres cortes —usuario, sesión, medio— salen de esta vista agrupando distinto. Una vista, tres
agrupaciones.

### 2.5. Consumo clínico por profesional y por especie

Sale de `v_consumo_clinico`, de C7·T3, que ya trae `professional_id` y `especie_id`. Agregación
por profesional y por especie con cantidad de consumos, unidades y costo total.

**Si C7 no está implementada**, este reporte no se puede escribir. C8 depende de C4, C6 **y C7**.
Verificalo antes de empezar:

```bash
psql "$DATABASE_URL" -c "SELECT viewname FROM pg_views WHERE viewname='v_consumo_clinico';"
```
Si no existe, **frená y reportá**.

### 2.6. Service, Controller y rutas

`ReporteService` con un método por reporte, todos con filtro de tenant y paginación, todos con
`desde`/`hasta` donde aplique.

```ts
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"),
  // Los reportes de venta y de rentabilidad exponen las ventas de TODOS los
  // usuarios: eso es view_sales (§8.2 decisión 3), que solo tiene el admin.
  // Los de stock y consumo van con view_stock.
];
```

| Método | Ruta | Módulo | Permiso |
|---|---|---|---|
| GET | `/api/v1/reportes/rotacion` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/sin-movimiento` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/rentabilidad` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/costo-fraccionamiento` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/ventas-por-medio` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/ventas-por-usuario` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/consumo-clinico` | `stock` | `view_stock` |

**Los tres reportes de venta exigen `view_sales`, no `manage_sales`.** La recepcionista registra
ventas y ve las suyas; un reporte de rentabilidad de toda la clínica es otra cosa.

Como el módulo requerido difiere por ruta, usá **dos routers** en el mismo archivo
(`reportesStockRouter` y `reportesVentasRouter`) y montalos los dos en `/reportes`, igual que
`main.ts` ya hace con `/doctores` (registros aditivos en el mismo prefijo).

### 2.7. Tests

**`tests/unit/reportes.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-MV6: ningún reporte joinea costo_reposicion` | Guardrail: el archivo del Service **no contiene** la cadena `costo_reposicion`. Escribilo como test. |
| `los siete reportes filtran por tenant` | Los siete `.eq("tenant_id", ctx.tenantId)`. |
| `la rentabilidad excluye las ventas anuladas` | Mock con una venta `anulada` → no entra en el total. |
| `no hay N+1 en ningún reporte` | Una llamada a `.from()` por reporte. |
| `sin fecha desde/hasta el reporte no barre todo` | Los reportes con rango tienen un default acotado (últimos 90 días), no "todo el historial". Sobre 60.000 movimientos la diferencia se nota. |

**`tests/unit/reportes.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo |
|---|:--:|:--:|:--:|:--:|
| `GET /reportes/rotacion` | 200 | 200 | 200 | 403 (`stock`) |
| `GET /reportes/rentabilidad` | 200 | **403** | **403** | 403 (`ventas`) |
| `GET /reportes/ventas-por-usuario` | 200 | **403** | **403** | 403 (`ventas`) |
| `GET /reportes/consumo-clinico` | 200 | 200 | 200 | 403 (`stock`) |

**En `tests/integration/reportes.integration.test.ts`, contra el fixture:**

| `it()` | Caso |
|---|---|
| `los siete reportes devuelven filas sobre el fixture` | Cada uno con al menos una fila para el tenant sintético 1. Un reporte que devuelve vacío contra 60.000 movimientos tiene un filtro mal. |
| `la rotación identifica productos sin movimiento` | El fixture deja al menos un producto sin movimientos → aparece en `/sin-movimiento` con `ultimo_movimiento_at` en `NULL`. |
| `las ventas por medio cuadran con el arqueo` | Para una sesión cerrada del fixture: la suma de los medios con `afecta_arqueo` del reporte **es igual** a `saldo_teorico_efectivo − saldo_inicial` de la sesión. Es la comprobación cruzada que detecta si el reporte cuenta ventas anuladas. |
| `el consumo clínico por profesional suma lo mismo que el costo por atención` | Los dos reportes, sobre el mismo rango, dan el mismo total. Salen de la misma vista y tienen que coincidir; si no, uno de los dos filtra de más. |
| `ningún reporte cruza tenants` | Los tres tenants sintéticos dan números distintos y ninguno incluye filas de otro. |

## 3. RN que cubre esta tanda

**Ninguna RN nueva.** La reverificación de RN-MV6 y RN-FR8 sobre datos reales es de C8·T3.
**No toques la matriz en esta tanda.**

## 4. Orden de trabajo

1. **Verificá que `v_consumo_clinico` existe** (2.5). Si no, frená y reportá: C8 depende de C7.
2. Migración de vistas, con marca, aplicada.
3. Tests unitarios en rojo, después el Service.
4. Controller, los dos routers, rutas en `main.ts`.
5. `"reportes"` a `MODULOS_COMERCIALES` en G1.
6. Los tests de integración contra el fixture.
7. `npm test && npm run typecheck && npm run test:integration`.

## 5. Definición de hecho

```bash
# 1. NINGÚN reporte recalcula el costo
grep -rn "costo_reposicion" supabase/functions/api/src/modules/reportes/ \
  supabase/migrations/20261020000002_comercial_vistas_reportes.sql
# → SIN RESULTADOS. Es R-03 y es el error más fácil de cometer acá.

# 2. La rentabilidad excluye las anuladas
grep -n "registrada" supabase/migrations/20261020000002_comercial_vistas_reportes.sql
# → aparece en v_ventas_por_medio; v_margen_venta ya lo filtraba desde C4·T4

# 3. Los reportes de venta exigen view_sales
grep -n "view_sales\|view_stock" supabase/functions/api/src/modules/reportes/reportes.controller.ts
# → view_sales en rentabilidad y en los dos de ventas; view_stock en el resto

# 4. Los siete reportes devuelven filas contra el fixture
npx vitest run --config vitest.integration.config.ts tests/integration/reportes.integration.test.ts
# → "N passed", "0 skipped"

# 5. Sin N+1
grep -n -A3 -E '\.(map|forEach)\(' supabase/functions/api/src/modules/reportes/reportes.service.ts | grep -c "await db"
# → 0

# 6. Tests y guardrails
npx vitest run tests/unit/reportes.service.test.ts tests/unit/reportes.controller.test.ts \
  tests/unit/tenant-filter-guardrail.test.ts
npm test && npm run typecheck
# → todo passed; el it.each de cobertura de G1 corre con 10 módulos
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
`````

**C8·T3** — Cuando C8·T2 está en verde. · **Gemini Flash** · Entrega: el `EXPLAIN` de los 17 listados, la reverificación de RN-MV6 y RN-FR8 sobre datos reales, **la checklist de cierre del módulo** y la matriz completa. Última tanda.

`````markdown
# ETAPA C8 · TANDA 3/3 — EXPLAIN, reverificación sobre datos reales y cierre del módulo
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C8·T2 en verde, con los siete reportes devolviendo filas sobre el fixture.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Última tanda del módulo comercial.** Entrega tres cosas: la evidencia de rendimiento de los
> listados nuevos, la reverificación de RN-MV6 y RN-FR8 **sobre 60.000 movimientos en vez de
> tres**, y la checklist de cierre que reemplaza a un tercer prompt de auditoría.
>
> Las dos RN que se reverifican son las que §12.1 marca como los errores que **funcionan
> perfecto en desarrollo**: con tres movimientos, un reporte que recalcula el costo da lo mismo
> que uno que lo lee, y una merma con costo imputado mueve el inventario tan poco que nadie lo
> nota. Con el fixture, no.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/EXPLAIN_INDICES.md` completo | **El método y el formato del entregable.** La tabla de "Resumen de decisión" con una fila por consulta, los bloques ANTES/DESPUÉS, y la sección de reproducción. Vas a escribir un documento con la misma forma. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §12.1 R-03 y R-05 | Los dos errores que esta tanda reverifica. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04 y D-06.b | Costo efectivo vs. reposición; merma con costo cero. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Los cinco índices de `movimientos_stock`, que son los que el `EXPLAIN` pone a prueba. |
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

1. `EXPLAIN_INDICES_COMERCIAL.md` — **en la raíz**, no en `/docs`, que es de solo lectura
2. `supabase/seeds/explain_comercial.sql` — las consultas del `EXPLAIN`, **versionadas**

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/reportes.integration.test.ts` | La reverificación de RN-MV6 y RN-FR8 sobre el fixture. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **El cierre: las 90 RN en ✅.** |
| `supabase/migrations/20261020000003_comercial_indices_reportes.sql` | **Solo si el `EXPLAIN` lo justifica.** Ver 2.3. |

**El archivo de consultas del `EXPLAIN` va versionado**, por el mismo motivo que el fixture:
`docs/EXPLAIN_INDICES.md` dice que `scratchpad/s10_explain.sql` tampoco se versionó y también se
perdió. La evidencia de rendimiento que no se puede volver a correr no es evidencia.

## 2. Especificación exacta

### 2.1. Las consultas a medir

Una por cada listado o reporte nuevo del módulo. **Las consultas reales de los services**, no
aproximaciones: reproducí los embeds de PostgREST como `LEFT JOIN` por PK del padre, tal como
hace `docs/EXPLAIN_INDICES.md`.

| # | Consulta | Filtro / orden | Índice que debería usar |
|---|---|---|---|
| C1 | Listado de productos (`productos.service`) | `tenant_id`, `activo`, `familia_id`; ord `created_at DESC` | `idx_productos_tenant_activo`, `idx_productos_tenant_familia` |
| C2 | Búsqueda de producto por nombre | `tenant_id`, `lower(nombre) ILIKE` | `idx_productos_tenant_nombre` |
| C3 | Búsqueda por código de barras | `tenant_id`, `codigo_barras` | `uq_productos_tenant_barras` |
| C4 | **Candidatos FEFO** (`stock.service`) | `tenant_id`, `producto_id`, `cantidad > 0`; ord vencimiento, ingreso, id | `idx_lotes_fefo` |
| C5 | **Kárdex por lote** (`stock.service`) | `tenant_id`, `lote_id`; ord `created_at` | `idx_mov_lote` |
| C6 | Movimientos por producto y rango | `tenant_id`, `producto_id`, `created_at` rango | `idx_mov_producto` |
| C7 | Movimientos de una operación | `tenant_id`, `operacion_id` | `idx_mov_operacion` |
| C8 | **Valorización a fecha** (C8·T1) | `tenant_id`, `created_at <` ; agrupa por producto y lote | `idx_mov_producto` |
| C9 | Listado de ventas | `tenant_id`; ord `created_at DESC` | `idx_ventas_tenant_fecha` |
| C10 | Ventas de un usuario (recepcionista sin `view_sales`) | `tenant_id`, `usuario_id`; ord `created_at DESC` | `idx_ventas_tenant_usuario` |
| C11 | Movimientos de una sesión de caja | `tenant_id`, `sesion_caja_id`; ord `created_at` | `idx_mov_caja_sesion` |
| C12 | **Trazabilidad lote → animal** (C7·T3) | `tenant_id`, `lote_id`, `tipo='consumo_clinico'` | `idx_mov_lote` |
| C13 | Trazabilidad mascota → lotes | `tenant_id`, `mascota_id`, `tipo='consumo_clinico'` | **ninguno hoy** — ver 2.3 |
| C14 | Consumos de un evento clínico | `tenant_id`, `historial_id` | `idx_mov_historial` |
| C15 | Rotación / sin movimiento | `tenant_id`, agregación sobre todo el libro mayor | agregación, se mide el costo |
| C16 | Rentabilidad por producto | `tenant_id`, rango de fecha | |
| C17 | Lotes por vencer | `tenant_id`, `fecha_vencimiento`, `estado='disponible'` | `idx_lotes_por_vencer` |

**C13 es la que probablemente falte.** `movimientos_stock` no tiene ningún índice que lidere por
`mascota_id`: la consulta "qué lotes recibió este animal" tendría que barrer la partición del
tenant. Es exactamente el mismo hallazgo que S10 tuvo con `idx_auditoria_usuario`. **No agregues
el índice por las dudas: medilo primero** y agregalo solo si el plan lo justifica (2.3).

### 2.2. Cómo se mide

```bash
PSQL="$DATABASE_URL"
npm run seed:volumen                                # el fixture de C8·T1
psql "$PSQL" -c "ANALYZE;"                          # estadísticas frescas
psql "$PSQL" -f supabase/seeds/explain_comercial.sql
```

Cada consulta con `EXPLAIN (ANALYZE, BUFFERS)`, medida sobre el tenant sintético
`aaaaaaaa-0000-4000-8000-000000000002` — el segundo, no el primero, con el mismo criterio de
`EXPLAIN_INDICES.md`: medir sobre un tenant que **no** es el primero de la tabla descarta que el
plan se beneficie de que sus filas estén físicamente juntas.

### 2.3. Cuándo agregar un índice — y cuándo no

**Nada especulativo.** Un índice se agrega **solo** si el plan medido lo justifica, y la
migración cita el plan de ANTES y el de DESPUÉS. Es el criterio con el que S10 agregó
`idx_auditoria_usuario` y con el que **descartó** pg_trgm para las búsquedas `ILIKE`: un
`Seq Scan` sobre 800 productos es aceptable y un índice ahí es mantenimiento sin beneficio.

Criterio concreto para decidir:

| Plan observado | Decisión |
|---|---|
| `Index Scan` o `Bitmap Index Scan` sobre el índice esperado | **Ya cubierto.** No se toca nada. |
| `Seq Scan` sobre una tabla de menos de ~5.000 filas | **Aceptable.** Anotalo y seguí. |
| `Seq Scan` + `Sort` sobre `movimientos_stock` (60.000 filas) para devolver 20 | **Índice justificado.** Es el caso de C13. |
| `Index Scan` sobre un índice distinto del esperado, con tiempo aceptable | **Aceptable**, pero anotá por qué el planificador prefirió el otro. |

Si agregás algún índice, va en `20261020000003_comercial_indices_reportes.sql`, con marca
`-- @modulo: comercial` y un comentario que cite el plan de ANTES.

### 2.4. `EXPLAIN_INDICES_COMERCIAL.md`

Mismo formato que `docs/EXPLAIN_INDICES.md`:

1. **Metodología** — stack, volumen del fixture (con los números reales que cargó), tenant
   medido, `ANALYZE`.
2. **Resumen de decisión** — la tabla de C1 a C17 con: consulta, filtro/orden, plan observado,
   índice, decisión (`Ya cubierto` / `Seq scan aceptable` / `Índice agregado`).
3. **Los gaps justificados** — para cada índice agregado, los bloques ANTES y DESPUÉS con el
   `EXPLAIN (ANALYZE, BUFFERS)` completo pegado, y el porqué en prosa.
4. **Reproducción** — los comandos exactos, **apuntando a archivos versionados del repo**:
   ```bash
   PSQL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
   npm run seed:volumen
   psql "$PSQL" -f supabase/seeds/explain_comercial.sql
   ```
   Y una línea diciendo que, a diferencia de los de la Etapa 9, **estos sí están versionados**.

### 2.5. Reverificación de RN-MV6 y RN-FR8 sobre datos reales

Es lo que el fixture hace posible, y la razón por la que C8 no agrega RN pero sí verifica dos.

| `it()` | Caso |
|---|---|
| `RN-MV6 sobre datos reales: cambiar costo_reposicion no mueve la rentabilidad` | (1) Correr el reporte de rentabilidad sobre el tenant sintético 1 y guardar el total. (2) `UPDATE productos SET costo_reposicion = costo_reposicion * 3` para **todos** los productos de ese tenant. (3) Correr el reporte otra vez → **el total es idéntico, al centavo**. (4) Dejar el costo como estaba. Con tres movimientos esto pasa aunque el reporte esté mal; con miles de líneas y costos variados entre lotes, un reporte que recalcule da distinto. |
| `RN-MV6 sobre datos reales: la valorización a fecha tampoco se mueve` | Lo mismo con `valorizacion_inventario_a_fecha`. |
| `RN-FR8 sobre datos reales: ninguna operación de fraccionamiento del fixture mueve el valor` | `SELECT operacion_id, sum(costo_total * signo_movimiento(tipo)) FROM movimientos_stock WHERE tipo IN ('salida_conversion','entrada_conversion','merma_fraccionamiento') AND tenant_id = <sintético 1> GROUP BY operacion_id HAVING abs(sum(...)) > 0.01` → **cero filas**, sobre las cientos de operaciones que el fixture generó. |
| `RN-FR8 sobre datos reales: ninguna merma de fraccionamiento tiene costo` | `SELECT count(*) FROM movimientos_stock WHERE tipo='merma_fraccionamiento' AND (costo_unitario <> 0 OR costo_total <> 0)` → **0**. |
| `el valor del inventario es el mismo por los dos caminos` | Valorización de hoy desde `valorizacion_inventario_a_fecha(hoy)` **es igual** a `sum(existencias_lote.cantidad * lotes.costo_unitario_efectivo)`. Los dos caminos —libro mayor y caché— tienen que dar lo mismo hoy; lo que los distingue es que solo el primero contesta por una fecha pasada. Es la comprobación cruzada más fuerte que hay del modelo de D-02. |

### 2.6. Checklist de cierre del módulo

**No hay un tercer prompt de auditoría** —la decisión fue tener solo dos, post-C2 y post-C6—, así
que los controles que aplican a lo que C7 y C8 agregaron corren acá, con el mismo formato de
comando y resultado esperado. Pegá los resultados en el reporte final.

```bash
# ── 1. Los cuatro guardrails, con cobertura de los diez módulos ──────────────
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → todo passed, 0 skipped. El it.each de cobertura de G1 corre con 10 módulos:
#   productos, proveedores, stock, compras, caja, ventas, ajustes,
#   fraccionamiento, consumo, reportes.

# ── 2. El RPC de C7 quedó cubierto por G3 sin que nadie tocara el guardrail ──
psql "$DATABASE_URL" -c "SELECT proname,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
  FROM pg_proc WHERE proname IN
  ('registrar_consumo_clinico','valorizacion_inventario_a_fecha','cadena_trazabilidad_lote');"
# → las tres filas con anon = f y auth = f

# ── 3. Toda migración comercial lleva su marca ───────────────────────────────
grep -L "@modulo: comercial" supabase/migrations/*_comercial_*.sql
# → sin salida

# ── 4. El módulo clínico sigue sin conocer el comercial (§10.3) ──────────────
grep -rn "movimientos_stock\|productos\|v_consumo_clinico" \
  supabase/functions/api/src/modules/historial/ supabase/functions/api/src/modules/vacunacion/
# → sin resultados

# ── 5. Ningún reporte recalcula un costo (R-03) ──────────────────────────────
grep -rn "costo_reposicion" supabase/functions/api/src/modules/reportes/ \
  supabase/functions/api/src/modules/stock/stock.service.ts
# → solo en lecturas de catálogo o de fijación de precios, nunca en un cálculo
#   de margen ni de valorización

# ── 6. Nada escribe la caché de existencias fuera del trigger ────────────────
npx vitest run tests/unit/stock-ledger-guardrail.test.ts
psql "$DATABASE_URL" -c "SELECT count(*) FROM verificar_existencias('aaaaaaaa-0000-4000-8000-000000000001');"
# → passed y 0

# ── 7. No existe ninguna operación irreversible con vuelta atrás ─────────────
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE
  proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%' OR
  proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%' OR
  proname ILIKE '%revertir%' OR proname ILIKE '%desanul%';"
# → cero filas

# ── 8. El puente a SIGTRAZAVET sigue sin construirse (RN-CC5, D-15) ─────────
psql "$DATABASE_URL" -c "SELECT count(*) FROM movimientos_stock
  WHERE trazabilidad_estado <> 'no_aplica' OR trazabilidad_referencia_externa IS NOT NULL;"
grep -rniE "sigtrazavet|senasa" supabase/functions/api/src/
# → 0 y sin resultados

# ── 9. Toda la suite, sin un solo skipped ────────────────────────────────────
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts 2>&1 | tail -20
# → "0 skipped". Un skipped significa que faltan las credenciales de
#   TEST_SUPABASE_* y que el módulo NO está verificado.

# ── 10. La matriz está completa ──────────────────────────────────────────────
grep -cE "^\| RN-[A-Z]+[0-9]+ \|" MATRIZ_RN_TESTS_COMERCIAL.md          # → 90
grep -cE "^\| RN-[A-Z]+[0-9]+ \|.*PENDIENTE" MATRIZ_RN_TESTS_COMERCIAL.md  # → 0
grep -cE "^\| RN-[A-Z]+[0-9]+ \|.*N/A" MATRIZ_RN_TESTS_COMERCIAL.md        # → 0
```

**El control 10 cambia respecto de C6·T4.** Ahí se esperaban 5 filas en `N/A` porque C7 no
existía; ahora las cinco RN-CC están implementadas y el `N/A` tiene que haber desaparecido. Si
sigue habiendo alguna, C7 no cerró.

## 3. RN que cubre esta tanda

**Ninguna nueva.** Reverifica dos sobre datos reales:

| RN | Qué agrega esta tanda |
|---|---|
| RN-MV6 | El reporte de rentabilidad y la valorización dan lo mismo después de triplicar `costo_reposicion`, sobre miles de líneas con costos variados entre lotes. |
| RN-FR8 | La suma firmada de costos es cero en **todas** las operaciones de fraccionamiento del fixture, no en una. |

## 4. Orden de trabajo

1. `supabase/seeds/explain_comercial.sql` con las 17 consultas.
2. Cargá el fixture, `ANALYZE`, corré los `EXPLAIN` y **pegá los planes crudos** en un borrador.
3. Completá la tabla de decisión de `EXPLAIN_INDICES_COMERCIAL.md`. **Decidí índice por índice
   con el criterio de 2.3**, no por costumbre.
4. Si algún plan lo justifica, la migración de índices, con el ANTES citado.
5. Los cinco tests de reverificación de 2.5.
6. **Corré la checklist de cierre de 2.6 entera** y pegá cada resultado en el reporte.
7. Cerrá `MATRIZ_RN_TESTS_COMERCIAL.md`: **las 90 RN en ✅, ninguna `PENDIENTE`, ninguna `N/A`.**

## 5. Definición de hecho

```bash
# 1. Los dos archivos de evidencia están VERSIONADOS
ls -la EXPLAIN_INDICES_COMERCIAL.md supabase/seeds/explain_comercial.sql
git check-ignore -v supabase/seeds/explain_comercial.sql EXPLAIN_INDICES_COMERCIAL.md
# → los dos existen y git NO los ignora. Si están en scratchpad/, la tanda no
#   está hecha: es el error que EXPLAIN_INDICES.md documenta y que C8 existe
#   para no repetir.

# 2. El documento tiene una fila por consulta medida
grep -cE "^\| C[0-9]+ \|" EXPLAIN_INDICES_COMERCIAL.md
# → 17

# 3. Todo índice agregado cita su plan de ANTES
grep -c "ANTES" EXPLAIN_INDICES_COMERCIAL.md
# → al menos 1 por índice agregado; 0 si no se agregó ninguno, y eso también
#   es un resultado válido que hay que declarar

# 4. La reverificación de RN-MV6 y RN-FR8
npx vitest run --config vitest.integration.config.ts tests/integration/reportes.integration.test.ts
# → "N passed", "0 skipped"

# 5. La checklist de cierre (2.6) entera, con sus diez resultados en el reporte

# 6. La matriz completa
grep -cE "^\| RN-[A-Z]+[0-9]+ \|.*✅" MATRIZ_RN_TESTS_COMERCIAL.md
# → 90
```

**En el reporte final, obligatorio:**

1. Los **diez resultados** de la checklist de cierre de 2.6.
2. La tabla de decisión de índices: cuántos ya estaban cubiertos, cuántos `Seq Scan` se
   declararon aceptables y **por qué**, y cuántos índices se agregaron con su justificación.
3. El estado final de la matriz: 90 en ✅, 0 pendientes, 0 en `N/A`.
4. **Qué quedó fuera del módulo y sigue fuera**: C9 (cuenta corriente, condicional a P-03),
   facturación electrónica, el puente a SIGTRAZAVET, la tabla `receta`, depósitos múltiples,
   cadena de frío y órdenes de compra con aprobación. Las columnas reservadas existen; las
   features, no. Decilo explícitamente para que nadie lo descubra buscándolo.
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
`````

