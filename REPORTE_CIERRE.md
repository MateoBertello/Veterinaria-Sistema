# Reporte de cierre — Módulo Comercial (rama `fix/auditoria-comercial`)

Fecha: 2026-09-04 · Base: Supabase local, `supabase db reset` antes de cada verificación.

Cada corrección se demuestra rompiéndola y mostrando el rojo. Las salidas de
abajo están pegadas tal cual salieron.

---

## Resumen

| # | Corrección | Estado | Evidencia |
|---|---|---|---|
| 1 | `ADENDA_SPEC_COMERCIAL.md` §4.7 reescrita contra el RPC vivo | Hecha | §1 |
| 2 | `signo_movimiento` / `signo_movimiento_caja` sin `ELSE` + guardrail | Hecha | §2, mutaciones (a)–(d) |
| 3a | Seed de volumen movido a `[db.seed]` de `config.toml` | Hecha (no había motivo para el `execSync`) | §3a |
| 3b | `alta@test.com` limpiada en el `afterAll` de `admin.integration.test.ts` | Hecha | §3b |
| 4 | Deuda de `movimientos_stock.mascota_id` anotada, sin corregir | Anotada | §4 |

Archivos tocados:

```
ADENDA_SPEC_COMERCIAL.md                                              (§4.7 + deuda anotada)
supabase/migrations/20261029000002_signo_movimiento_enumeracion_exhaustiva.sql   (nuevo)
tests/unit/signo-movimiento.test.ts                                   (nuevo, guardrail)
supabase/config.toml                                                  ([db.seed])
tests/integration/reportes.integration.test.ts                        (sin execSync)
tests/integration/admin.integration.test.ts                           (afterAll)
tests/README.md                                                       (nuevo)
REPORTE_CIERRE.md                                                     (nuevo)
```

---

## 1. §4.7 — reescrita contra el RPC, no contra la memoria

Antes de escribir se leyó `supabase/migrations/20261028000003_venta_numeracion_al_final.sql`
completo (597 líneas). Lo que decía la adenda y lo que hace el RPC:

| La adenda decía | El RPC hace |
|---|---|
| La numeración va "estrictamente al final del RPC" | Va en el paso 7 (líneas 493–505), con tres pasos después: pagos y caja (507–538), stock mínimo (540–570), auditoría (572–588) |
| "una vez concluidas con éxito todas las validaciones de negocio" | Quedan dos `RAISE` después: `VALIDATION_ERROR` por medio de pago inexistente (línea 516) y `PAYMENT_REFERENCE_REQUIRED` por RN-CJ9 (línea 521) |
| "y el registro de asientos en el libro mayor" | Cierto para `movimientos_stock` (paso 6), falso para caja: `movimientos_caja` se inserta **después** (línea 530) |
| El motivo es evitar gaps | `contadores_tenant` es una TABLA, no una `SEQUENCE`: el incremento es un `UPDATE` transaccional y un `RAISE` lo revierte esté donde esté. El RPC no tiene ningún bloque `EXCEPTION` (verificado: cero `EXCEPTION` que no sean `RAISE EXCEPTION`) |

El motivo real está escrito en el propio RPC, comentario del paso 5, línea 285:

```
  -- ── 5. Inserción inicial de la venta (sin numero_operacion para no serializar)
```

El `UPDATE contadores_tenant SET valor = valor + 1` toma un lock de fila sobre
`(tenant_id,'venta')` hasta el `COMMIT`; toda otra venta del mismo tenant se
serializa detrás. Poniéndolo después del bucle FEFO —que hace `SELECT ... FOR UPDATE`
sobre las existencias (paso 3, líneas 243–253) y un `INSERT` en `movimientos_stock`
por lote— el contador queda tomado sólo durante los pasos 7 a 10 en vez de durante
toda la venta. En la versión anterior (`20260922000002`, líneas 281–289) la
numeración iba antes del `INSERT` de la venta y el contador quedaba bloqueado de
punta a punta.

La sección reescrita dice eso, cita las líneas, y agrega un bloque
**"Lo que no es el motivo"** para que la explicación del gap no vuelva a aparecer.
El primer bullet no se tocó. El título pasó de "se asigna al final del RPC" a
"se asigna después del descuento de stock" — era falso en el mismo sentido; el
número de sección `§4.7`, que es por donde la referencian `PROMPTS_ETAPAS.md` y
`prompts_etapas/`, no cambió.

