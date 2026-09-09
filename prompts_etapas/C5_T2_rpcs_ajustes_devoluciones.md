# ETAPA C5 · TANDA 2/4 — RPCs `ajustar_existencia` y `registrar_devolucion`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5·T1 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Este es el único mecanismo de corrección del módulo.** Nada se borra ni se edita: se
> compensa con un asiento nuevo y motivo. A partir de esta tanda, un error de carga tiene
> arreglo dentro del sistema — y por eso C6 puede existir.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-09 | Ajustes, mermas y devoluciones como tipos del mismo libro mayor. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.10 | La devolución como **operación**, sin tabla nueva. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.9 | RN-AJ1, AJ2, AJ4, AJ5, AJ7 con sus casos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.4 | RN-LO7: el lote bloqueado solo admite ajuste, merma o desbloqueo. |
| `supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql` | Tu RPC de C4·T3: el patrón de contra-asiento y la trampa del CHECK documental. |
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

1. `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ajustes.integration.test.ts` | RN-AJ1, AJ2, AJ4, AJ5, AJ7, RN-LO7. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | Esas seis RN. |

## 2. Especificación exacta

### 2.0. Motivo obligatorio y sustantivo — RN-AJ1, transversal a todo el archivo

**Los ajustes, las mermas, las devoluciones y todo override exigen `motivo` de al menos 10
caracteres.** Un motivo de tres caracteres es no tener motivo. Escribí un helper y usalo en los
tres RPC, en vez de repetir la condición:

```sql
CREATE OR REPLACE FUNCTION public.motivo_valido(p_motivo TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_motivo IS NOT NULL AND length(trim(p_motivo)) >= 10;
$$;

REVOKE ALL ON FUNCTION public.motivo_valido(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.motivo_valido(TEXT) TO service_role;
```

### 2.1. `ajustar_existencia`

```
ajustar_existencia(
  p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID,
  p_tipo tipo_movimiento_stock,   -- entrada_ajuste | salida_ajuste | merma_vencimiento
                                  -- | merma_rotura | entrada_inicial
  p_cantidad NUMERIC, p_motivo TEXT
)
RETURNS TABLE (movimiento_id UUID, operacion_id UUID, existencia_resultante NUMERIC)
```

```
BEGIN
  IF NOT motivo_valido(p_motivo) THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- Solo estos cinco tipos. Un ajuste NO puede fabricar una salida_venta ni una
  -- entrada_compra: esas tienen su propio camino con su documento.
  IF p_tipo NOT IN ('entrada_ajuste','salida_ajuste','merma_vencimiento',
                    'merma_rotura','entrada_inicial')
     THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;

  SELECT l.*, p.unidad_medida_id, p.activo AS producto_activo
    INTO v_lote
    FROM lotes l JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  IF NOT cantidad_valida_para_unidad(p_cantidad, v_lote.unidad_medida_id)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;   -- RN-PR6

  -- ── RN-AJ7: la ÚNICA salida posible de un lote vencido es merma_vencimiento ──
  -- Es el complemento de RN-LO4: el vencido no se despacha, pero sí se da de
  -- baja. Sin esta excepción, la mercadería vencida quedaría en el inventario
  -- para siempre y la valorización mentiría.
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE
     AND p_tipo <> 'merma_vencimiento' AND signo_movimiento(p_tipo) = -1
     THEN RAISE EXCEPTION 'BATCH_EXPIRED'; END IF;

  -- ── RN-LO7: un lote bloqueado admite ajuste y merma, y nada más ─────────────
  -- Que el bloqueado acepte ajustes es deliberado: es lo que permite darlo de
  -- baja. Lo que no acepta es venta, consumo ni fraccionamiento, y eso lo
  -- garantizan los otros RPC al filtrar por estado = 'disponible'.

  -- Bloqueo antes de validar. Igual que en la venta: leer antes de bloquear es
  -- la ventana por la que pasan dos ajustes simultáneos.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id FOR UPDATE;

  -- La existencia no queda negativa. El CHECK de existencias_lote es la última
  -- red; esta validación da el error legible.
  IF signo_movimiento(p_tipo) = -1 AND v_existencia_actual < p_cantidad
     THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

  v_operacion := gen_random_uuid();
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, p_tipo, v_lote.producto_id, p_lote_id,
          p_cantidad, v_lote.costo_unitario_efectivo,
          round(p_cantidad * v_lote.costo_unitario_efectivo, 2), p_motivo, p_usuario_id)
  RETURNING id INTO v_mov_id;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'inventory', v_mov_id::text,
    jsonb_build_object('tipo', p_tipo, 'lote_id', p_lote_id,
                       'cantidad', p_cantidad, 'motivo', p_motivo));

  RETURN QUERY SELECT v_mov_id, v_operacion, <existencia resultante>;
END;
```

**No existe `revertir_ajuste` (RN-AJ2).** Un ajuste mal hecho se corrige con **otro ajuste**,
de signo contrario y con su propio motivo, que queda visible en el historial del lote al lado
del primero. No escribas ningún RPC, endpoint ni permiso de "deshacer ajuste".

