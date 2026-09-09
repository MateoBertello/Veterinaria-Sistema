# ETAPA C5 · TANDA 3/4 — RPC `aplicar_recuento`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5·T2 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **La sutileza de esta tanda es una sola y hay que implementarla bien:** entre que se empieza a
> contar y que se aplica el recuento, **se sigue vendiendo**. Si `cantidad_sistema` se congela
> al abrir el borrador, se generan ajustes que **borran ventas reales**. Se recalcula **al
> aplicar**, y si cambió respecto de lo que vio el usuario, el RPC devuelve una advertencia con
> los lotes que se movieron y exige confirmación explícita.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.9 | La sutileza de `cantidad_sistema`, textual. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.9 | RN-AJ3 y RN-AJ6. |
| `supabase/migrations/20260929000001_comercial_recuentos.sql` | Tu migración de C5·T1: `cantidad_sistema` es nullable a propósito. |
| `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql` | `ajustar_existencia` y `motivo_valido`, que este RPC reusa. |
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

1. `supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ajustes.integration.test.ts` | RN-AJ3 y RN-AJ6. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-AJ3, AJ6 — y con eso, **las 7 RN-AJ cerradas**. |

## 2. Especificación exacta

```
aplicar_recuento(
  p_tenant_id UUID, p_usuario_id UUID, p_recuento_id UUID,
  p_confirmar_desvios BOOLEAN DEFAULT false
)
RETURNS TABLE (recuento_id UUID, operacion_id UUID,
               ajustes_generados INTEGER, lotes_movidos JSONB)
```

