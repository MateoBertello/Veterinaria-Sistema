# ETAPA C4 · TANDA 1/5 — Migración de ventas y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C3 completa y en verde, con el concurrente de RN-CJ4 pasando 200
> repeticiones.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.1 (redondeo del IVA), §4.7, §10.1, §10.2 | `ventas`, `ventas_items`, `ventas_pagos`, las columnas de `clientes` y de `servicios`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-03, D-08, D-10 | Registro interno sin facturación, cuenta corriente reservada, productos y servicios en la misma venta sin fusionar catálogos. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.6 | RN-VT1…VT8. |
| `PLAN_ETAPAS_COMERCIAL.md` §0.3 | `servicios` necesita su `UNIQUE (id, tenant_id)`. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Tus FKs compuestas y el CHECK de coherencia documental que hay que completar acá. |
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

1. `supabase/migrations/20260922000001_comercial_ventas.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/ventas.integration.test.ts` | **Crealo**: RN-VT3, RN-SC2 sobre las tablas nuevas. |
| `tests/integration/rls.test.ts` | Aislamiento de las tres tablas de venta (RN-SC4). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-VT3. |

## 2. Especificación exacta

### 2.0. Regla de redondeo del IVA — copiala, no la deduzcas

El precio que se carga y se cobra es el **precio final con IVA incluido**, porque así se exhibe
en el mostrador. La descomposición se calcula **por línea**:

```
neto_unitario = round(precio_unitario / (1 + alicuota/100), 2)
iva_unitario  = precio_unitario - neto_unitario     -- POR DIFERENCIA, nunca aparte
importe_linea = round(precio_unitario * cantidad, 2)
```

**El IVA se calcula por diferencia** para que `neto + iva = precio` sea exacto **siempre**. Si
se calculan y redondean los dos por separado, hay casos donde la suma da un centavo de más y el
total del ticket no cuadra con sus líneas. Es R-04 y es el error más fácil de cometer acá.

**El total de la venta es la suma de los importes de línea ya redondeados**, nunca un recálculo
desde los netos.

Esto se implementa en el RPC de C4·T2. Va acá para que la migración deje las columnas con la
precisión correcta y no haya que cambiarla después.

### 2.1. Columnas nuevas en tablas de producción

```sql
-- `servicios` necesita su UNIQUE (id, tenant_id) porque ventas_items.servicio_id
-- es una FK compuesta. El par ya es único por construcción (id es PK).
ALTER TABLE servicios ADD CONSTRAINT servicios_id_tenant_key UNIQUE (id, tenant_id);

-- La tabla no tiene precio, y NINGUNA del sistema lo tiene. Sin esto no se puede
-- cobrar una consulta en el mismo ticket que una pipeta. Nullable porque hay
-- servicios sin precio fijo; la línea de venta lo copia como snapshot.
ALTER TABLE servicios
  ADD COLUMN precio       NUMERIC(14,2) NULL,
  -- Consecuencia directa de D-03: si el IVA se discrimina por ítem y una venta
  -- puede tener líneas de servicio, el servicio necesita su alícuota. Sin esto,
  -- la mitad de las líneas quedaría sin IVA discriminado.
  ADD COLUMN alicuota_iva NUMERIC(5,2) NOT NULL DEFAULT 21.00
    CHECK (alicuota_iva IN (0, 10.50, 21, 27));

ALTER TABLE clientes
  ADD COLUMN condicion_fiscal            condicion_fiscal NOT NULL DEFAULT 'consumidor_final',
  -- D-08: reservadas. La cuenta corriente NO se implementa.
  ADD COLUMN cuenta_corriente_habilitada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN limite_credito              NUMERIC(14,2) NULL;
```

**No se agrega documento a `clientes`.** `dni_cuit` ya existe con `UNIQUE (tenant_id, dni_cuit)`
y la venta lo copia como snapshot. Duplicar el documento en dos columnas es la clase de
decisión que se paga tres meses después.

