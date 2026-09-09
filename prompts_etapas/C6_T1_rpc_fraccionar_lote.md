# ETAPA C6 · TANDA 1/4 — RPC `fraccionar_lote`
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C5 completa y en verde, con las 7 RN-AJ en ✅.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Es la operación central del módulo, y hay exactamente dos puntos donde se implementa mal:**
>
> 1. **Dividir el costo por el rendimiento teórico en vez de por la cantidad realmente
>    obtenida.** Da un costo prolijo y equivocado, y hace desaparecer el costo de fraccionar.
> 2. **Imputarle costo a la merma.** Parece contable —"se perdió producto, se perdió plata"—
>    y cuenta el mismo peso dos veces, sobrevaluando el inventario.
>
> Los dos tienen su test. Si alguno falla, no lo relajes: está detectando exactamente lo que
> existe para detectar.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §5.2 | **El esqueleto de `fraccionar_lote`, línea por línea.** Copialo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06, D-06.a, D-06.b, D-06.d | Conversión entre productos, rendimiento real, herencia de costo, decimales por unidad. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.8 | RN-FR1…FR13 con sus casos exactos. |
| `supabase/migrations/20260929000002_comercial_ajustes_rpcs.sql` | `motivo_valido`, que este RPC reusa. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | El patrón del `FOR UPDATE` y de la auditoría interna. |
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

1. `supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql`
2. `tests/integration/fraccionamiento.integration.test.ts`
3. `tests/unit/fraccionamiento.service.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR1, FR3, FR5, FR6, FR7, FR8, FR10, FR11, FR13. |

**Esta tanda no crea ninguna tabla.** `lote_padre_id` existe desde C2·T1 (D-13) y
`producto_conversiones` desde C1·T3. Eso es exactamente lo que se planificó: el fraccionamiento
se **implementa** en C6, pero se **decide** en C2.

## 2. Especificación exacta

### 2.1. Firma

```sql
fraccionar_lote(
  p_tenant_id UUID, p_usuario_id UUID,
  p_lote_origen_id UUID, p_producto_destino_id UUID,
  p_cantidad_origen NUMERIC, p_cantidad_obtenida NUMERIC,
  p_fecha_vencimiento_destino DATE, p_codigo_lote_destino TEXT,
  p_motivo TEXT
)
RETURNS TABLE (operacion_id UUID, lote_destino_id UUID,
               cantidad_teorica NUMERIC, cantidad_obtenida NUMERIC,
               desvio_porcentaje NUMERIC, costo_unitario_hijo NUMERIC,
               merma_registrada NUMERIC)
