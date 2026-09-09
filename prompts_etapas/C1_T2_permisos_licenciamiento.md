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
