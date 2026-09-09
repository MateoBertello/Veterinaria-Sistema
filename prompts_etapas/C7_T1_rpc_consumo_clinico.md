# ETAPA C7 · TANDA 1/3 — RPC `registrar_consumo_clinico`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6 completa y aprobada por `C6_AUDITORIA.md`, con los cuatro guardrails en
> verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Aplicar una vacuna, usar un sedante o gastar una jeringa descuenta existencia y NO es una
> venta ni un ajuste.** Es una salida atada a un evento clínico, con profesional responsable y
> paciente. Se modeló así desde el día uno —el tipo `consumo_clinico` y las tres columnas
> clínicas están en el ENUM y en la tabla desde C1·T1 y C2·T1— justamente para no tener que
> reclasificar dos años de ajustes después.
>
> **Esta tanda NO crea ninguna tabla ni ninguna columna.** Todo lo que necesita ya existe.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-01 | Por qué el consumo clínico es un movimiento de primera clase y qué se pierde si entra como ajuste. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-14, D-15 | Receta y prescriptor sin validación; por qué no se construye el puente a SIGTRAZAVET. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.10 | RN-CC1…CC5 con sus casos exactos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §10.3 | **La dirección de la dependencia.** El movimiento apunta al evento clínico; el módulo clínico no se entera. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | **El patrón exacto a copiar.** Las validaciones sin bloqueo, la asignación FEFO, el `FOR UPDATE` ordenado por `lote_id`, las validaciones sobre el valor ya bloqueado, la auditoría interna. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | El CHECK de coherencia documental: ya exige `historial_id` para `consumo_clinico`. |
| `supabase/migrations/20260630000002_marcar_dosis_aplicada_rpc.sql` | El RPC clínico existente. **Leelo pero NO lo toques**: ya crea el evento en `historial_clinico` y devuelve su `event_id`, que es el que este RPC va a recibir. |
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

1. `supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql`
2. `tests/integration/consumo.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **Las cinco filas RN-CC pasan de `N/A` a `PENDIENTE`** — es la primera tarea de esta tanda, ver sección 4 — y después RN-CC1, CC2, CC5 a ✅. |

**No se toca `marcar_dosis_aplicada`, ni `historial_clinico`, ni `plan_vacunacion`, ni ninguna
migración de C1 a C6.** Si al escribir el RPC te parece que necesitás una columna nueva en una
tabla clínica, **frená y reportá**: eso rompería la independencia de §10.3.

## 2. Especificación exacta

### 2.0. La dirección de la dependencia — leelo antes que nada

```
        movimientos_stock.historial_id  ──────►  historial_clinico.id
        movimientos_stock.mascota_id    ──────►  mascotas.id
        movimientos_stock.plan_vacunacion_id ─►  plan_vacunacion.id
