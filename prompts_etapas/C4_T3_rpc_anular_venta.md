# ETAPA C4 · TANDA 3/5 — RPC `anular_venta`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C4·T2 en verde, con el barrido de RN-VT1 pasando.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Una venta registrada no se edita: se anula.** Y anular no borra nada — genera
> contra-asientos de existencia y de caja que quedan visibles al lado de los originales. Es el
> mismo criterio que la eutanasia (`CLAUDE.md` regla 8) y que la anulación de compra de C2·T4.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6 | RN-VT4 y RN-VT5 con sus casos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.3 | RN-MV9: nada se borra, se compensa. |
| `supabase/migrations/20260908000005_comercial_anular_compra_rpc.sql` | **Tu propio RPC de C2·T4**: el patrón de contra-asientos, incluida la trampa del CHECK de coherencia documental. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | El RPC que estás compensando. |
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

1. `supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | RN-VT4, VT5, RN-MV9 sobre ventas. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-VT4, VT5. |

## 2. Especificación exacta

```
anular_venta(p_tenant_id UUID, p_usuario_id UUID, p_venta_id UUID, p_motivo TEXT)
RETURNS TABLE (venta_id UUID, operacion_id UUID,
               movimientos_stock_generados INTEGER, movimientos_caja_generados INTEGER)
```

```
BEGIN
  v_operacion := gen_random_uuid();

  SELECT * INTO v_venta FROM ventas
   WHERE id = p_venta_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                      THEN RAISE EXCEPTION 'SALE_NOT_FOUND';     END IF;

  -- RN-VT4: anular dos veces falla.
  IF v_venta.estado = 'anulada'     THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- ── RN-VT5: el egreso va a la sesión ABIERTA ACTUAL, no a la de la venta ──
  -- Una sesión cerrada no se toca: su saldo_teorico_efectivo está congelado
  -- (RN-CJ8) y meterle un movimiento haría que el arqueo de un turno ya cerrado
  -- dejara de cuadrar. La corrección va a la sesión siguiente, con motivo.
  SELECT s.id INTO v_sesion_actual
    FROM sesiones_caja s
   WHERE s.tenant_id = p_tenant_id AND s.estado = 'abierta'
     AND s.caja_id = (SELECT caja_id FROM sesiones_caja
                       WHERE id = v_venta.sesion_caja_id AND tenant_id = p_tenant_id)
   LIMIT 1;

  IF v_sesion_actual IS NULL THEN RAISE EXCEPTION 'CASH_SESSION_REQUIRED'; END IF;

  -- ── Contra-asientos de EXISTENCIA ────────────────────────────────────────
  -- RN-MV9: se COMPENSA. Los `salida_venta` originales NO se borran ni se tocan:
  -- quedan en el kárdex con el contra-asiento al lado.
  --
  -- La mercadería vuelve AL LOTE DEL QUE SALIÓ. Por eso el contra-asiento se
  -- construye recorriendo los movimientos originales, y no "buscando un lote
  -- disponible": devolver a otro lote rompería el costo y la trazabilidad.
  --
  -- TRAMPA: el contra-asiento va SIN venta_item_id. El CHECK de coherencia
  -- documental exige que `salida_venta` lo lleve, pero el contra-asiento es
  -- `entrada_devolucion`, que no admite documento. Si lo copiás del original,
  -- el INSERT rebota contra el CHECK.
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  SELECT p_tenant_id, v_operacion, 'entrada_devolucion', m.producto_id, m.lote_id,
         m.cantidad, m.costo_unitario, m.costo_total, p_motivo, p_usuario_id
  FROM movimientos_stock m
  JOIN ventas_items vi ON vi.id = m.venta_item_id AND vi.tenant_id = p_tenant_id
  WHERE m.tenant_id = p_tenant_id
    AND m.tipo = 'salida_venta'
    AND vi.venta_id = p_venta_id;
  GET DIAGNOSTICS v_movs_stock = ROW_COUNT;

  -- ── Contra-asientos de CAJA ──────────────────────────────────────────────
  -- Un egreso por cada pago original, en la sesión ABIERTA, con el mismo medio.
  -- Los pagos que no afectan arqueo también se compensan: hacen falta para que
  -- el total vendido de la sesión cierre.
  INSERT INTO movimientos_caja (tenant_id, sesion_caja_id, tipo, medio_pago_id,
                                importe, venta_id, motivo, usuario_id)
  SELECT p_tenant_id, v_sesion_actual, 'egreso_devolucion', vp.medio_pago_id,
         vp.importe, p_venta_id, p_motivo, p_usuario_id
  FROM ventas_pagos vp
  WHERE vp.tenant_id = p_tenant_id AND vp.venta_id = p_venta_id;
  GET DIAGNOSTICS v_movs_caja = ROW_COUNT;

  -- ── Estado ───────────────────────────────────────────────────────────────
  -- La venta NO se borra: queda visible en el listado, marcada como anulada.
  UPDATE ventas
     SET estado = 'anulada', anulada_at = now(),
         anulada_por_usuario_id = p_usuario_id, motivo_anulacion = p_motivo
   WHERE id = p_venta_id AND tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (..., 'CANCEL', 'sales', p_venta_id::text,
    jsonb_build_object('motivo', p_motivo, 'sesion_devolucion', v_sesion_actual,
                       'movimientos_stock', v_movs_stock, 'movimientos_caja', v_movs_caja));

  RETURN QUERY SELECT p_venta_id, v_operacion, v_movs_stock, v_movs_caja;