---

## 2. `signo_movimiento` y `signo_movimiento_caja` — se fue el `ELSE`

`supabase/migrations/20261029000002_signo_movimiento_enumeracion_exhaustiva.sql`:

- `signo_movimiento`: los 15 valores de `tipo_movimiento_stock` enumerados uno por
  uno (6 entradas `+1`, `merma_fraccionamiento` `0`, 8 salidas `-1`). Sin `ELSE`.
- `signo_movimiento_caja`: los 7 de `tipo_movimiento_caja` (3 ingresos `+1`,
  4 egresos `-1`). Sin `ELSE`.
- Las dos siguen siendo `LANGUAGE sql IMMUTABLE`, como exige la columna generada
  `cantidad_con_signo` para ser inlineable.

Dos agregados para que el `NULL` resultante sea ruidoso y no sólo distinto:

- `movimientos_stock.cantidad_con_signo` pasa a `NOT NULL`. Sin eso el `NULL` se
  guardaba y el error aparecía recién en el trigger de `existencias_lote`, en otra
  tabla. Ahora lo rechaza la propia fila.
- `movimientos_caja` gana `CHECK (signo_movimiento_caja(tipo) IS NOT NULL)`. En caja
  el `NULL` sería **más** silencioso que el `-1`: `cerrar_sesion_caja` calcula el
  arqueo teórico con `COALESCE(sum(importe * signo_movimiento_caja(tipo)), 0)` y
  `sum()` **ignora** los `NULL` — el movimiento simplemente no contaría y el faltante
  aparecería como diferencia de caja de un cajero. Ver §2.d.3.

Guardrail: `tests/unit/signo-movimiento.test.ts` (20 tests). Lee los valores de cada
enum desde las migraciones (`CREATE TYPE` + todos los `ALTER TYPE ... ADD VALUE`),
resuelve la **última** definición de cada función (la que gana en la base), y exige
un `WHEN` explícito por valor. Sin allowlist. Verifica además que no vuelva un `ELSE`
y que la función siga siendo `sql IMMUTABLE`. Fail-safe: si no puede resolver una
función o un enum, falla en vez de saltear. Incluye 12 autoverificaciones por
mutación sobre fragmentos sintéticos.

### (a) `entrada_donacion` en el enum, función sin tocar → guardrail ROJO

Migración temporal con `ALTER TYPE tipo_movimiento_stock ADD VALUE IF NOT EXISTS 'entrada_donacion';`:

```
 ❯ tests/unit/signo-movimiento.test.ts  (20 tests | 1 failed) 13ms
   ❯ BLOQUEANTE: 'signo_movimiento' cubre todos los valores de 'tipo_movimiento_stock'
     > ningún valor de tipo_movimiento_stock queda sin rama explícita en signo_movimiento()
     → 1 valor(es) de tipo_movimiento_stock sin rama WHEN en signo_movimiento()
       (definición vigente: 20261029000002_signo_movimiento_enumeracion_exhaustiva.sql):
  'entrada_donacion'

Un tipo sin rama devuelve NULL y `movimientos_stock.cantidad_con_signo` (NOT NULL desde
20261029000002) rechaza el INSERT. Con el ELSE que había antes recibía -1 en silencio y
una ENTRADA restaba stock.
Agregá la rama en una migración nueva con CREATE OR REPLACE FUNCTION signo_movimiento.:
expected [ 'entrada_donacion' ] to deeply equal []

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

### (b) Insertar un `entrada_donacion` → falla ruidoso, no resta stock

Con el valor en el enum y el fixture de volumen cargado. Lote del tenant A con
existencia 95. Primero el contraste: dentro de una transacción se restaura la
función vieja (con `ELSE -1`) para mostrar qué pasaba antes.

```
--- existencia ANTES: 95.000

=== (b.1) CONTRASTE: con el ELSE -1 que había antes, la entrada RESTA ===
INSERT 0 1
       tipo       | cantidad | cantidad_con_signo
------------------+----------+--------------------
 entrada_donacion |    5.000 |             -5.000

 antes  | despues | delta
--------+---------+--------
 95.000 |  90.000 | -5.000
ROLLBACK

=== (b.2) Con la función nueva (sin ELSE) el mismo INSERT falla ===
ERROR:  null value in column "cantidad_con_signo" of relation "movimientos_stock"
        violates not-null constraint
