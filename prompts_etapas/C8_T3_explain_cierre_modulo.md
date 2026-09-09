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
