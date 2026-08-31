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