DETAIL:  Failing row contains (f0cb94b3-70f2-45e2-a338-f410f89bf12d,
         11111111-1111-1111-1111-111111111111, ..., entrada_donacion, ..., 5.000, null, ...).

--- existencia DESPUES del intento fallido:
 cantidad
----------
   95.000

 movimientos_entrada_donacion
------------------------------
                            0
```

Una entrada de 5 unidades restaba 5. Ahora el `INSERT` se rechaza, la existencia
queda en 95 y no hay fila escrita.

### (c) `supabase db reset` → enum de vuelta en 15

```
 typname               | count
-----------------------+-------
 tipo_movimiento_caja  |     7
 tipo_movimiento_stock |    15
```

### (d) Lo mismo en caja con un `ingreso_*` nuevo

`ALTER TYPE tipo_movimiento_caja ADD VALUE IF NOT EXISTS 'ingreso_subsidio';`

**(d.1) Guardrail ROJO:**

```
 ❯ tests/unit/signo-movimiento.test.ts  (20 tests | 1 failed) 12ms
   ❯ BLOQUEANTE: 'signo_movimiento_caja' cubre todos los valores de 'tipo_movimiento_caja'
     > ningún valor de tipo_movimiento_caja queda sin rama explícita en signo_movimiento_caja()
     → 1 valor(es) de tipo_movimiento_caja sin rama WHEN en signo_movimiento_caja()
       (definición vigente: 20261029000002_signo_movimiento_enumeracion_exhaustiva.sql):
  'ingreso_subsidio'

Un tipo sin rama devuelve NULL y el CHECK chk_mov_caja_signo_definido rechaza el INSERT.
Sin eso, `sum()` en el arqueo teórico de cerrar_sesion_caja (RN-CJ2) IGNORA los NULL: el
movimiento no contaría y el faltante aparecería como diferencia de caja de un cajero.
Agregá la rama en una migración nueva con CREATE OR REPLACE FUNCTION signo_movimiento_caja.:
expected [ 'ingreso_subsidio' ] to deeply equal []

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

**(d.2) Contraste con el `ELSE -1` viejo — un ingreso de $1000 RESTA del arqueo:**

```
       tipo       | importe | signo | aporte_al_arqueo
------------------+---------+-------+------------------
 ingreso_subsidio | 1000.00 |    -1 |         -1000.00
ROLLBACK
```

**(d.3) Con la función nueva + CHECK, el INSERT falla; y sin el CHECK el NULL sería mudo:**

```
ERROR:  new row for relation "movimientos_caja" violates check constraint
        "chk_mov_caja_signo_definido"
DETAIL:  Failing row contains (..., ingreso_subsidio, ..., 1000.00, ...).

--- sin el CHECK, el NULL sería MUDO en el arqueo (sum ignora NULL):
 signo | teorico_con_una_fila_null
-------+---------------------------
       |                         0

 movimientos_ingreso_subsidio
------------------------------
                            0
```

El `signo` sale vacío (NULL) y el teórico da 0: los $1000 desaparecen del arqueo sin
un solo error. Por eso el rechazo va en el `INSERT` — `movimientos_caja` es append-only
(trigger `movimientos_caja_inmutable`), así que validar en la entrada alcanza.

---

## 3a. El seed de volumen: no había motivo, se movió a `config.toml`

**Lo que había:** `reportes.integration.test.ts`, en el `beforeAll`,
`execSync("docker exec -i supabase_db_Veterinaria-Sistema psql -U postgres -d postgres < seed.sql")`.

**Se buscó el motivo y no aparece ninguno.** Al contrario, tres problemas concretos:

1. Hardcodea `supabase_db_Veterinaria-Sistema`, que es
   `supabase_db_<nombre-del-directorio>`: clonar el repo en otra carpeta rompe la suite
   con un error de docker que no habla del test.
2. Ignora a dónde apuntan los tests. `tests/integration/_env.ts` permite apuntar la
   suite a otro Supabase con `TEST_SUPABASE_URL`; el `docker exec` escribe siempre en
   el contenedor local, así que contra un destino remoto sembraría una base y
   aseveraría contra otra.
3. Exige docker desde el proceso de test, para una suite que por lo demás sólo habla
   HTTP con Supabase.