**Cargar la lista de precios de los servicios es una tarea de datos del dueño**, no del código.
Agregar la columna es una línea; llenarla no lo es, y hasta que esté hecha las líneas de
servicio no se pueden cobrar. Anotalo en el reporte.

### 2.2. `contadores_tenant`

```sql
CREATE TABLE contadores_tenant (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  valor      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nombre)
);
```

**Se implementa con una fila de contador bloqueada con `FOR UPDATE`, no con una `SEQUENCE`.**
Una sequence no es transaccional y deja huecos cuando una transacción falla, y un correlativo
interno con huecos genera preguntas del tipo *"¿dónde está la venta 341?"* que no tienen buena
respuesta. **Costo aceptado:** las ventas de un mismo tenant se serializan en ese contador;
para una clínica con uno o dos mostradores es irrelevante.

RLS: `FOR SELECT` con `tiene_permiso('view_sales')`.

### 2.3. `ventas`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `numero_operacion` | `BIGINT NOT NULL` | Correlativo por tenant. **No es un número de comprobante.** |
| `cliente_id` | `UUID NULL` | FK compuesta → `clientes`, `ON DELETE RESTRICT`. `NULL` = venta de mostrador anónima. |
| `condicion_fiscal_snapshot` | `condicion_fiscal NULL` | Copiada del cliente al registrar. |
| `documento_snapshot` | `TEXT NULL` | Copia de `clientes.dni_cuit`. |
| `sesion_caja_id` | `UUID NOT NULL` | FK compuesta → `sesiones_caja`, `ON DELETE RESTRICT`. **Toda venta pertenece a una sesión**, aunque no mueva efectivo: es lo que responde *"qué se vendió en el turno de la tarde"*. |
| `condicion_pago` | `condicion_pago_venta NOT NULL DEFAULT 'contado'` | |
| `subtotal_neto`, `total_iva`, `descuento_importe`, `total`, `saldo_pendiente` | `NUMERIC(14,2) NOT NULL DEFAULT 0` | |
| `estado` | `estado_venta NOT NULL DEFAULT 'registrada'` | |
| `anulada_at` | `TIMESTAMPTZ NULL` | |
| `anulada_por_usuario_id` | `UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `motivo_anulacion` | `TEXT NULL` | |
| `comprobante_tipo`, `comprobante_punto_venta`, `comprobante_numero`, `cae` | `TEXT NULL` | **Reservadas, sin uso.** |
| `cae_vencimiento` | `DATE NULL` | **Reservada.** |
| `facturacion_estado` | `estado_facturacion NOT NULL DEFAULT 'no_facturada'` | **Reservada.** |
| `observaciones` | `TEXT NULL` | |
| `usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `created_at` | | **Sin `updated_at`: una venta registrada no se edita.** |

```sql
ALTER TABLE ventas ADD CONSTRAINT ventas_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE ventas ADD CONSTRAINT uq_ventas_tenant_numero UNIQUE (tenant_id, numero_operacion);
CREATE INDEX idx_ventas_tenant_fecha   ON ventas (tenant_id, created_at DESC);
CREATE INDEX idx_ventas_tenant_sesion  ON ventas (tenant_id, sesion_caja_id);
CREATE INDEX idx_ventas_tenant_cliente ON ventas (tenant_id, cliente_id);
CREATE INDEX idx_ventas_tenant_usuario ON ventas (tenant_id, usuario_id, created_at DESC);

-- La anulación completa tres columnas de una: o están las tres o no está ninguna.
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_anulacion_completa CHECK (
  (estado = 'registrada' AND anulada_at IS NULL AND anulada_por_usuario_id IS NULL
                          AND motivo_anulacion IS NULL)
  OR
  (estado = 'anulada' AND anulada_at IS NOT NULL AND anulada_por_usuario_id IS NOT NULL
                       AND motivo_anulacion IS NOT NULL)
);
```

El índice por `(tenant_id, usuario_id, created_at)` no es decorativo: **la recepcionista no
tiene `view_sales`** y su listado filtra por `usuario_id` (§8.2, decisión 3).

### 2.4. `ventas_items`

