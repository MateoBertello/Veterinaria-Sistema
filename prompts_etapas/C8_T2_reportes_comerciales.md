# ETAPA C8 · TANDA 2/3 — Los seis reportes comerciales
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C8·T1 en verde, con el fixture cargado y `verificar_existencias` en cero.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Tanda mecánica, y está bien que lo sea.** Son seis consultas de lectura sobre vistas que ya
> existen desde C4, C6 y C7. Lo único que hay que cuidar es que **ninguna recalcule un costo**:
> todas usan el costo efectivo guardado. Un join a `productos.costo_reposicion` es más corto de
> escribir y es el error R-03 de la spec.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §11 Etapa C8 | La lista de los reportes. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 | Las vistas que ya existen: `v_items_vendidos`, `v_margen_venta`, `v_costo_fraccionamiento`, `v_existencia_producto`. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-04 y §12.1 R-03 | Costo efectivo vs. costo de reposición, y por qué recalcular es el atajo que rompe la rentabilidad. |
| `supabase/migrations/20260922000004_comercial_vistas_venta.sql` | Tus vistas de C4·T4. |
| `supabase/migrations/20261006000002_comercial_vistas_fraccionamiento.sql` | Tus vistas de C6·T3. |
| `supabase/migrations/20261013000002_comercial_vistas_consumo.sql` | Tu vista de C7·T3. |
| `CLAUDE.md` sección de N+1 | Todos los reportes agregan datos relacionados: una consulta cada uno. |
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

1. `supabase/migrations/20261020000002_comercial_vistas_reportes.sql`
2. `supabase/functions/api/src/modules/reportes/reportes.schemas.ts`
3. `supabase/functions/api/src/modules/reportes/reportes.service.ts`
4. `supabase/functions/api/src/modules/reportes/reportes.controller.ts`
5. `tests/unit/reportes.service.test.ts`
6. `tests/unit/reportes.controller.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/reportes", reportesRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"reportes"` a `MODULOS_COMERCIALES`. |
| `tests/integration/reportes.integration.test.ts` | Los casos de los seis reportes contra el fixture. |

**La valorización a fecha ya existe** desde C8·T1: se expone desde `stock`, no se duplica acá.

## 2. Especificación exacta

### 2.0. La regla que gobierna los seis

**Ningún reporte recalcula un costo.** Todos usan lo que quedó guardado cuando la operación
ocurrió: `movimientos_stock.costo_unitario`, `ventas_items.costo_unitario_efectivo`,
`lotes.costo_unitario_efectivo`. **Ninguno joinea `productos.costo_reposicion`.**

El costo de reposición sirve para **fijar el precio de venta**, porque el precio tiene que cubrir
reponer. El costo efectivo sirve para **valuar y calcular el margen histórico**. Los dos números
conviven y se muestran separados: el reporte de rentabilidad usa el primero, la pantalla de
fijación de precios el segundo. Mezclarlos es como se funde un negocio con inflación creyendo
que gana plata.

### 2.1. Rotación y productos sin movimiento

```sql
CREATE OR REPLACE VIEW public.v_rotacion_producto AS
SELECT p.tenant_id, p.id AS producto_id, p.nombre, p.familia_id, p.activo,
       COALESCE(e.cantidad_actual, 0)                    AS existencia_actual,
       COALESCE(s.salidas_90d, 0)                        AS salidas_90d,
       COALESCE(s.salidas_365d, 0)                       AS salidas_365d,
       ult.ultimo_movimiento_at,
       -- Días de cobertura: a la velocidad de salida de los últimos 90 días,
       -- cuánto dura lo que queda. NULL cuando no hubo salidas: dividir por cero
       -- daría "infinito", que en una pantalla se lee como un número.
       CASE WHEN COALESCE(s.salidas_90d, 0) > 0
            THEN round(COALESCE(e.cantidad_actual, 0) / (s.salidas_90d / 90.0), 1)
       END AS dias_cobertura
FROM productos p
LEFT JOIN (
  SELECT el.tenant_id, el.producto_id, sum(el.cantidad) AS cantidad_actual
  FROM existencias_lote el GROUP BY 1, 2
) e ON e.producto_id = p.id AND e.tenant_id = p.tenant_id
LEFT JOIN (
  SELECT m.tenant_id, m.producto_id,
         sum(CASE WHEN m.created_at >= now() - interval '90 days'
                   AND signo_movimiento(m.tipo) = -1 THEN m.cantidad ELSE 0 END) AS salidas_90d,
         sum(CASE WHEN m.created_at >= now() - interval '365 days'
                   AND signo_movimiento(m.tipo) = -1 THEN m.cantidad ELSE 0 END) AS salidas_365d
  FROM movimientos_stock m GROUP BY 1, 2
) s ON s.producto_id = p.id AND s.tenant_id = p.tenant_id
LEFT JOIN (
  SELECT m.tenant_id, m.producto_id, max(m.created_at) AS ultimo_movimiento_at
  FROM movimientos_stock m GROUP BY 1, 2
) ult ON ult.producto_id = p.id AND ult.tenant_id = p.tenant_id;
```

