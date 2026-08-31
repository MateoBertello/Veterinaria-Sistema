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