```

**Las flechas van en un solo sentido y no se invierten.** Es deliberado y tiene tres motivos:

1. **El módulo clínico no depende del comercial.** Un tenant sin `stock` contratado usa el
   historial exactamente igual que hoy.
2. La dirección inversa —una columna `producto_id` en `historial_clinico`— obligaría al módulo
   clínico a conocer el catálogo y rompería la independencia de módulos vendibles, que es lo que
   `requireModule` protege.
3. Para mostrar "qué se le aplicó" en la ficha se consulta `movimientos_stock` filtrando por
   `historial_id`, que ya está indexado desde C2·T1 (`idx_mov_historial`).

**Consecuencia operativa:** el evento clínico se crea **primero**, por el camino que ya existe
(`registrar_evento_clinico` o `marcar_dosis_aplicada`), y **después** se llama a este RPC con el
`historial_id` que aquél devolvió. Son dos llamadas, no una transacción conjunta, y eso también
es a propósito: si el descuento de stock fallara, **el acto clínico ya ocurrió y tiene que quedar
registrado igual**.

### 2.1. Firma

```sql
registrar_consumo_clinico(
  p_tenant_id                 UUID,
  p_usuario_id                UUID,
  p_historial_id              UUID,     -- el evento clínico, YA CREADO
  p_items                     JSONB,    -- [{productoId, cantidad, loteId, motivoFefo}]
  p_plan_vacunacion_id        UUID DEFAULT NULL,
  p_receta_id                 UUID DEFAULT NULL,   -- RESERVADA, sin validar (D-14)
  p_profesional_prescriptor_id UUID DEFAULT NULL   -- RESERVADA, sin validar (D-14)
)
RETURNS TABLE (
  operacion_id      UUID,
  movimientos       INTEGER,
  costo_total       NUMERIC,
  advertencias      JSONB      -- receta, vencimiento próximo: informativas, no bloquean
)
```

### 2.2. Cuerpo

```
BEGIN
  v_operacion := gen_random_uuid();
  v_advertencias := '[]'::jsonb;

  -- ── 1. Validaciones SIN bloqueo ──────────────────────────────────────────
  -- El evento clínico existe y es de este tenant. De acá sale mascota_id, que se
  -- DENORMALIZA en el movimiento para la trazabilidad lote↔animal (RN-CC4).
  SELECT hc.id, hc.pet_id, hc.professional_id
    INTO v_evento
    FROM historial_clinico hc
   WHERE hc.id = p_historial_id AND hc.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORIAL_NOT_FOUND'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0
     THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;

  -- Si vino un plan de vacunación, es de este tenant y de la MISMA mascota.
  -- Sin esta verificación, un plan_vacunacion_id de otra mascota entraría y la
  -- trazabilidad lote↔animal quedaría diciendo una cosa distinta de la verdad.
  IF p_plan_vacunacion_id IS NOT NULL THEN
    PERFORM 1 FROM plan_vacunacion pv
     WHERE pv.id = p_plan_vacunacion_id AND pv.tenant_id = p_tenant_id
       AND pv.pet_id = v_evento.pet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VACCINE_PLAN_NOT_FOUND'; END IF;
  END IF;

  -- Config del tenant: se lee UNA vez, fuera del bucle.
  SELECT exigir_receta_bloqueante, dias_alerta_vencimiento
    INTO v_config
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  -- ── 2. Por ítem: validación y asignación FEFO ────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
                  "productoId" UUID, cantidad NUMERIC, "loteId" UUID, "motivoFefo" TEXT)
  LOOP
    SELECT activo, es_consumible_clinico, condicion_venta, unidad_medida_id, nombre
      INTO v_prod
      FROM productos WHERE id = v_item."productoId" AND tenant_id = p_tenant_id;

    IF NOT FOUND         THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_prod.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';  END IF;   -- RN-PR3

    -- `es_consumible_clinico` habilita seleccionarlo desde el historial. NO es
    -- bloqueante acá: un producto vendible también se puede consumir (una
    -- pipeta que el veterinario aplica en el consultorio). Se registra como
    -- advertencia para que la UI lo señale.
    IF NOT v_prod.es_consumible_clinico THEN
      v_advertencias := v_advertencias || jsonb_build_object(
        'tipo', 'producto_no_marcado_como_consumible',
        'productoId', v_item."productoId", 'nombre', v_prod.nombre);
    END IF;

    -- RN-PR6: decimales según la unidad del producto.
    IF NOT cantidad_valida_para_unidad(v_item.cantidad, v_prod.unidad_medida_id)
       THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

    -- ── RN-CC3: la receta es opcional HOY y bloqueante POR CONFIGURACIÓN ────
    -- Con exigir_receta_bloqueante = false, un producto "bajo receta" se
    -- consume con ADVERTENCIA. Con la bandera en true, se exige receta_id.
    -- El día que el negocio decida exigir receta, se enciende la bandera y esta
    -- regla pasa de advertencia a bloqueo SIN MIGRACIÓN. Eso es todo lo que
    -- D-14 compró con dos columnas nullable.
    IF v_prod.condicion_venta IN ('bajo_receta','bajo_receta_archivada') THEN
      IF v_config.exigir_receta_bloqueante AND p_receta_id IS NULL THEN
        RAISE EXCEPTION 'PRESCRIPTION_REQUIRED';
      ELSIF p_receta_id IS NULL THEN
        v_advertencias := v_advertencias || jsonb_build_object(
          'tipo', 'producto_bajo_receta_sin_receta',
          'productoId', v_item."productoId", 'nombre', v_prod.nombre);
      END IF;
    END IF;

    -- ── RN-CC2: descuenta con LAS MISMAS REGLAS que la venta ────────────────
    -- Candidatos FEFO: fecha_vencimiento ASC con NULLS LAST, luego
    -- fecha_ingreso, luego id. Los vencidos NO entran (RN-LO4, no overrideable
    -- por ningún rol). Los bloqueados tampoco (RN-LO7).
    -- Override motivado igual que RN-LO6: si el usuario forzó otro lote,
    -- exige motivo y el movimiento guarda fefo_respetado = false.
    ...
    v_lotes_a_bloquear := array_append(v_lotes_a_bloquear, <lotes asignados>);
  END LOOP;

  -- ── 3. BLOQUEO. Todos los lotes en UN SOLO SELECT, ORDENADOS POR lote_id ──
  -- Igual que en registrar_venta y por el mismo motivo: dos operaciones que
  -- toquen los mismos lotes en orden inverso se bloquean mutuamente y una muere
  -- por deadlock. Y acá hay un caso REAL de concurrencia: dos veterinarios
  -- aplicando vacunas del mismo frasco a la misma hora.
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes_a_bloquear)
   ORDER BY lote_id
     FOR UPDATE;

  -- ── 4. Validaciones SOBRE EL VALOR YA BLOQUEADO ──────────────────────────
  --   existencia insuficiente -> INSUFFICIENT_STOCK
  --   lote vencido            -> BATCH_EXPIRED
  --   lote bloqueado          -> BATCH_BLOCKED

  -- ── 5. Escrituras ────────────────────────────────────────────────────────
  -- Un movimiento por lote asignado. TODOS con:
  --   tipo = 'consumo_clinico'
  --   historial_id = p_historial_id          (lo exige el CHECK documental de C2·T1)
  --   mascota_id   = v_evento.pet_id         (denormalizado, RN-CC4)
  --   plan_vacunacion_id, receta_id, profesional_prescriptor_id  si vinieron
  --   costo_unitario = costo_unitario_efectivo DEL LOTE, congelado
  --   operacion_id compartido
  --
  -- trazabilidad_estado se deja en su DEFAULT 'no_aplica'. NO lo escribas.
  -- RN-CC5 es el test de que ese puente NO se construyó (D-15): no hay cliente
  -- HTTP, no hay cola de reintentos, no hay mapeo de códigos, no hay credencial.
  INSERT INTO movimientos_stock (
    tenant_id, operacion_id, tipo, producto_id, lote_id, cantidad,
    costo_unitario, costo_total, fefo_respetado, motivo,
    historial_id, plan_vacunacion_id, mascota_id,
    receta_id, profesional_prescriptor_id, usuario_id
  ) VALUES (...);

  -- ── 5b. Alerta de stock mínimo, por FLANCO ───────────────────────────────
  -- Mismo mecanismo que en registrar_venta: se crea al cruzar el mínimo hacia
  -- abajo y se ELIMINA al cruzarlo hacia arriba. Un consumo clínico baja la
  -- existencia igual que una venta y tiene que avisar igual.

  -- ── 6. NO se genera venta. NO se genera movimiento de caja. ───────────────
  -- Es RN-CC1 y es la razón de existir del tipo propio. Modelarlo como venta a
  -- precio cero rompería todos los reportes de venta y obligaría a un cliente
  -- ficticio; como ajuste, perdería el vínculo clínico.

  -- ── 7. Auditoría, misma transacción ──────────────────────────────────────
  SELECT u.full_name, COALESCE(r.display_name, r.name) INTO v_user_name, v_user_role
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE u.id = p_usuario_id AND u.tenant_id = p_tenant_id;

  INSERT INTO registros_auditoria (
    tenant_id, user_id, user_name, user_role, action, module, entity_id, new_values
  ) VALUES (
    p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'CREATE', 'inventory', v_operacion::text,       -- module = 'inventory'
    jsonb_build_object('historial_id', p_historial_id, 'mascota_id', v_evento.pet_id,
                       'movimientos', v_movs, 'costo_total', v_costo_total));

  RETURN QUERY SELECT v_operacion, v_movs, v_costo_total, v_advertencias;