```
BEGIN
  SELECT * INTO v_recuento FROM recuentos
   WHERE id = p_recuento_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_NOT_FOUND'; END IF;

  -- RN-AJ6: aplicar un recuento es IRREVERSIBLE. Aplicar dos veces falla.
  IF v_recuento.estado = 'aplicado' THEN RAISE EXCEPTION 'COUNT_ALREADY_APPLIED'; END IF;
  IF v_recuento.estado <> 'borrador' THEN RAISE EXCEPTION 'COUNT_ALREADY_APPLIED'; END IF;

  IF NOT EXISTS (SELECT 1 FROM recuentos_detalle
                  WHERE recuento_id = p_recuento_id AND tenant_id = p_tenant_id)
     THEN RAISE EXCEPTION 'COUNT_WITHOUT_DETAIL'; END IF;

  -- ── BLOQUEO de todos los lotes del recuento, ORDENADO POR lote_id ─────────
  -- Mismo criterio que registrar_venta: el orden fijo elimina el deadlock entre
  -- un recuento y una venta que toquen los mismos lotes.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id
     AND lote_id IN (SELECT lote_id FROM recuentos_detalle
                      WHERE recuento_id = p_recuento_id AND tenant_id = p_tenant_id)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── RN-AJ3: la cantidad de sistema se congela AHORA, no al abrir el borrador ──
  -- Entre que se contó y que se aplica, se siguió vendiendo. Si se hubiera
  -- congelado al abrir, los ajustes que salen de acá BORRARÍAN esas ventas.
  --
  -- `lotes_movidos` son los lotes cuya existencia cambió respecto de lo que el
  -- usuario tenía en pantalla. Se detecta comparando la existencia ACTUAL contra
  -- la que quedó guardada en cantidad_sistema si el borrador ya la tenía (una
  -- pre-carga informativa), o contra la que el cliente mandó al abrir el conteo.
  SELECT jsonb_agg(jsonb_build_object(
           'loteId', d.lote_id,
           'cantidadVistaPorElUsuario', d.cantidad_sistema,
           'cantidadActual', e.cantidad))
    INTO v_lotes_movidos
    FROM recuentos_detalle d
    JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
   WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
     AND d.cantidad_sistema IS NOT NULL
     AND d.cantidad_sistema <> e.cantidad;

  IF v_lotes_movidos IS NOT NULL AND NOT p_confirmar_desvios THEN
    -- El usuario tiene que ver QUÉ se movió antes de decidir. Se devuelven los
    -- lotes en el mensaje, como hace CUPO_GUARDERIA_AGOTADO con los días llenos.
    RAISE EXCEPTION 'COUNT_STALE:%', v_lotes_movidos::text;
  END IF;

  v_operacion := gen_random_uuid();

  -- ── Un ajuste por cada lote con diferencia, EN UNA SOLA OPERACIÓN ─────────
  FOR v_det IN SELECT d.*, e.cantidad AS existencia_actual, l.producto_id,
                      l.costo_unitario_efectivo
                 FROM recuentos_detalle d
                 JOIN existencias_lote e ON e.lote_id = d.lote_id AND e.tenant_id = p_tenant_id
                 JOIN lotes l            ON l.id = d.lote_id      AND l.tenant_id = p_tenant_id
                WHERE d.recuento_id = p_recuento_id AND d.tenant_id = p_tenant_id
                ORDER BY d.lote_id
  LOOP
      -- Se GUARDA la cantidad de sistema del momento de aplicar.
      v_diferencia := v_det.cantidad_contada - v_det.existencia_actual;

      UPDATE recuentos_detalle
         SET cantidad_sistema = v_det.existencia_actual,
             diferencia       = v_diferencia
       WHERE id = v_det.id AND tenant_id = p_tenant_id;

      CONTINUE WHEN v_diferencia = 0;   -- sin diferencia, sin asiento

      -- sobrante_recuento (+) o faltante_recuento (−). Los dos tipos existen en
      -- el ENUM desde C1·T1 justamente para que el recuento no use
      -- entrada_ajuste/salida_ajuste y se pueda reportar aparte.
      INSERT INTO movimientos_stock (
        tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
        costo_unitario, costo_total, motivo, recuento_id, usuario_id
      ) VALUES (
        p_tenant_id, v_operacion,
        CASE WHEN v_diferencia > 0 THEN 'sobrante_recuento' ELSE 'faltante_recuento' END,
        v_det.producto_id, v_det.lote_id, abs(v_diferencia),
        v_det.costo_unitario_efectivo,
        round(abs(v_diferencia) * v_det.costo_unitario_efectivo, 2),
        COALESCE(v_det.motivo, 'Ajuste por recuento físico'),
        p_recuento_id, p_usuario_id
      );
      v_ajustes := v_ajustes + 1;
  END LOOP;

  -- RN-AJ6: irreversible.
  UPDATE recuentos
     SET estado = 'aplicado', aplicado_at = now(), aplicado_por_usuario_id = p_usuario_id
   WHERE id = p_recuento_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'inventory', p_recuento_id::text,
    jsonb_build_object('ajustes', v_ajustes, 'operacion_id', v_operacion));

  RETURN QUERY SELECT p_recuento_id, v_operacion, v_ajustes, v_lotes_movidos;
END;
```

**Los movimientos del recuento llevan `recuento_id`**, y el CHECK de coherencia documental de
C2·T1 exige que **solo** `sobrante_recuento` y `faltante_recuento` lo lleven. Verificá que tu
CHECK lo permite; si lo prohíbe, la migración de C2·T1 tenía el CHECK mal y hay que **frenar y
reportar**, no relajarlo desde acá.

**Los ajustes se generan en UNA operación** (`operacion_id` compartido). Eso es lo que permite
después preguntar "qué cambió el recuento del 30 de septiembre" con una sola consulta.

**El `RAISE EXCEPTION 'COUNT_STALE:%'` lleva el JSON adjunto**, igual que
`CUPO_GUARDERIA_AGOTADO` lleva los días sin cupo. El Service parsea lo que viene después de los
dos puntos y lo pone en `details` del `DomainError`. Es lo que hace que la advertencia sea
accionable en vez de un "algo cambió, fijate".

**No existe `revertir_recuento`.** Un recuento mal aplicado se corrige con ajustes motivados,
igual que todo lo demás.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.2. Tests