El único requisito real del fixture es que escribe directo en `auth.users`, lo que pide
el rol `postgres` — no alcanza la service-role key de `scripts/seed.mjs`. Eso explica
por qué es SQL aplicado por la CLI, no por qué tenía que aplicarlo un test.
`[db.seed]` en `config.toml` es exactamente donde la CLI espera ese SQL, y comparte el
alcance (`supabase db reset` local), con lo cual el dato de que la integración no corre
en CI (`ci.yml` sólo hace `typecheck` + `test:unit`) no cambia nada: ninguna de las dos
formas corría en CI.

`reportes.integration.test.ts` ya no siembra: verifica que el fixture esté y si falta
falla diciendo por qué. Documentado en `tests/README.md`.

**Mutación:** `[db.seed] enabled = false` + `supabase db reset` → la base queda sin
fixture (lo que confirma que el seed viene de ahí y de ningún otro lado) y la suite
falla ruidosa en vez de reportar cero:

```
 movs
------
    0

Error: Falta el fixture de volumen (supabase/seeds/comercial_volumen_seed.sql).
Lo aplica `supabase db reset` desde [db.seed] en supabase/config.toml: corré
`supabase db reset` antes de la suite. Ver tests/README.md.
 Test Files  1 failed (1)
```

Con `enabled = true`: `Seeding data from supabase/seeds/comercial_volumen_seed.sql...`
y 618 movimientos / 3 tenants / 36 productos en la base.

## 3b. `alta@test.com`

`POST /admin/tenants` (RN-SA2) invita por email a la cuenta de contacto vía
`TenantService.crear` → `inviteUserByEmail`
(`supabase/functions/api/src/modules/admin/tenants.service.ts:189`). Queda en
`auth.users` sin fila en `usuarios`, y `limpiarTenant` recorre tablas de negocio: no la
ve. Se agrega `borrarUsuarioAuthPorEmail("alta@test.com")` al `afterAll`.

**Mutación** — con la línea comentada, la suite queda igual de verde y la cuenta sobrevive:

```
--- corrida con la limpieza DESACTIVADA ---
 Test Files  1 passed (1)
      Tests  6 passed (6)

     email
---------------
 alta@test.com

--- corrida con la limpieza ACTIVADA ---
 Test Files  1 passed (1)
      Tests  6 passed (6)

 quedan_alta_test
------------------
                0
```

Es la misma clase de huérfana que motivó H3: no la borra ninguna FK y el verde no la
delata.

---

## 4. Deuda anotada (no corregida)

Anotada al final de `ADENDA_SPEC_COMERCIAL.md`: `movimientos_stock.mascota_id` se
escribe (48 de 618 filas no nulas, verificado en la base de volumen) y no se lee nunca.
La trazabilidad por mascota va por `v_consumo_clinico`, que proyecta `mascota_id` desde
`historial_clinico.pet_id` y llega a los movimientos por `idx_mov_historial`.
`idx_mov_mascota` se eliminó con razón; queda anotado que un reporte futuro que consulte
`movimientos_stock` directo quedaría sin índice. **No se corrigió**, por pedido explícito.

---

## Cierre

```
$ npm run typecheck
> tsc -p supabase/functions/api/tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit
(sin salida — rc=0)

$ npm test
 Test Files  67 passed (67)
      Tests  929 passed (929)
```

`test:integration`, tres corridas:

| Corrida | Base | Resultado |
|---|---|---|
| 1 | `supabase db reset` inmediatamente antes | `Test Files 30 passed (30)` · `Tests 512 passed (512)` |
| 2 | la misma base de la corrida 1, sin reset (prueba de repetibilidad) | `Test Files 30 passed (30)` · `Tests 512 passed (512)` |
| 3 | `supabase db reset` otra vez | `Test Files 30 passed (30)` · `Tests 512 passed (512)` |

Cero skipped en las tres: vitest no imprimió ninguna línea `skipped`, y
`describeIntegration` sólo saltea si faltan las variables de entorno del arnés — están
las tres. La corrida 2 se hizo sin reset a propósito: es la que verifica que la suite
no se deje residuo, y después de ella `auth.users` tenía las 9 cuentas del fixture y
ninguna huérfana.

Estado final de la base:

```
 enum_stock | enum_caja | idx_mov_mascota
------------+-----------+-----------------
         15 |         7 |               0
```

Enum de stock en 15 valores, el de caja en 7, `idx_mov_mascota` ausente.