END;
```

**Cada lectura y cada escritura filtra por `p_tenant_id`.** Es `SECURITY DEFINER`: no hay RLS.

Cierre: `REVOKE ALL … FROM PUBLIC;`, `GRANT EXECUTE … TO service_role;`,
`NOTIFY pgrst, 'reload schema';`, y la marca `-- @modulo: comercial` en la primera línea.

### 2.3. Tests — `tests/integration/consumo.integration.test.ts`

Arnés: reusá el de `fraccionamiento.integration.test.ts`. Vas a necesitar sembrar una mascota,
un cliente, un evento de `historial_clinico` y un lote con existencia; escribí el helper una vez
y exportalo, porque C7·T2 y C7·T3 lo reusan.

| `it()` | Caso |
|---|---|
| `RN-CC1: el consumo clínico es un tipo propio, no una venta ni un ajuste` | Aplicar una vacuna desde el historial → **un** movimiento `consumo_clinico` con `historial_id` y `mascota_id` poblados. **Y**: `SELECT count(*) FROM ventas WHERE tenant_id = A` no cambió, y `SELECT count(*) FROM movimientos_caja WHERE tenant_id = A` tampoco. Las tres aserciones: sin las dos últimas, el test pasaría aunque el RPC generara una venta a precio cero. |
| `RN-CC1: el consumo no lleva venta_item_id ni compra_item_id` | El movimiento tiene los dos en `NULL`. Y forzar un `INSERT` de `consumo_clinico` **sin** `historial_id` por PostgREST → viola el CHECK documental de C2·T1. |
| `RN-CC2: consumir de un lote vencido falla` | Único lote disponible vencido → `BATCH_EXPIRED`. Repetilo con JWT de **admin**: tampoco. RN-LO4 no es overrideable. |
| `RN-CC2: consumir más de lo disponible falla` | Existencia 2, consumir 3 → `INSUFFICIENT_STOCK`. La existencia siguió en 2. |
| `RN-CC2: el lote sugerido es el de FEFO` | Tres lotes que vencen en 2027-01, 2027-03 y `NULL` → el movimiento sale del de enero. |
| `RN-CC2: un lote bloqueado no se consume` | `BATCH_BLOCKED`. |
| `RN-CC3: la receta es advertencia con la bandera en false` | Producto `condicion_venta = 'bajo_receta'`, `exigir_receta_bloqueante = false`, sin `p_receta_id` → **funciona**, y `advertencias` trae `producto_bajo_receta_sin_receta`. |
| `RN-CC3: la receta es bloqueante con la bandera en true` | **El mismo producto y el mismo llamado**, cambiando **solo** `configuracion_tenant.exigir_receta_bloqueante` a `true` → `PRESCRIPTION_REQUIRED`. Con `p_receta_id` puesto → funciona. **Sin migración de por medio**: eso es lo que el test tiene que demostrar. |
| `RN-CC5: las columnas de trazabilidad externa no se usan` | Después de un ciclo completo —una compra, una venta, un fraccionamiento, un ajuste y un consumo clínico—: `SELECT count(*) FROM movimientos_stock WHERE tenant_id = A AND trazabilidad_estado <> 'no_aplica'` → **0**. Y `SELECT count(*) FROM movimientos_stock WHERE trazabilidad_referencia_externa IS NOT NULL` → **0**. |
| `RN-CC5: no existe ningún cliente HTTP hacia un organismo externo` | Guardrail estático: ningún archivo de `supabase/functions/api/src/modules/` contiene `fetch(` hacia un host externo, ni `SIGTRAZAVET`, ni `senasa`. Escribilo como test, no como revisión manual. |
| `dos consumos simultáneos del mismo frasco no sobrevenden` | `Promise.all` de dos `.rpc("registrar_consumo_clinico")` sobre un lote con existencia 1, con el guard `rpcReallyRan()`. Exactamente uno tiene éxito. **Es un caso real**: dos veterinarios aplicando del mismo frasco a la misma hora. |
| `el consumo audita con module inventory` | El asiento existe, con `module = 'inventory'` y `action = 'CREATE'`. Si el RPC falla, **no** queda asiento. |

**RN-CC5 es un test de que algo NO se construyó**, y es raro escribirlo pero vale: la presión
para "ir agregando el puente de a poco" aparece cuando alguien lee la resolución de SENASA. El
test es lo que hace que agregarlo sea una decisión explícita y no un goteo.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CC1 | El consumo clínico es un tipo propio: no se registra como venta ni como ajuste. | `it('RN-CC1: el consumo clínico es un tipo propio, no una venta ni un ajuste', …)` |
| RN-CC2 | Descuenta con las mismas reglas que la venta: FEFO, bloqueo de fila, prohibición de vencidos, existencia no negativa. | `it('RN-CC2: …', …)` — cuatro casos |
| RN-CC3 | La receta es opcional hoy y bloqueante por configuración. → `422 PRESCRIPTION_REQUIRED` | `it('RN-CC3: la receta es bloqueante con la bandera en true', …)` |
| RN-CC5 | Las columnas de trazabilidad externa no se usan: `trazabilidad_estado` queda en `no_aplica`. | `it('RN-CC5: las columnas de trazabilidad externa no se usan', …)` |

**RN-CC4** (trazabilidad lote↔animal consultable) es de C7·T3: necesita las consultas, no solo
el movimiento. Dejala en `PENDIENTE`.

## 4. Orden de trabajo

1. **Primero, activá las cinco RN-CC en la matriz.** Cambiá el estado de las filas RN-CC1…CC5 de
   `N/A` a `PENDIENTE` en `MATRIZ_RN_TESTS_COMERCIAL.md`. Hasta ahora estaban en `N/A` porque C7
   no existía; ahora sí.
2. **Verificá el prerrequisito antes de escribir una línea:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
     WHERE table_name='movimientos_stock' AND column_name IN
     ('historial_id','plan_vacunacion_id','mascota_id','receta_id','profesional_prescriptor_id');"
   ```
   **Esperado: las cinco.** Si falta alguna, **frená y reportá**: la migración de C2·T1 no quedó
   como el plan la especificó y agregarlas ahora es una migración sobre la tabla más grande del
   módulo.
3. Escribí los tests y corrélos: tienen que fallar con "no se encontró la función
   `registrar_consumo_clinico`".
4. Migración con marca y `NOTIFY`, aplicada.
5. Tests en verde.
6. **Verificá RN-CC1 por mutación:** hacé que el RPC además inserte una fila en `ventas` a precio
   cero. Corré RN-CC1 y confirmá que **falla** en la aserción de `count(*) FROM ventas`. Volvé al
   original. Reportalo.
7. `npm test && npm run typecheck && npm run test:integration`.
8. Marcá RN-CC1, CC2, CC3 y CC5 en la matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE'),
  has_function_privilege('authenticated', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='registrar_consumo_clinico';"
# → una fila, las dos columnas en f

# 2. EL BLOQUEO ESTÁ ORDENADO POR lote_id
grep -n -B4 "FOR UPDATE" supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → ORDER BY lote_id inmediatamente antes

# 3. El RPC NO escribe ventas ni caja
grep -nE "INSERT INTO (ventas|movimientos_caja|ventas_items|ventas_pagos)" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → SIN RESULTADOS

# 4. El RPC NO escribe trazabilidad_estado
grep -n "trazabilidad_estado\|trazabilidad_referencia_externa" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → sin resultados, o solo dentro de un comentario que explique por qué no se tocan

# 5. Ninguna tabla ni columna nueva
git diff --stat HEAD -- supabase/migrations/ | tail -3
grep -icE "CREATE TABLE|ALTER TABLE .* ADD COLUMN" \
  supabase/migrations/20261013000001_comercial_registrar_consumo_clinico_rpc.sql
# → 0

# 6. No se tocó ninguna migración de C1 a C6
git status --short supabase/migrations/ | grep -v "^??"
# → SIN RESULTADOS. Solo debe aparecer el archivo nuevo, como no rastreado.

# 7. Tests
npx vitest run --config vitest.integration.config.ts tests/integration/consumo.integration.test.ts
# → "N passed", "0 skipped"

# 8. G3 descubrió el RPC nuevo solo
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each corre con un caso más que en C6

# 9. Suites completas y los cuatro guardrails
npm test && npm run typecheck
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
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
