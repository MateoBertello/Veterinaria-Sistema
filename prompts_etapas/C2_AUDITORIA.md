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
