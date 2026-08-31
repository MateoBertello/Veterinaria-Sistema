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