```

### 2.2. Cuerpo

```
BEGIN
  v_operacion := gen_random_uuid();

  -- ── RN-FR1: solo por conversión DEFINIDA y ACTIVA ────────────────────────
  -- No hay fraccionamiento libre entre dos productos cualesquiera.
  SELECT * INTO v_conv FROM producto_conversiones
   WHERE tenant_id = p_tenant_id
     AND producto_origen_id  = (SELECT producto_id FROM lotes
                                 WHERE id = p_lote_origen_id AND tenant_id = p_tenant_id)
     AND producto_destino_id = p_producto_destino_id
     AND activo;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVERSION_NOT_DEFINED'; END IF;

  SELECT l.*, p.unidad_medida_id AS unidad_origen
    INTO v_lote
    FROM lotes l JOIN productos p ON p.id = l.producto_id AND p.tenant_id = l.tenant_id
   WHERE l.id = p_lote_origen_id AND l.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  SELECT * INTO v_destino FROM productos
   WHERE id = p_producto_destino_id AND tenant_id = p_tenant_id;
  IF NOT FOUND            THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT v_destino.activo THEN RAISE EXCEPTION 'PRODUCT_INACTIVE';  END IF;

  -- ── RN-FR13: los decimales se validan contra la unidad de CADA producto ──
  -- El origen contra la unidad del origen, el destino contra la del destino.
  -- Fraccionar 0,5 cajas falla si "caja" no admite decimales, AUNQUE el destino
  -- (kg) sí los admita.
  IF NOT cantidad_valida_para_unidad(p_cantidad_origen, v_lote.unidad_origen)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;
  IF NOT cantidad_valida_para_unidad(p_cantidad_obtenida, v_destino.unidad_medida_id)
     THEN RAISE EXCEPTION 'UNIT_NO_DECIMALS'; END IF;

  -- ── Bloqueo del lote origen ──────────────────────────────────────────────
  PERFORM 1 FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_origen_id
     FOR UPDATE;

  IF v_existencia < p_cantidad_origen THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

  -- RN-LO4: un lote vencido NO se fracciona. No es overrideable.
  IF v_lote.fecha_vencimiento IS NOT NULL AND v_lote.fecha_vencimiento < CURRENT_DATE
     THEN RAISE EXCEPTION 'BATCH_EXPIRED'; END IF;
  IF v_lote.estado <> 'disponible' THEN RAISE EXCEPTION 'BATCH_BLOCKED'; END IF;

  -- ── Rendimiento ──────────────────────────────────────────────────────────
  v_teorico := p_cantidad_origen * v_conv.factor_teorico;

  -- RN-FR5: obtener MÁS que el teórico no es rendimiento: es error de carga o
  -- factor mal definido. Se rechaza.
  IF p_cantidad_obtenida <= 0 OR p_cantidad_obtenida > v_teorico
     THEN RAISE EXCEPTION 'INVALID_YIELD'; END IF;

  v_desvio := (v_teorico - p_cantidad_obtenida) / v_teorico * 100;

  -- ── RN-FR6: menos que el teórico es MERMA, no error ──────────────────────
  -- El sistema ADVIERTE si el desvío supera la tolerancia y exige motivo, pero
  -- NO BLOQUEA: el rendimiento real es un hecho, no una infracción. Si el
  -- sistema obligara a que rendimiento = factor, la gente falsearía los
  -- recuentos para cuadrar y el inventario dejaría de significar algo.
  SELECT tolerancia_rendimiento_porcentaje INTO v_tolerancia
    FROM configuracion_tenant WHERE tenant_id = p_tenant_id;

  IF v_desvio > COALESCE(v_tolerancia, 10) AND NOT motivo_valido(p_motivo)
     THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  -- ── RN-FR10 y RN-FR11: vencimiento del hijo ──────────────────────────────
  -- El contenido no dura más que el envase del que salió.
  IF v_lote.fecha_vencimiento IS NOT NULL
     AND p_fecha_vencimiento_destino IS NOT NULL
     AND p_fecha_vencimiento_destino > v_lote.fecha_vencimiento
     THEN RAISE EXCEPTION 'EXPIRY_AFTER_PARENT'; END IF;

  -- Sugerencia si no vino: LEAST(vencimiento del padre, hoy + vida útil post apertura).
  v_vencimiento := COALESCE(
    p_fecha_vencimiento_destino,
    LEAST(v_lote.fecha_vencimiento,
          CURRENT_DATE + COALESCE(v_destino.vida_util_post_apertura_dias, 36500))
  );

  -- ── RN-FR7: COSTO HEREDADO. Dividido por lo REALMENTE OBTENIDO. ──────────
  --   costo_total_consumido = cantidad_origen × costo_unitario_lote_padre
  --   costo_unitario_hijo   = costo_total_consumido / cantidad_REAL_obtenida
  --
  -- Con rendimiento menor al teórico el costo unitario del hijo SUBE, y está
  -- bien que suba: el kilo suelto efectivamente cuesta más porque para obtenerlo
  -- hubo que perder producto.
  --
  -- ERROR CLÁSICO: dividir por v_teorico. Da un costo prolijo, equivocado, y
  -- hace desaparecer el costo de fraccionar.
  v_costo_consumido := p_cantidad_origen * v_lote.costo_unitario_efectivo;
  v_costo_hijo      := round(v_costo_consumido / p_cantidad_obtenida, 4);

  -- ── Lote hijo ────────────────────────────────────────────────────────────
  INSERT INTO lotes (
    tenant_id, producto_id, codigo_lote, fecha_vencimiento, fecha_ingreso,
    costo_unitario_neto, costo_unitario_efectivo,
    lote_padre_id,          -- RN-FR4: obligatorio cuando origen = 'conversion'
    origen, proveedor_id, estado, usuario_id
  ) VALUES (
    p_tenant_id, p_producto_destino_id, p_codigo_lote_destino, v_vencimiento, CURRENT_DATE,
    v_costo_hijo, v_costo_hijo,
    p_lote_origen_id,
    'conversion', v_lote.proveedor_id, 'disponible', p_usuario_id
  )
  RETURNING id INTO v_lote_hijo;

  -- ── Los tres movimientos, MISMO operacion_id (RN-FR3) ────────────────────
  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total,
                                 lote_destino_id, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, 'salida_conversion', v_lote.producto_id, p_lote_origen_id,
          p_cantidad_origen, v_lote.costo_unitario_efectivo, round(v_costo_consumido, 2),
          v_lote_hijo, p_motivo, p_usuario_id);

  INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                 cantidad, costo_unitario, costo_total, motivo, usuario_id)
  VALUES (p_tenant_id, v_operacion, 'entrada_conversion', p_producto_destino_id, v_lote_hijo,
          p_cantidad_obtenida, v_costo_hijo,
          round(p_cantidad_obtenida * v_costo_hijo, 2), p_motivo, p_usuario_id);

  -- ── RN-FR8: la merma se registra EN CANTIDAD, con COSTO TOTAL CERO ───────
  -- El costo ya se reasignó ÍNTEGRAMENTE al lote hijo. Si además se le imputara
  -- costo a la merma, el mismo peso se contaría DOS VECES y el inventario
  -- quedaría sobrevaluado. El costo de fraccionar NO se registra como pérdida:
  -- se manifiesta como costo unitario más alto en el hijo.
  --
  -- Se registra SOBRE EL LOTE HIJO y en unidades de DESTINO: es la única forma
  -- de que la resta cierre, y es donde el usuario la ve ("esperaba 15 kg, saqué 14,2").
  IF p_cantidad_obtenida < v_teorico THEN
    INSERT INTO movimientos_stock (tenant_id, operacion_id, tipo, producto_id, lote_id,
                                   cantidad, costo_unitario, costo_total, motivo, usuario_id)
    VALUES (p_tenant_id, v_operacion, 'merma_fraccionamiento', p_producto_destino_id, v_lote_hijo,
            v_teorico - p_cantidad_obtenida,
            0, 0,                              -- CERO. Los dos.
            p_motivo, p_usuario_id);
  END IF;

  -- ── Auditoría, misma transacción ─────────────────────────────────────────
  INSERT INTO registros_auditoria (..., 'CREATE', 'inventory', v_operacion::text,
    jsonb_build_object('lote_origen', p_lote_origen_id, 'lote_destino', v_lote_hijo,
      'cantidad_origen', p_cantidad_origen, 'cantidad_obtenida', p_cantidad_obtenida,
      'cantidad_teorica', v_teorico, 'desvio_porcentaje', v_desvio,
      'costo_unitario_hijo', v_costo_hijo));

  RETURN QUERY SELECT v_operacion, v_lote_hijo, v_teorico, p_cantidad_obtenida,
                      v_desvio, v_costo_hijo, GREATEST(v_teorico - p_cantidad_obtenida, 0);
