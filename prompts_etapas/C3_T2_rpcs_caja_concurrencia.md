# ETAPA C3 · TANDA 2/3 — Los tres RPC de caja y el test concurrente
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C3·T1 en verde, con `caja.integration.test.ts` en 0 skipped.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **El cierre de caja es irreversible.** Una sesión cerrada no se reabre, no se edita y no
> admite movimientos nuevos. El pedido de "reabrir solo para el admin" va a llegar el primer
> mes (R-09): la respuesta es que el error se corrige con un movimiento en la sesión
> siguiente, con motivo. Mismo criterio que la eutanasia y que el fraccionamiento.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.3 | El esqueleto de `cerrar_sesion_caja`, copiado línea por línea. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.7 | RN-CJ2, CJ4…CJ9 con sus casos de test. |
| `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql` | El patrón del RPC: `SECURITY DEFINER`, resolución del usuario, auditoría interna, `REVOKE`/`GRANT`, `NOTIFY`. |
| `supabase/migrations/20260629000001_crear_estadia_con_cupo_rpc.sql` | **El patrón del `FOR UPDATE` como mutex**, y su doc-comment explicando por qué el chequeo previo en el Service no alcanza. |
| `tests/integration/guarderia.integration.test.ts` líneas 160-240 | **El patrón concurrente exacto a copiar**: `rpcReallyRan()`, `esExito()`, `Promise.all` de dos `.rpc()`. |
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

1. `supabase/migrations/20260915000002_comercial_caja_rpcs.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/caja.integration.test.ts` | RN-CJ2, CJ4 (concurrente), CJ5, CJ6, CJ7, CJ8, CJ9. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas siete RN. |

## 2. Especificación exacta

### 2.1. `abrir_sesion_caja`

```
abrir_sesion_caja(p_tenant_id UUID, p_usuario_id UUID, p_caja_id UUID, p_saldo_inicial NUMERIC)
RETURNS TABLE (sesion_id UUID, caja_id UUID, apertura_at TIMESTAMPTZ, saldo_inicial NUMERIC)
```

```
BEGIN
  IF p_saldo_inicial IS NULL OR p_saldo_inicial < 0
     THEN RAISE EXCEPTION 'INVALID_OPENING_BALANCE'; END IF;

  -- La caja existe, es de este tenant y está activa.
  SELECT activa INTO v_activa FROM cajas
   WHERE id = p_caja_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;

  -- RN-CJ4. NO se chequea "¿hay alguna abierta?" con un SELECT previo: eso deja
  -- una ventana entre la lectura y el INSERT por la que pasan dos aperturas
  -- simultáneas. Se intenta insertar y se deja que el índice parcial único
  -- decida, capturando su unique_violation. La base es el árbitro.
  BEGIN
    INSERT INTO sesiones_caja (tenant_id, caja_id, estado, apertura_usuario_id, saldo_inicial)
    VALUES (p_tenant_id, p_caja_id, 'abierta', p_usuario_id, p_saldo_inicial)
    RETURNING id, apertura_at INTO v_sesion_id, v_apertura;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'CASH_SESSION_ALREADY_OPEN';
  END;

  INSERT INTO registros_auditoria (... 'CREATE', 'cash_register', v_sesion_id::text ...);
  RETURN QUERY SELECT v_sesion_id, p_caja_id, v_apertura, p_saldo_inicial;
END;
```

**El `EXCEPTION WHEN unique_violation` NO puede envolver más que el `INSERT`.** Si envuelve
todo el cuerpo, se come errores de otras causas y los reporta como "ya hay una sesión abierta",
que es un diagnóstico falso difícil de rastrear.

### 2.2. `registrar_movimiento_caja`