```
id, tenant_id,
venta_id                UUID NOT NULL,  -- FK compuesta → ventas, ON DELETE RESTRICT
tipo_item               tipo_item_venta NOT NULL,
producto_id             UUID NULL,      -- FK compuesta → productos, ON DELETE RESTRICT
servicio_id             UUID NULL,      -- FK compuesta → servicios, ON DELETE RESTRICT
descripcion_snapshot    TEXT NOT NULL,
cantidad                NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
precio_unitario         NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),  -- CON IVA incluido
alicuota_iva            NUMERIC(5,2) NOT NULL,   -- COPIADA, no referenciada
descuento_porcentaje    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (descuento_porcentaje BETWEEN 0 AND 100),
neto_unitario           NUMERIC(14,2) NOT NULL,
iva_unitario            NUMERIC(14,2) NOT NULL,
importe_total           NUMERIC(14,2) NOT NULL,
costo_unitario_efectivo NUMERIC(14,4) NULL,   -- solo productos; promedio ponderado de la línea
mascota_id              UUID NULL,      -- FK compuesta → mascotas, ON DELETE SET NULL
receta_id               UUID NULL,      -- RESERVADA, sin FK
profesional_prescriptor_id UUID NULL,   -- RESERVADA, sin FK
created_at
```

**RN-VT3, el CHECK que define la unión en la línea:**

```sql
ALTER TABLE ventas_items ADD CONSTRAINT chk_ventas_items_tipo CHECK (
  (tipo_item = 'producto' AND producto_id IS NOT NULL AND servicio_id IS NULL)
  OR
  (tipo_item = 'servicio' AND servicio_id IS NOT NULL AND producto_id IS NULL)
);
```

`ALTER TABLE ventas_items ADD CONSTRAINT ventas_items_id_tenant_key UNIQUE (id, tenant_id);`
`CREATE INDEX idx_ventas_items_venta ON ventas_items (tenant_id, venta_id);`

**La línea NO tiene `lote_id`, y es a propósito.** Una línea de 5 unidades puede resolverse
tomando 3 de un lote y 2 de otro por FEFO. La asignación vive en `movimientos_stock`, con N
movimientos por línea. Poner `lote_id` en la línea obligaría a partirla en dos y el cliente
vería dos renglones del mismo producto en su ticket sin entender por qué. **Si te dan ganas de
agregarlo, no lo hagas.**

`costo_unitario_efectivo` se **guarda** —promedio ponderado de los movimientos de la línea—
para el reporte de margen. No se recalcula nunca (RN-MV6).

### 2.5. `ventas_pagos`

```
id, tenant_id,
venta_id       UUID NOT NULL,   -- FK compuesta → ventas, ON DELETE RESTRICT
medio_pago_id  UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
importe        NUMERIC(14,2) NOT NULL CHECK (importe > 0),
referencia     TEXT NULL,
created_at
```

Pago mixto = varias filas. `SUM(importe) + saldo_pendiente = ventas.total` es RN-CJ1 y lo
valida el RPC, no un CHECK: la suma cruza filas y un CHECK no puede verla.

### 2.6. La FK diferida de `movimientos_stock`

C2·T1 declaró `venta_item_id` sin FK porque la tabla no existía:

```sql
ALTER TABLE movimientos_stock
  ADD CONSTRAINT movimientos_stock_venta_item_tenant_fkey
  FOREIGN KEY (venta_item_id, tenant_id) REFERENCES ventas_items (id, tenant_id)
  ON DELETE RESTRICT;
```

Ídem `movimientos_caja.venta_id` → `ventas (id, tenant_id)`, `ON DELETE RESTRICT`.

### 2.7. RLS

| Tabla | Permiso |
|---|---|
| `ventas`, `ventas_items`, `ventas_pagos`, `contadores_tenant` | `view_sales` |

**`view_sales` solo lo tiene el admin** (§8.2). La recepcionista ve sus ventas por la API,
donde el Service filtra por `usuario_id`; por PostgREST directo no ve ninguna, y está bien.