### 2.2. `bloquear_lote` y `desbloquear_lote`

```
bloquear_lote(p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID, p_motivo TEXT)
desbloquear_lote(p_tenant_id UUID, p_usuario_id UUID, p_lote_id UUID, p_motivo TEXT)
```

Los dos exigen `motivo_valido(p_motivo)`. `bloquear_lote` pone
`estado = 'bloqueado', motivo_bloqueo = p_motivo`; `desbloquear_lote` vuelve a `'disponible'` y
**deja `motivo_bloqueo` como estaba**: es el registro de por qué estuvo bloqueado, y borrarlo
sería perder el dato. Los dos auditan con `module: 'inventory'`.

**No cambian existencia**, así que no bloquean `existencias_lote`. Sí hacen `FOR UPDATE` sobre
la fila de `lotes`, para que dos bloqueos simultáneos no se pisen.

### 2.3. `registrar_devolucion`

**No hay tabla nueva** (§4.10). Una devolución es una **operación** que genera
`entrada_devolucion` al lote original —o a un lote nuevo bloqueado si no es revendible— y, si
se reintegra dinero, un `egreso_devolucion` en la caja.

```
registrar_devolucion(
  p_tenant_id UUID, p_usuario_id UUID, p_venta_id UUID,
  p_items JSONB,          -- [{ventaItemId, cantidad, revendible}]
  p_motivo TEXT,
  p_reintegra_efectivo BOOLEAN DEFAULT true,
  p_sesion_caja_id UUID DEFAULT NULL
)
RETURNS TABLE (operacion_id UUID, movimientos_generados INTEGER, importe_reintegrado NUMERIC)
```

```
BEGIN
  IF NOT motivo_valido(p_motivo) THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_venta FROM ventas
   WHERE id = p_venta_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND                   THEN RAISE EXCEPTION 'RETURN_WITHOUT_SALE'; END IF;
  IF v_venta.estado = 'anulada'  THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED';  END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(...) LOOP

    SELECT * INTO v_linea FROM ventas_items
     WHERE id = v_item.ventaItemId AND tenant_id = p_tenant_id AND venta_id = p_venta_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_WITHOUT_SALE'; END IF;

    -- ── RN-AJ4: no se devuelve más de lo vendido, ACUMULANDO las devoluciones
    -- previas de la misma venta. Sin la acumulación, devolver 3 y después 3 de
    -- una línea de 5 pasa las dos veces.
    SELECT COALESCE(sum(m.cantidad), 0) INTO v_ya_devuelto
      FROM movimientos_stock m
     WHERE m.tenant_id = p_tenant_id
       AND m.tipo = 'entrada_devolucion'
       AND m.venta_item_id IS NULL
       AND m.motivo IS NOT NULL
       AND m.lote_id IN (SELECT lote_id FROM movimientos_stock
                          WHERE venta_item_id = v_linea.id AND tenant_id = p_tenant_id);
    -- NOTA: si esta acumulación te resulta frágil, agregá una columna
    -- `venta_item_devuelto_id` a movimientos_stock en ESTA migración y usala.
    -- Lo que NO se puede es no acumular.

    IF v_ya_devuelto + v_item.cantidad > v_linea.cantidad
       THEN RAISE EXCEPTION 'RETURN_EXCEEDS_SOLD'; END IF;

    IF v_item.revendible THEN
      -- Vuelve AL LOTE DEL QUE SALIÓ. Devolver a otro lote rompería el costo y
      -- la trazabilidad.
      INSERT INTO movimientos_stock (tipo='entrada_devolucion', lote_id=<el original>, ...);
    ELSE
      -- ── RN-AJ5: lo no revendible entra a un lote BLOQUEADO ──────────────
      -- Con motivo. Un lote bloqueado no aparece entre los candidatos FEFO, así
      -- que la mercadería queda contabilizada y fuera de circulación, que es
      -- exactamente lo que se quiere: existe, vale, y no se vende.
      INSERT INTO lotes (..., estado = 'bloqueado', motivo_bloqueo = p_motivo,
                         origen = 'devolucion', lote_padre_id = <el lote original>,
                         costo_unitario_neto     = <el del original>,
                         costo_unitario_efectivo = <el del original>)
      RETURNING id INTO v_lote_bloqueado;
      INSERT INTO movimientos_stock (tipo='entrada_devolucion', lote_id=v_lote_bloqueado, ...);
    END IF;
  END LOOP;

  -- Reintegro en la sesión ABIERTA, con el mismo criterio de RN-VT5: una sesión
  -- cerrada no se toca.
  IF p_reintegra_efectivo AND v_importe > 0 THEN
    <resolver la sesión abierta; si no hay -> CASH_SESSION_REQUIRED>
    INSERT INTO movimientos_caja (tipo='egreso_devolucion', ...);
  END IF;

  INSERT INTO registros_auditoria (..., 'UPDATE', 'sales', p_venta_id::text, ...);
  RETURN QUERY SELECT v_operacion, v_movs, v_importe;
END;
```