```
registrar_movimiento_caja(p_tenant_id UUID, p_usuario_id UUID, p_sesion_id UUID,
                          p_tipo tipo_movimiento_caja, p_medio_pago_id UUID,
                          p_importe NUMERIC, p_motivo TEXT DEFAULT NULL,
                          p_referencia TEXT DEFAULT NULL)
RETURNS TABLE (movimiento_id UUID, sesion_id UUID)
```

```
BEGIN
  -- RN-CJ5: la sesión tiene que estar ABIERTA. El FOR UPDATE evita que se cierre
  -- entre esta lectura y el INSERT.
  SELECT estado INTO v_estado FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND              THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;
  IF v_estado <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_CLOSED';    END IF;

  -- El medio de pago existe y está activo.
  SELECT activo, requiere_referencia INTO v_mp
    FROM medios_pago WHERE id = p_medio_pago_id;
  IF NOT FOUND        THEN RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED'; END IF;
  IF NOT v_mp.activo  THEN RAISE EXCEPTION 'PAYMENT_METHOD_DISABLED'; END IF;

  -- RN-CJ9: transferencia y tarjeta piden número de operación; efectivo no.
  IF v_mp.requiere_referencia AND (p_referencia IS NULL OR trim(p_referencia) = '')
     THEN RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED'; END IF;

  IF p_importe IS NULL OR p_importe <= 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;

  -- Los movimientos manuales exigen motivo: un egreso de caja sin explicación es
  -- exactamente el asiento que después nadie puede justificar.
  IF p_tipo IN ('ingreso_manual','egreso_manual','egreso_retiro')
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  INSERT INTO movimientos_caja (...) RETURNING id INTO v_mov_id;
  INSERT INTO registros_auditoria (... 'CREATE', 'cash_register', v_mov_id::text ...);
  RETURN QUERY SELECT v_mov_id, p_sesion_id;
END;
```

**`medios_pago` es un catálogo global, sin `tenant_id`.** Su consulta es la única del cuerpo
que **no** lleva filtro de tenant, y está bien. Todas las demás sí.

### 2.3. `cerrar_sesion_caja`

```
cerrar_sesion_caja(p_tenant_id UUID, p_usuario_id UUID, p_sesion_id UUID,
                   p_efectivo_contado NUMERIC, p_motivo TEXT DEFAULT NULL,
                   p_observaciones TEXT DEFAULT NULL)
RETURNS TABLE (sesion_id UUID, saldo_teorico_efectivo NUMERIC,
               efectivo_contado NUMERIC, diferencia NUMERIC)
```

```
BEGIN
  SELECT * INTO v_sesion FROM sesiones_caja
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND                     THEN RAISE EXCEPTION 'CASH_SESSION_NOT_FOUND'; END IF;
  IF v_sesion.estado <> 'abierta'  THEN RAISE EXCEPTION 'CASH_SESSION_CLOSED';    END IF;

  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0
     THEN RAISE EXCEPTION 'INVALID_OPENING_BALANCE'; END IF;

  -- RN-CJ2: SOLO los medios con afecta_arqueo entran al teórico. Los pagos con
  -- tarjeta se registran igual —hacen falta para el total vendido— pero no
  -- afectan el efectivo que hay en el cajón. Ahí D-08 se paga sola: una venta en
  -- cuenta corriente no genera pago en efectivo y el arqueo cierra igual (RN-CJ3).
  SELECT v_sesion.saldo_inicial
         + COALESCE(sum(mov.importe * signo_movimiento_caja(mov.tipo)), 0)
    INTO v_teorico
    FROM movimientos_caja mov
    JOIN medios_pago mp ON mp.id = mov.medio_pago_id
   WHERE mov.sesion_caja_id = p_sesion_id
     AND mov.tenant_id      = p_tenant_id
     AND mp.afecta_arqueo;

  v_diferencia := p_efectivo_contado - v_teorico;

  -- RN-CJ7: por encima de la tolerancia del tenant, el motivo es obligatorio.
  SELECT tolerancia_diferencia_arqueo INTO v_tolerancia
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  IF abs(v_diferencia) > COALESCE(v_tolerancia, 0)
     AND (p_motivo IS NULL OR length(trim(p_motivo)) < 10)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- RN-CJ6: la diferencia se guarda SIEMPRE, incluso en cero. RN-CJ8: el teórico
  -- se CONGELA. Si mañana aparece un movimiento que faltaba cargar, el teórico de
  -- esta sesión no cambia: el ajuste va a la sesión siguiente. Una cifra de
  -- arqueo que se recalcula sola no sirve para controlar a nadie.
  UPDATE sesiones_caja
     SET estado = 'cerrada', cierre_at = now(), cierre_usuario_id = p_usuario_id,
         saldo_teorico_efectivo = v_teorico,
         efectivo_contado = p_efectivo_contado,
         diferencia = v_diferencia,
         motivo_diferencia = p_motivo, observaciones = p_observaciones
   WHERE id = p_sesion_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (... 'UPDATE', 'cash_register', p_sesion_id::text,
    jsonb_build_object('saldo_teorico', v_teorico, 'contado', p_efectivo_contado,
                       'diferencia', v_diferencia));

  RETURN QUERY SELECT p_sesion_id, v_teorico, p_efectivo_contado, v_diferencia;
END;
```