**"Productos sin movimiento" no es una vista aparte**: es esta misma con
`ultimo_movimiento_at IS NULL OR ultimo_movimiento_at < :fecha`. Crear dos vistas que difieren en
un `WHERE` es la clase de duplicación que después diverge.

### 2.2. Rentabilidad por producto y por familia

Sale de `v_margen_venta`, que ya existe desde C4·T4 y **ya usa el costo guardado**. El reporte
agrega:

```sql
CREATE OR REPLACE VIEW public.v_rentabilidad_producto AS
SELECT mv.tenant_id, mv.tipo_item, mv.item_id, mv.item_nombre,
       p.familia_id, f.nombre AS familia_nombre,
       count(*)                       AS lineas,
       sum(mv.cantidad)               AS unidades,
       sum(mv.importe_total)          AS facturado,
       sum(mv.neto_total)             AS neto,
       sum(mv.costo_total)            AS costo,
       sum(mv.margen)                 AS margen,
       CASE WHEN sum(mv.neto_total) > 0
            THEN round(sum(mv.margen) / sum(mv.neto_total) * 100, 2)
       END                            AS margen_porcentaje
FROM v_margen_venta mv
LEFT JOIN productos p         ON p.id = mv.item_id AND p.tenant_id = mv.tenant_id
                              AND mv.tipo_item = 'producto'
LEFT JOIN familias_producto f ON f.id = p.familia_id AND f.tenant_id = p.tenant_id
GROUP BY 1,2,3,4,5,6;
```

El `LEFT JOIN` a `productos` con la condición de `tipo_item` es lo que permite que las líneas de
servicio entren al reporte sin familia, que es correcto: un servicio no tiene familia de
producto. Es el costo de no fusionar los catálogos (D-10), y es todo el costo.

### 2.3. Costo de fraccionamiento

Ya existe: `v_costo_fraccionamiento`, de C6·T3. El reporte la agrega por producto de origen —
merma acumulada, sobrecosto acumulado, cantidad de operaciones, desvío promedio. **No crees una
vista nueva**: agregá sobre la que hay.

### 2.4. Ventas por usuario, por sesión y por medio de pago

```sql
CREATE OR REPLACE VIEW public.v_ventas_por_medio AS
SELECT v.tenant_id, v.sesion_caja_id, v.usuario_id, v.created_at::date AS fecha,
       mp.codigo AS medio_pago, mp.nombre AS medio_pago_nombre, mp.afecta_arqueo,
       count(DISTINCT v.id) AS ventas,
       sum(vp.importe)      AS importe
FROM ventas v
JOIN ventas_pagos vp ON vp.venta_id = v.id AND vp.tenant_id = v.tenant_id
JOIN medios_pago mp  ON mp.id = vp.medio_pago_id
WHERE v.estado = 'registrada'          -- las anuladas NO cuentan como venta
GROUP BY 1,2,3,4,5,6,7;
```

**`WHERE v.estado = 'registrada'` no es opcional.** Una venta anulada tiene contra-asientos de
existencia y de caja, pero su fila sigue en `ventas` (RN-VT4): si el reporte la contara, el total
vendido del turno no cerraría con el arqueo.

Los tres cortes —usuario, sesión, medio— salen de esta vista agrupando distinto. Una vista, tres
agrupaciones.

### 2.5. Consumo clínico por profesional y por especie

Sale de `v_consumo_clinico`, de C7·T3, que ya trae `professional_id` y `especie_id`. Agregación
por profesional y por especie con cantidad de consumos, unidades y costo total.

**Si C7 no está implementada**, este reporte no se puede escribir. C8 depende de C4, C6 **y C7**.
Verificalo antes de empezar:

```bash
psql "$DATABASE_URL" -c "SELECT viewname FROM pg_views WHERE viewname='v_consumo_clinico';"
```
Si no existe, **frená y reportá**.

### 2.6. Service, Controller y rutas

`ReporteService` con un método por reporte, todos con filtro de tenant y paginación, todos con
`desde`/`hasta` donde aplique.

```ts
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"),
  // Los reportes de venta y de rentabilidad exponen las ventas de TODOS los
  // usuarios: eso es view_sales (§8.2 decisión 3), que solo tiene el admin.
  // Los de stock y consumo van con view_stock.
];
```

| Método | Ruta | Módulo | Permiso |
|---|---|---|---|
| GET | `/api/v1/reportes/rotacion` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/sin-movimiento` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/rentabilidad` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/costo-fraccionamiento` | `stock` | `view_stock` |
| GET | `/api/v1/reportes/ventas-por-medio` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/ventas-por-usuario` | `ventas` | **`view_sales`** |
| GET | `/api/v1/reportes/consumo-clinico` | `stock` | `view_stock` |

**Los tres reportes de venta exigen `view_sales`, no `manage_sales`.** La recepcionista registra
ventas y ve las suyas; un reporte de rentabilidad de toda la clínica es otra cosa.

