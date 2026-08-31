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