**No existe `reabrir_sesion_caja`.** No lo escribas, ni siquiera "para el admin". El pedido va
a llegar; la respuesta es la sesión siguiente con motivo.

Cierre del archivo: `REVOKE`/`GRANT` para los tres, y `NOTIFY pgrst, 'reload schema';`.

### 2.4. Tests

| `it()` | Caso |
|---|---|
| `RN-CJ4: dos aperturas SIMULTÁNEAS de la misma caja → gana exactamente una` | **Copiá el patrón de `guarderia.integration.test.ts`.** `Promise.all` de dos `.rpc("abrir_sesion_caja", …)` sobre la misma caja. `expect(rpcReallyRan(r1.error)).toBe(true)` y lo mismo para r2. Exactamente un éxito y exactamente un fallo, con `CASH_SESSION_ALREADY_OPEN`. Y la garantía dura: `SELECT count(*) FROM sesiones_caja WHERE caja_id = X AND estado = 'abierta'` → **1**. Repetido `N` veces, con `N` desde `process.env.CONCURRENCY_REPS ?? 50`. |
| `RN-CJ2: solo el efectivo afecta el arqueo` | Abrir con saldo inicial 1.000. Registrar `ingreso_venta` de 5.000 en **transferencia** y 2.000 en **efectivo**. Cerrar con 3.000 contados → `saldo_teorico_efectivo = 3.000`, **no 8.000**, y `diferencia = 0`. |
| `RN-CJ5: cerrar es irreversible` | Cerrar. (a) `registrar_movimiento_caja` sobre esa sesión → `CASH_SESSION_CLOSED`. (b) `cerrar_sesion_caja` otra vez → `CASH_SESSION_CLOSED`. (c) **No existe ninguna función que la reabra**: `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%'` → 0. |
| `RN-CJ6: la diferencia se guarda incluso en cero` | Cerrar con el efectivo exacto → `diferencia = 0.00` y **`diferencia IS NOT NULL`**. Asertá las dos cosas: `expect(d).toBe(0)` pasaría con `null` en algunos comparadores laxos. |
| `RN-CJ7: la diferencia sobre la tolerancia exige motivo` | Con `tolerancia_diferencia_arqueo = 0`: cerrar con $50 de faltante **sin motivo** → `REASON_REQUIRED`; con motivo de 10+ caracteres → funciona y el motivo queda en `motivo_diferencia`. Con `tolerancia = 100` y $50 de faltante sin motivo → **funciona**. |
| `RN-CJ8: el teórico se congela` | Cerrar. Insertar a la fuerza un `movimientos_caja` en la sesión cerrada con `serviceDb` (la FK lo permite; lo que no se puede es pasar por el RPC). Releer la sesión → `saldo_teorico_efectivo` **no cambió**. |
| `RN-CJ9: la referencia es obligatoria según el medio` | `transferencia` sin `p_referencia` → `PAYMENT_REFERENCE_REQUIRED`. `efectivo` sin referencia → funciona. |