END;
```

**La acción de auditoría es `CANCEL`, no `UPDATE`.** El enum `AuditAction` la tiene y es lo que
hace que la anulación sea filtrable en la pantalla de auditoría.

**No hay `FOR UPDATE` sobre `existencias_lote` acá**, y es correcto: una devolución **suma**
existencia, así que no puede dejar nada en negativo y no compite con nadie por una unidad. El
`FOR UPDATE` sobre `ventas` alcanza para que dos anulaciones simultáneas de la misma venta no
generen contra-asientos dobles: la segunda ve `estado = 'anulada'` y rebota con
`SALE_ALREADY_VOIDED`.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.2. Tests

| `it()` | Caso |
|---|---|
| `RN-VT4: anular devuelve la existencia y deja la venta visible` | Vender 5 de un lote con existencia 20 → existencia 15. Anular con motivo → existencia **20** otra vez. La venta **sigue en el listado**, con `estado = 'anulada'`, `motivo_anulacion` y `anulada_at`. |
| `RN-VT4: anular dos veces falla` | Segunda llamada → `SALE_ALREADY_VOIDED`. |
| `RN-VT4: anular sin motivo falla` | Sin motivo y con `"error"` (5 caracteres) → `REASON_REQUIRED` en los dos. |
| `RN-VT4: la anulación genera el egreso de caja` | Venta con pago mixto (efectivo + transferencia) → anular genera **2** `egreso_devolucion`, uno por medio. |
| `RN-VT5: el egreso va a la sesión abierta, no a la de la venta` | (1) Abrir sesión S1, vender, cerrar S1 con arqueo. (2) Abrir S2. (3) Anular la venta de S1. (4) El `egreso_devolucion` tiene `sesion_caja_id = S2`. (5) **El `saldo_teorico_efectivo` de S1 no cambió.** Los cinco pasos. |
| `RN-VT5: sin sesión abierta no se puede anular` | Con S1 cerrada y ninguna abierta → `CASH_SESSION_REQUIRED`. |
| `RN-MV9: nada se borra, se compensa` | Después de anular una venta de 2 líneas resueltas en 3 lotes: contar `movimientos_stock` de la operación → **6** (3 salidas + 3 entradas), no 0. Los 3 `salida_venta` originales **siguen** con su `venta_item_id`. |
| `la mercadería vuelve al lote del que salió` | Venta resuelta con 3 unidades del lote A y 2 del lote B → tras anular, A recuperó 3 y B recuperó 2. **No 5 en uno solo.** |

**El caso de RN-VT5 con sus cinco pasos es el que más fácil se implementa mal.** Lo natural es
insertar el egreso en `v_venta.sesion_caja_id`, que es la sesión de la venta. Eso funciona
mientras la sesión siga abierta y rompe el arqueo del turno anterior en cuanto no lo esté.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-VT4 | Una venta registrada no se edita: se anula con motivo, con contra-asientos, y queda visible. → `409 SALE_ALREADY_VOIDED` | `it('RN-VT4: anular devuelve la existencia y deja la venta visible', …)` |
| RN-VT5 | La anulación no toca una sesión cerrada: el egreso va a la sesión abierta actual. | `it('RN-VT5: el egreso va a la sesión abierta, no a la de la venta', …)` |
| RN-MV9 | Nada se borra: se compensa con contra-asientos visibles. | `it('RN-MV9: nada se borra, se compensa', …)` — completa lo de C2·T4 sobre ventas |

## 4. Orden de trabajo

1. Tests primero, en rojo por función inexistente.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-VT5 por mutación:** cambiá `v_sesion_actual` por `v_venta.sesion_caja_id`,
   corré el test de los cinco pasos, confirmá que **falla** en el paso 4 o 5, y volvé al
   original. Reportá cuál de los dos falló.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='anular_venta';"

# 2. El contra-asiento NO copia venta_item_id
grep -n -A12 "entrada_devolucion" supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql
# → la lista de columnas del INSERT NO debe incluir venta_item_id

# 3. La sesión del egreso se resuelve, no se copia de la venta
grep -n "sesion_caja_id" supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql
# → el INSERT de movimientos_caja usa v_sesion_actual, NO v_venta.sesion_caja_id

# 4. No existe ninguna función que "desanule" una venta
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desanul%' OR proname ILIKE '%restaurar_venta%';"
# → cero filas

# 5. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ventas.integration.test.ts
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