| `it()` | Caso |
|---|---|
| `RN-AJ3: el recuento congela la cantidad de sistema AL APLICAR` | (1) Lote con existencia 10. (2) Abrir recuento y cargar detalle con `cantidad_contada = 10` y `cantidad_sistema = 10` (lo que el usuario vio). (3) **Vender 3 del lote** → existencia 7. (4) `aplicar_recuento` sin `p_confirmar_desvios` → falla con `COUNT_STALE`, y el mensaje **contiene el `loteId`** con `cantidadVistaPorElUsuario: 10` y `cantidadActual: 7`. (5) `aplicar_recuento` con `p_confirmar_desvios = true` → funciona, y el ajuste generado es **+3** (10 contados − 7 actuales), **no 0**. (6) La existencia final es **10**, la que se contó. Los seis pasos. |
| `RN-AJ3: sin desvíos no pide confirmación` | Sin ventas entre medio → `aplicar_recuento` sin confirmar funciona directo. |
| `RN-AJ3: el ajuste NO borra la venta` | Después del paso 5, el `salida_venta` de los 3 **sigue en el kárdex**, y hay un `sobrante_recuento` de 3 al lado. La venta no desapareció: el recuento la reconoció. |
| `RN-AJ6: aplicar un recuento es irreversible` | Aplicar dos veces → `COUNT_ALREADY_APPLIED`. Y `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%revertir_recuento%'` → 0. |
| `RN-AJ6: un recuento sin detalle no se aplica` | Recuento en borrador sin filas de detalle → `COUNT_WITHOUT_DETAIL`. |
| `los ajustes del recuento comparten operacion_id` | Recuento con 3 lotes con diferencia → 3 movimientos con el **mismo** `operacion_id` y con `recuento_id` apuntando al recuento. |
| `un lote sin diferencia no genera asiento` | Recuento de 3 lotes donde 1 cuadra → **2** movimientos, no 3. Un asiento de cantidad 0 violaría el `CHECK (cantidad > 0)`. |

**El paso 5 de RN-AJ3 es el que define si esto está bien implementado.** Si `cantidad_sistema`
se hubiera congelado al abrir el borrador, el ajuste sería 0 (10 contados − 10 congelados) y la
venta de 3 quedaría **borrada del inventario**: la existencia terminaría en 7 con el sistema
creyendo que hay 10.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-AJ3 | El recuento congela la cantidad de sistema **al aplicar**; si hubo movimientos, advierte y exige confirmación. → `409 COUNT_STALE` | `it('RN-AJ3: el recuento congela la cantidad de sistema AL APLICAR', …)` |
| RN-AJ6 | Aplicar un recuento es irreversible. → `409 COUNT_ALREADY_APPLIED` | `it('RN-AJ6: aplicar un recuento es irreversible', …)` |

## 4. Orden de trabajo

1. Tests primero, en rojo por función inexistente.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-AJ3 por mutación:** cambiá el RPC para que use la `cantidad_sistema` guardada
   en el borrador en vez de la existencia actual. Corré el test de los seis pasos. **Tiene que
   fallar en el paso 5 o 6**, con la existencia final en 7 en vez de 10. Anotá cuál falló y
   volvé al original.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz: **las 7 RN-AJ tienen que quedar en ✅.**

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='aplicar_recuento';"

# 2. El RPC lee la existencia ACTUAL, no la guardada en el borrador
grep -n "existencia_actual\|e.cantidad" supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql
# → la diferencia se calcula contra existencias_lote, no contra
#   recuentos_detalle.cantidad_sistema

# 3. El bloqueo está ordenado por lote_id
grep -n -B3 "FOR UPDATE" supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql
# → ORDER BY lote_id

# 4. No existe reversión de recuento
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname ILIKE '%recuento%';"
# → solo aplicar_recuento

# 5. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ajustes.integration.test.ts
# → "N passed", "0 skipped"

# 6. Suites y guardrails
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