END;
```

**La merma va sobre el lote HIJO**, no sobre el padre. El padre ya entregó su cantidad completa
en `salida_conversion`; lo que falta es en unidades de destino y por eso se descuenta del hijo.

**No existe `desfraccionar_lote`. Nunca.** No hay conversión inversa, no hay RPC, no hay
permiso. Un error se corrige con **ajustes motivados** (C5), que quedan visibles como
corrección. Físicamente además es la verdad: la bolsa abierta no se vuelve a cerrar.

Cierre: `REVOKE`/`GRANT`/`NOTIFY pgrst`.

### 2.3. Tests unitarios — la aritmética del costo

Extraé el cálculo a `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.calculo.ts`:

```ts
export function costoUnitarioHijo(cantidadOrigen: number, costoPadre: number, cantidadObtenida: number) {
  return redondear4((cantidadOrigen * costoPadre) / cantidadObtenida);
}
export function desvioPorcentaje(teorico: number, obtenido: number) {
  return redondear2(((teorico - obtenido) / teorico) * 100);
}
```

| `it()` | Caso |
|---|---|
| `RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido` | Bolsa de **$45.000**, factor **15**, rendimiento **14,2** → costo del hijo **$3.169,0141/kg**. Asertá el valor exacto. **Y asertá que NO es $3.000,0000**, que es lo que da dividir por el teórico. Los dos `expect`. |
| `RN-FR7: el costo del hijo es MAYOR que el teórico cuando rinde menos` | Barrido de rendimientos de 100 % a 50 % → el costo unitario del hijo crece monótonamente. |
| `RN-FR7: con rendimiento 100 % el costo del hijo es exactamente el teórico` | Factor 15, obtenido 15 → $3.000,0000. Es el caso borde que confirma que la fórmula no introduce un sesgo. |
| `RN-FR11: el vencimiento sugerido es el menor de los dos` | Padre vence 2027-06-01, `vida_util_post_apertura_dias = 30`, hoy 2026-10-06 → sugiere **2026-11-05**. Padre vence 2026-10-20 con vida útil 30 → sugiere **2026-10-20**. |

### 2.4. Tests de integración

| `it()` | Caso |
|---|---|
| `RN-FR1: sin conversión definida no se fracciona` | Sin relación → `CONVERSION_NOT_DEFINED`. Con la relación **desactivada** → también. Los dos casos. |
| `RN-FR3: la operación es atómica` | Provocar el fallo **después** de la salida (por ejemplo, con un producto destino inactivo, que se valida antes; o forzando un vencimiento posterior al del padre) → **no quedó el lote hijo ni ningún movimiento**. Contá filas de `lotes` y `movimientos_stock` antes y después. |
| `RN-FR3: los tres movimientos comparten operacion_id` | Fraccionamiento con merma → **3** movimientos con el mismo `operacion_id`: `salida_conversion`, `entrada_conversion`, `merma_fraccionamiento`. |
| `RN-FR5: la cantidad obtenida no supera la teórica` | Bolsa con factor 15, declarar **15,5 kg** obtenidos → `INVALID_YIELD`. Declarar 15 → funciona. Declarar 0 → `INVALID_YIELD`. |
| `RN-FR6: menos que el teórico es merma, no error` | Factor 15, obtener **14,2** → funciona, y genera un `merma_fraccionamiento` de **0,8**. Con desvío 20 % y tolerancia 10 % **sin motivo** → `REASON_REQUIRED`. Con motivo → funciona. |
| `RN-FR8: la merma de fraccionamiento tiene costo cero` | Después del fraccionamiento: `SUM(costo_total * signo_movimiento(tipo))` de los tres movimientos de la operación → **0,00**. Y el valor total del inventario (`SUM(existencias_lote.cantidad * lotes.costo_unitario_efectivo)`) **es el mismo antes y después**. Las dos aserciones: fraccionar no cambia el valor del inventario. |
| `RN-FR10: el hijo no vence después que el padre` | Padre 2027-03-01, hijo declarado 2027-06-01 → `EXPIRY_AFTER_PARENT`. |
| `RN-FR13: los decimales se validan por producto` | Origen "caja" (`admite_decimales = false`), destino "comprimido": fraccionar **0,5** cajas → `UNIT_NO_DECIMALS`. Fraccionar 1 caja obteniendo 11,5 comprimidos (que tampoco admite decimales) → `UNIT_NO_DECIMALS`. Origen "bolsa" hacia destino "kg" con 1 bolsa → 14,2 kg → **funciona**. |
| `RN-LO4: un lote vencido no se fracciona` | Lote origen vencido → `BATCH_EXPIRED`, incluso con JWT de admin. |
| `el caso real del dueño: bolsa de 15 kg → kilos sueltos` | Bolsa de $45.000 con factor 15, obtener 14,2 kg. Verificar: lote hijo creado con `lote_padre_id`, `origen = 'conversion'`, costo $3.169,0141, existencia del padre bajó 1, existencia del hijo 14,2, merma 0,8 con costo 0. |

**RN-FR8 es el test que atrapa el segundo error clásico.** Si alguien le imputa costo a la
merma, la suma firmada de costos de la operación deja de dar cero y el valor del inventario
sube después de fraccionar, que es imposible físicamente.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR1 | Solo por conversión definida y activa. → `422 CONVERSION_NOT_DEFINED` | `it('RN-FR1: sin conversión definida no se fracciona', …)` |
| RN-FR3 | Operación atómica: salida, alta del hijo, entrada y merma comparten `operacion_id` y transacción. | `it('RN-FR3: la operación es atómica', …)` |
| RN-FR5 | La cantidad obtenida no supera la teórica. → `422 INVALID_YIELD` | `it('RN-FR5: la cantidad obtenida no supera la teórica', …)` |
| RN-FR6 | Menos que el teórico es merma: advierte sobre la tolerancia y exige motivo, pero registra. | `it('RN-FR6: menos que el teórico es merma, no error', …)` |
| RN-FR7 | El costo del hijo se calcula sobre lo **realmente obtenido**. | `it('RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido', …)` |
| RN-FR8 | La merma de fraccionamiento tiene costo **cero**. | `it('RN-FR8: la merma de fraccionamiento tiene costo cero', …)` |
| RN-FR10 | El hijo no vence después que el padre. → `422 EXPIRY_AFTER_PARENT` | `it('RN-FR10: el hijo no vence después que el padre', …)` |
| RN-FR11 | Vencimiento sugerido por vida útil post apertura. | `it('RN-FR11: el vencimiento sugerido es el menor de los dos', …)` |
| RN-FR13 | Decimales por producto: origen contra su unidad, destino contra la suya. → `422 UNIT_NO_DECIMALS` | `it('RN-FR13: los decimales se validan por producto', …)` |

## 4. Orden de trabajo

1. **Escribí `fraccionamiento.calculo.ts` y sus unit tests primero.** RN-FR7 es la regla más
   cara de descubrir tarde y la más barata de probar sin base.
2. Migración con marca y `NOTIFY`, aplicada.
3. Tests de integración en verde.
4. **Verificá RN-FR7 por mutación:** cambiá `v_costo_consumido / p_cantidad_obtenida` por
   `v_costo_consumido / v_teorico`, corré el caso real del dueño, confirmá que el costo da
   $3.000,0000 en vez de $3.169,0141 y que el test **falla**. Volvé al original.
5. **Verificá RN-FR8 por mutación:** ponele a la merma
   `costo_unitario = v_costo_hijo, costo_total = round(...)`, corré RN-FR8, confirmá que la
   suma deja de dar cero y que el valor del inventario **sube**. Anotá en cuánto subió. Volvé
   al original.
6. `npm test && npm run typecheck && npm run test:integration`.
7. Matriz.

## 5. Definición de hecho

```bash
# 1. El RPC existe y no lo ejecuta anon
psql "$DATABASE_URL" -c "SELECT proname, has_function_privilege('anon', oid, 'EXECUTE')
  FROM pg_proc WHERE proname='fraccionar_lote';"

# 2. NO existe ninguna función inversa
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%'
     OR proname ILIKE '%unir_lote%';"
# → cero filas

# 3. El costo se divide por la cantidad OBTENIDA
grep -n "costo_hijo" supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql
# → la división es por p_cantidad_obtenida, NO por v_teorico

# 4. La merma tiene costo cero
grep -n -A6 "merma_fraccionamiento" supabase/migrations/20261006000001_comercial_fraccionar_lote_rpc.sql
# → costo_unitario y costo_total en 0, los dos

# 5. Fraccionar no cambia el valor del inventario
#    (lo verifica RN-FR8, pero corroboralo a mano en la base de pruebas)

# 6. Tests
npx vitest run tests/unit/fraccionamiento.service.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/fraccionamiento.integration.test.ts
# → "N passed", "0 skipped"

# 7. Suites y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
```

**En el reporte, obligatorio:** el costo que dio la mutación de RN-FR7 y cuánto subió el valor
del inventario con la mutación de RN-FR8. Son los dos números que prueban que los tests
detectan los dos errores clásicos y no están pasando por casualidad.
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
