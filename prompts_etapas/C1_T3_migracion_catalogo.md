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
