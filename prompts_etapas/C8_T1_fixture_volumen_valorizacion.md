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