**El guard `rpcReallyRan()` no es opcional en el test concurrente.** Sin él, si el `NOTIFY
pgrst` faltara, las dos llamadas fallarían con "no se encontró la función", el test contaría
"cero éxitos, dos fallos" y podría interpretarse como que la exclusión funcionó. Es el falso
verde exacto que ese guard existe para atrapar.

**Las repeticiones van por variable de entorno, no editando el test.** El final clásico de esta
historia es que en CI tarda, alguien lo comenta "por ahora", y no vuelve nunca.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CJ2 | Solo el efectivo afecta el arqueo. | `it('RN-CJ2: solo el efectivo afecta el arqueo', …)` |
| RN-CJ4 | Una sola sesión abierta por caja. → `409 CASH_SESSION_ALREADY_OPEN` | `it('RN-CJ4: dos aperturas SIMULTÁNEAS de la misma caja → gana exactamente una', …)` |
| RN-CJ5 | Cerrar es irreversible: no se reabre, no se edita, no admite movimientos. → `409 CASH_SESSION_CLOSED` | `it('RN-CJ5: cerrar es irreversible', …)` |
| RN-CJ6 | La diferencia se registra siempre, incluso en cero. | `it('RN-CJ6: la diferencia se guarda incluso en cero', …)` |
| RN-CJ7 | Diferencia sobre la tolerancia exige motivo. → `422 REASON_REQUIRED` | `it('RN-CJ7: la diferencia sobre la tolerancia exige motivo', …)` |
| RN-CJ8 | El teórico se congela al cerrar. | `it('RN-CJ8: el teórico se congela', …)` |
| RN-CJ9 | Referencia obligatoria según el medio de pago. → `422 PAYMENT_REFERENCE_REQUIRED` | `it('RN-CJ9: la referencia es obligatoria según el medio', …)` |

## 4. Orden de trabajo

1. **Tests primero.** Tienen que fallar con "no se encontró la función `abrir_sesion_caja`".
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde. Corré el concurrente con `CONCURRENCY_REPS=200` **al menos una vez** y
   reportá el resultado.
4. **Verificá RN-CJ4 por mutación:** reemplazá el `INSERT` + `EXCEPTION` por un `SELECT` previo
   de "¿hay alguna abierta?" seguido del `INSERT`, corré el test concurrente con
   `CONCURRENCY_REPS=200`, confirmá que **falla** (dos éxitos en alguna repetición), y volvé al
   original. Reportá en qué repetición falló. Este paso es lo que prueba que el índice parcial
   está haciendo el trabajo y no la suerte.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Los tres RPC existen y ninguno es ejecutable por anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE'),
  has_function_privilege('authenticated', oid, 'EXECUTE')
  FROM pg_proc WHERE proname IN
  ('abrir_sesion_caja','registrar_movimiento_caja','cerrar_sesion_caja');"
# → tres filas, las dos columnas en f

# 2. NO existe ninguna función de reapertura
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%reabrir%' OR proname ILIKE '%reopen%';"
# → cero filas

# 3. El test concurrente con 200 repeticiones
CONCURRENCY_REPS=200 npx vitest run --config vitest.integration.config.ts \
  tests/integration/caja.integration.test.ts -t "RN-CJ4"
# → passed. Si falla aunque sea UNA vez en 200, hay una condición de carrera real.

# 4. Toda la suite de caja
npx vitest run --config vitest.integration.config.ts tests/integration/caja.integration.test.ts
# → "N passed", "0 skipped"

# 5. Suites completas y guardrails
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