Como el módulo requerido difiere por ruta, usá **dos routers** en el mismo archivo
(`reportesStockRouter` y `reportesVentasRouter`) y montalos los dos en `/reportes`, igual que
`main.ts` ya hace con `/doctores` (registros aditivos en el mismo prefijo).

### 2.7. Tests

**`tests/unit/reportes.service.test.ts`:**

| `it()` | Caso |
|---|---|
| `RN-MV6: ningún reporte joinea costo_reposicion` | Guardrail: el archivo del Service **no contiene** la cadena `costo_reposicion`. Escribilo como test. |
| `los siete reportes filtran por tenant` | Los siete `.eq("tenant_id", ctx.tenantId)`. |
| `la rentabilidad excluye las ventas anuladas` | Mock con una venta `anulada` → no entra en el total. |
| `no hay N+1 en ningún reporte` | Una llamada a `.from()` por reporte. |
| `sin fecha desde/hasta el reporte no barre todo` | Los reportes con rango tienen un default acotado (últimos 90 días), no "todo el historial". Sobre 60.000 movimientos la diferencia se nota. |

**`tests/unit/reportes.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo |
|---|:--:|:--:|:--:|:--:|
| `GET /reportes/rotacion` | 200 | 200 | 200 | 403 (`stock`) |
| `GET /reportes/rentabilidad` | 200 | **403** | **403** | 403 (`ventas`) |
| `GET /reportes/ventas-por-usuario` | 200 | **403** | **403** | 403 (`ventas`) |
| `GET /reportes/consumo-clinico` | 200 | 200 | 200 | 403 (`stock`) |

**En `tests/integration/reportes.integration.test.ts`, contra el fixture:**

| `it()` | Caso |
|---|---|
| `los siete reportes devuelven filas sobre el fixture` | Cada uno con al menos una fila para el tenant sintético 1. Un reporte que devuelve vacío contra 60.000 movimientos tiene un filtro mal. |
| `la rotación identifica productos sin movimiento` | El fixture deja al menos un producto sin movimientos → aparece en `/sin-movimiento` con `ultimo_movimiento_at` en `NULL`. |
| `las ventas por medio cuadran con el arqueo` | Para una sesión cerrada del fixture: la suma de los medios con `afecta_arqueo` del reporte **es igual** a `saldo_teorico_efectivo − saldo_inicial` de la sesión. Es la comprobación cruzada que detecta si el reporte cuenta ventas anuladas. |
| `el consumo clínico por profesional suma lo mismo que el costo por atención` | Los dos reportes, sobre el mismo rango, dan el mismo total. Salen de la misma vista y tienen que coincidir; si no, uno de los dos filtra de más. |
| `ningún reporte cruza tenants` | Los tres tenants sintéticos dan números distintos y ninguno incluye filas de otro. |

## 3. RN que cubre esta tanda

**Ninguna RN nueva.** La reverificación de RN-MV6 y RN-FR8 sobre datos reales es de C8·T3.
**No toques la matriz en esta tanda.**

## 4. Orden de trabajo

1. **Verificá que `v_consumo_clinico` existe** (2.5). Si no, frená y reportá: C8 depende de C7.
2. Migración de vistas, con marca, aplicada.
3. Tests unitarios en rojo, después el Service.
4. Controller, los dos routers, rutas en `main.ts`.
5. `"reportes"` a `MODULOS_COMERCIALES` en G1.
6. Los tests de integración contra el fixture.
7. `npm test && npm run typecheck && npm run test:integration`.

## 5. Definición de hecho

```bash
# 1. NINGÚN reporte recalcula el costo
grep -rn "costo_reposicion" supabase/functions/api/src/modules/reportes/ \
  supabase/migrations/20261020000002_comercial_vistas_reportes.sql
# → SIN RESULTADOS. Es R-03 y es el error más fácil de cometer acá.

# 2. La rentabilidad excluye las anuladas
grep -n "registrada" supabase/migrations/20261020000002_comercial_vistas_reportes.sql
# → aparece en v_ventas_por_medio; v_margen_venta ya lo filtraba desde C4·T4

# 3. Los reportes de venta exigen view_sales
grep -n "view_sales\|view_stock" supabase/functions/api/src/modules/reportes/reportes.controller.ts
# → view_sales en rentabilidad y en los dos de ventas; view_stock en el resto

# 4. Los siete reportes devuelven filas contra el fixture
npx vitest run --config vitest.integration.config.ts tests/integration/reportes.integration.test.ts
# → "N passed", "0 skipped"

# 5. Sin N+1
grep -n -A3 -E '\.(map|forEach)\(' supabase/functions/api/src/modules/reportes/reportes.service.ts | grep -c "await db"
# → 0

# 6. Tests y guardrails
npx vitest run tests/unit/reportes.service.test.ts tests/unit/reportes.controller.test.ts \
  tests/unit/tenant-filter-guardrail.test.ts
npm test && npm run typecheck
# → todo passed; el it.each de cobertura de G1 corre con 10 módulos
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