**La devolución audita con `module: 'sales'`**, no `'inventory'`: es un hecho comercial que
tiene una consecuencia de inventario, y quien la busca la busca junto a la venta.

Cierre del archivo: `REVOKE`/`GRANT` para los cuatro RPC + `motivo_valido`, y
`NOTIFY pgrst, 'reload schema';`.

### 2.4. Tests

| `it()` | Caso |
|---|---|
| `RN-AJ1: el motivo es obligatorio y sustantivo` | `ajustar_existencia` sin motivo → `REASON_REQUIRED`. Con `"error"` (5 caracteres) → `REASON_REQUIRED`. Con `"          "` (10 espacios) → `REASON_REQUIRED`, porque el helper hace `trim`. Con `"Rotura en el traslado"` → funciona. **Los cuatro casos.** |
| `RN-AJ1: los tres RPC exigen motivo` | El mismo barrido en `bloquear_lote`, `desbloquear_lote` y `registrar_devolucion`. Un helper puesto en tres de cuatro pasa un test que solo prueba uno. |
| `RN-AJ2: un ajuste no se revierte, se compensa` | (a) `SELECT count(*) FROM pg_proc WHERE proname ILIKE '%revertir%' OR proname ILIKE '%deshacer%'` → **0**. (b) Un ajuste de −5 seguido de otro de +5 con motivo → el kárdex del lote muestra **los dos**, y la existencia volvió al original. |
| `RN-AJ4: una devolución no excede lo vendido` | Vender 5. Devolver 3 → funciona. Devolver 3 otra vez → `RETURN_EXCEEDS_SOLD`. Devolver 2 → funciona. Devolver 1 → falla. |
| `RN-AJ5: lo no revendible entra a un lote bloqueado` | Devolver con `revendible: false` → se creó un lote nuevo con `estado='bloqueado'` y `motivo_bloqueo`, apuntando al original por `lote_padre_id`. **Y ese lote NO aparece entre los candidatos FEFO.** Las dos aserciones. |
| `RN-AJ7: la única salida de un lote vencido es la merma por vencimiento` | Lote vencido: `ajustar_existencia` con `merma_vencimiento` → funciona. Con `salida_ajuste` → `BATCH_EXPIRED`. Con `merma_rotura` → `BATCH_EXPIRED`. Con `entrada_ajuste` → **funciona** (es una entrada, no una salida). |
| `RN-LO7: un lote bloqueado acepta ajuste pero no venta` | Bloquear un lote. `ajustar_existencia` sobre él → funciona. `registrar_venta` de ese lote → `BATCH_BLOCKED`. |
| `desbloquear conserva el motivo del bloqueo` | Después de desbloquear, `motivo_bloqueo` **sigue teniendo el texto**. Es el registro de por qué estuvo bloqueado. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-AJ1 | Motivo obligatorio de al menos 10 caracteres en ajustes, mermas, devoluciones y todo override. → `422 REASON_REQUIRED` | `it('RN-AJ1: el motivo es obligatorio y sustantivo', …)` |
| RN-AJ2 | Un ajuste no se revierte: se compensa, y la compensación queda visible. | `it('RN-AJ2: un ajuste no se revierte, se compensa', …)` |
| RN-AJ4 | Una devolución no excede lo vendido, acumulando las previas. → `422 RETURN_EXCEEDS_SOLD` | `it('RN-AJ4: una devolución no excede lo vendido', …)` |
| RN-AJ5 | La devolución no revendible va a un lote bloqueado, fuera de los candidatos FEFO. | `it('RN-AJ5: lo no revendible entra a un lote bloqueado', …)` |
| RN-AJ7 | La única salida de un lote vencido es `merma_vencimiento`. | `it('RN-AJ7: la única salida de un lote vencido es la merma por vencimiento', …)` |
| RN-LO7 | Un lote bloqueado solo admite ajuste, merma o desbloqueo. → `422 BATCH_BLOCKED` | `it('RN-LO7: un lote bloqueado acepta ajuste pero no venta', …)` — cierra lo de C2·T4 |

## 4. Orden de trabajo

1. Tests primero, en rojo por funciones inexistentes.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests en verde.
4. **Verificá RN-AJ4 por mutación:** sacá la acumulación de devoluciones previas (dejá solo
   `v_item.cantidad > v_linea.cantidad`), corré el caso de "devolver 3 y después 3 de una línea
   de 5", confirmá que **pasa las dos veces** —que es el bug—, y volvé al original.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Los cuatro RPC + motivo_valido existen y ninguno lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname IN ('ajustar_existencia','bloquear_lote','desbloquear_lote',
  'registrar_devolucion','motivo_valido');"
# → cinco filas, todas en f

# 2. NO existe ninguna función de reversión de ajuste
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%revertir%' OR proname ILIKE '%deshacer%'
     OR proname ILIKE '%undo%';"
# → cero filas

# 3. Ningún RPC del módulo acepta un motivo corto
grep -c "motivo_valido" supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql
# → al menos 4 (uno por RPC)

# 4. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/ajustes.integration.test.ts
# → "N passed", "0 skipped"

# 5. Suites y guardrails
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