### 2.8. Tests

**`tests/integration/ventas.integration.test.ts`** (crealo, reusando el arnés de
`caja.integration.test.ts`):

| `it()` | Caso |
|---|---|
| `RN-VT3: una línea es de producto o de servicio, nunca las dos` | `INSERT` con `tipo_item='producto'` y los **dos** ids → viola el CHECK. Con `tipo_item='producto'` y **ninguno** → viola. Con `tipo_item='servicio'` y `producto_id` puesto → viola. Con cada combinación válida → funciona. |
| `una venta registrada no se puede dejar a medio anular` | `UPDATE` a `estado='anulada'` sin `motivo_anulacion` → viola `chk_ventas_anulacion_completa`. |
| `el número de operación es único por tenant` | Dos ventas del mismo tenant con `numero_operacion = 1` → falla. El mismo número en otro tenant → funciona. |
| `RN-SC2: una venta de A no puede colgar de una sesión de caja de B` | FK compuesta, `23503`. |
| `RN-SC2: una línea de A no puede referenciar un servicio de B` | Ídem. |

**En `rls.test.ts`:** B no ve `ventas`, `ventas_items` ni `ventas_pagos` de A; A con
`view_sales` sí ve las suyas; B no puede escribirlas por PostgREST.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-VT3 | Línea de producto o de servicio, nunca las dos ni ninguna. → `422 INVALID_ITEM_TYPE` | `it('RN-VT3: una línea es de producto o de servicio, nunca las dos', …)` |
| RN-SC2 | FK compuesta cross-tenant sobre las tablas nuevas. | Dos `it('RN-SC2: …')` más |
| RN-SC4 | Aislamiento por RLS de las cuatro tablas nuevas. **Bloqueante.** | Cuatro `it('RN-SC4: …')` más |

## 4. Orden de trabajo

1. Migración con marca, aplicada.
2. Tests. **Verificá el CHECK de RN-VT3 por mutación**: sacalo, confirmá que el test se pone
   rojo en los tres casos inválidos, volvé a ponerlo. Reportá el mensaje.
3. `rls.test.ts` extendido.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. Las cuatro tablas y sus constraints
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('ventas','ventas_items','ventas_pagos','contadores_tenant');"

# 2. ventas_items NO tiene lote_id
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='ventas_items' AND column_name='lote_id';"
# → CERO FILAS. Si aparece, se rompió la decisión de §4.7 y hay que sacarla.

# 3. contadores_tenant NO es una sequence
psql "$DATABASE_URL" -c "SELECT sequencename FROM pg_sequences
  WHERE schemaname='public' AND sequencename ILIKE '%venta%';"
# → cero filas. El correlativo va por fila bloqueada, no por sequence.

# 4. servicios tiene precio y alicuota_iva
psql "$DATABASE_URL" -c "SELECT column_name, is_nullable, column_default
  FROM information_schema.columns WHERE table_name='servicios'
  AND column_name IN ('precio','alicuota_iva');"
# → precio nullable; alicuota_iva NOT NULL default 21.00

# 5. Las FKs diferidas de C2·T1 quedaron cerradas
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE contype='f'
  AND conname IN ('movimientos_stock_venta_item_tenant_fkey',
                  'movimientos_stock_compra_item_tenant_fkey',
                  'movimientos_caja_venta_tenant_fkey');"
# → las tres. Solo queda pendiente la de recuento_id, que es de C5·T1.

# 6. Los seis UNIQUE (id, tenant_id) de la resolución 0.3 están completos
psql "$DATABASE_URL" -c "SELECT conrelid::regclass FROM pg_constraint
  WHERE contype='u' AND conname LIKE '%_id_tenant_key'
  AND conrelid::regclass::text IN
  ('clientes','mascotas','historial_clinico','plan_vacunacion','servicios');"
# → las cinco

# 7. Tests
npx vitest run --config vitest.integration.config.ts \
  tests/integration/ventas.integration.test.ts tests/integration/rls.test.ts
# → "N passed", "0 skipped"

# 8. Suites completas
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
