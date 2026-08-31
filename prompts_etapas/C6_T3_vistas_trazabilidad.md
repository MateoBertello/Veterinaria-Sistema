# ETAPA C6 · TANDA 3/4 — Vistas de fraccionamiento y cadena de trazabilidad
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T2 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **La vista `v_stock_familia_unidad_base` es la más peligrosa del módulo.** Sirve para
> responder *"¿cuánta amoxicilina tengo en total?"* sumando en la unidad base vía
> `factor_teorico`. **Cualquier uso de ella en un camino de escritura es un bug** (RN-FR12): un
> descuento que atraviese la conversión rompe la trazabilidad de lote y es exactamente el
> modelo que D-06 descartó. Por eso lleva su `COMMENT ON VIEW` diciéndolo.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.12 | `v_costo_fraccionamiento` y `v_stock_familia_unidad_base` con su advertencia. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06, D-06.a, D-06.b | El multi-nivel gratis y el reporte de costo de fraccionar. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.8 | RN-FR4 y RN-FR12. |
| `supabase/migrations/20260901000004_comercial_catalogo_tenant.sql` | El CTE recursivo del trigger anti-ciclo: el de trazabilidad es el mismo recorrido en la otra dirección. |
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

1. `supabase/migrations/20261006000002_comercial_vistas_fraccionamiento.sql`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/modules/stock/stock.service.ts` | `cadenaTrazabilidad(loteId, ctx)`, con el CTE recursivo. |
| `supabase/functions/api/src/modules/stock/stock.controller.ts` | `GET /lotes/:id/trazabilidad`. |
| `tests/integration/fraccionamiento.integration.test.ts` | RN-FR4 (cadena de tres niveles). |
| `tests/unit/fraccionamiento.service.test.ts` | RN-FR12. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR4, FR12. |

## 2. Especificación exacta

### 2.1. `v_costo_fraccionamiento`

Responde *"cuánto me cuesta fraccionar"*, que es el dato de gestión de D-06.a: si un producto
rinde sistemáticamente 12 % menos, eso tiene que estar en el precio del suelto.

```sql
CREATE OR REPLACE VIEW public.v_costo_fraccionamiento AS
WITH operaciones AS (
  SELECT m.tenant_id, m.operacion_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.producto_id END) AS producto_origen_id,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.producto_id END) AS producto_destino_id,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.cantidad END)    AS cantidad_origen,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.cantidad END)    AS cantidad_obtenida,
         COALESCE(max(CASE WHEN m.tipo = 'merma_fraccionamiento' THEN m.cantidad END), 0) AS merma,
         max(CASE WHEN m.tipo = 'salida_conversion'     THEN m.costo_total END) AS costo_consumido,
         max(CASE WHEN m.tipo = 'entrada_conversion'    THEN m.costo_unitario END) AS costo_unitario_hijo,
         min(m.created_at) AS fraccionado_at
  FROM movimientos_stock m
  WHERE m.tipo IN ('salida_conversion','entrada_conversion','merma_fraccionamiento')
  GROUP BY m.tenant_id, m.operacion_id
)
SELECT o.*,
       po.nombre AS producto_origen_nombre,
       pd.nombre AS producto_destino_nombre,
       pc.factor_teorico,
       o.cantidad_origen * pc.factor_teorico                       AS cantidad_teorica,
       -- El sobrecosto de fraccionar NO es una pérdida registrada: se manifiesta
       -- como costo unitario más alto en el hijo (D-06.b). Este es el número que
       -- lo hace visible.
       CASE WHEN pc.factor_teorico > 0 AND o.cantidad_obtenida > 0
            THEN (o.costo_unitario_hijo
                  - (o.costo_consumido / NULLIF(o.cantidad_origen * pc.factor_teorico, 0)))
                 * o.cantidad_obtenida
       END AS sobrecosto
FROM operaciones o
JOIN productos po ON po.id = o.producto_origen_id  AND po.tenant_id = o.tenant_id
JOIN productos pd ON pd.id = o.producto_destino_id AND pd.tenant_id = o.tenant_id
LEFT JOIN producto_conversiones pc
       ON pc.tenant_id = o.tenant_id
      AND pc.producto_origen_id  = o.producto_origen_id
      AND pc.producto_destino_id = o.producto_destino_id;
```

### 2.2. `v_stock_familia_unidad_base` — con su advertencia

```sql
CREATE OR REPLACE VIEW public.v_stock_familia_unidad_base AS
SELECT f.tenant_id, f.id AS familia_id, f.nombre AS familia_nombre,
       f.unidad_base_id, um.abreviatura AS unidad_base,
       sum(
         e.cantidad * COALESCE(
           -- Si el producto NO es la unidad base de la familia, se convierte
           -- dividiendo por el factor hacia la unidad base. Es una APROXIMACIÓN
           -- de reporte: el factor es teórico y el rendimiento real difiere.
           (SELECT 1 / NULLIF(pc.factor_teorico, 0)
              FROM producto_conversiones pc
             WHERE pc.tenant_id = e.tenant_id
               AND pc.producto_destino_id = e.producto_id
               AND pc.activo
             LIMIT 1),
           1)
       ) AS cantidad_en_unidad_base
FROM existencias_lote e
JOIN productos p         ON p.id = e.producto_id AND p.tenant_id = e.tenant_id
JOIN familias_producto f ON f.id = p.familia_id  AND f.tenant_id = p.tenant_id
JOIN unidades_medida um  ON um.id = f.unidad_base_id
WHERE e.cantidad > 0
GROUP BY f.tenant_id, f.id, f.nombre, f.unidad_base_id, um.abreviatura;

COMMENT ON VIEW public.v_stock_familia_unidad_base IS
  'SOLO REPORTE. Agrega existencias de una familia en su unidad base usando factor_teorico. CUALQUIER USO DE ESTA VISTA EN UN CAMINO DE ESCRITURA ES UN BUG (RN-FR12): descontar atravesando el factor rompe la trazabilidad de lote y es exactamente el modelo que D-06 descartó. Si falta existencia del derivado, el sistema OFRECE FRACCIONAR; no descuenta de la caja.';
```

### 2.3. Cadena de trazabilidad — RN-FR4

**Multi-nivel sale gratis:** caja→blíster es una conversión y blíster→comprimido es otra. No hay
jerarquía de niveles ni columna `nivel`, y la cadena se recorre siguiendo `lote_padre_id` con un
CTE recursivo.

```sql
CREATE OR REPLACE FUNCTION public.cadena_trazabilidad_lote(p_tenant_id UUID, p_lote_id UUID)
RETURNS TABLE (
  lote_id UUID, producto_id UUID, producto_nombre TEXT, codigo_lote TEXT,
  fecha_vencimiento DATE, costo_unitario_efectivo NUMERIC,
  nivel INTEGER, direccion TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- ASCENDENTE: de este lote hacia sus padres.
  WITH RECURSIVE ancestros AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, a.nivel - 1
    FROM lotes l JOIN ancestros a ON a.lote_padre_id = l.id
    WHERE l.tenant_id = p_tenant_id
  ),
  -- DESCENDENTE: de este lote hacia sus hijos.
  descendientes AS (
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, 0 AS nivel
    FROM lotes l WHERE l.id = p_lote_id AND l.tenant_id = p_tenant_id
    UNION ALL
    SELECT l.id, l.producto_id, l.codigo_lote, l.fecha_vencimiento,
           l.costo_unitario_efectivo, l.lote_padre_id, d.nivel + 1
    FROM lotes l JOIN descendientes d ON l.lote_padre_id = d.id
    WHERE l.tenant_id = p_tenant_id
  )
  SELECT x.id, x.producto_id, p.nombre, x.codigo_lote, x.fecha_vencimiento,
         x.costo_unitario_efectivo, x.nivel,
         CASE WHEN x.nivel < 0 THEN 'ancestro'
              WHEN x.nivel > 0 THEN 'derivado'
              ELSE 'origen' END
  FROM (SELECT * FROM ancestros UNION SELECT * FROM descendientes) x
  JOIN productos p ON p.id = x.producto_id AND p.tenant_id = p_tenant_id
  ORDER BY x.nivel;
$$;

REVOKE ALL ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cadena_trazabilidad_lote(UUID, UUID) TO service_role;
```

**El `UNION` (no `UNION ALL`) de la consulta final** deduplica el lote de origen, que aparece en
las dos ramas con `nivel = 0`. **Cada rama recursiva filtra por `p_tenant_id`**: sin eso, un
`lote_padre_id` que apuntara a otro tenant traería sus datos, y aunque la FK compuesta lo
impide, el filtro documenta el alcance y sobrevive al próximo refactor.

Cierre del archivo: `NOTIFY pgrst, 'reload schema';`.

### 2.4. `stock.service.ts` y el endpoint

```ts
/** RN-FR4: la cadena completa de un lote, hacia arriba y hacia abajo. */
async cadenaTrazabilidad(loteId: string, ctx: CallerContext) {
  const db = getServiceDb();
  const { data, error } = await db.rpc("cadena_trazabilidad_lote", {
    p_tenant_id: ctx.tenantId,
    p_lote_id:   loteId,
  });
  …
}
```

`GET /api/v1/lotes/:id/trazabilidad`, con `view_stock`.

### 2.5. Tests

**RN-FR4 en `fraccionamiento.integration.test.ts` — el caso real del dueño, tres niveles:**

| `it()` | Caso |
|---|---|
| `RN-FR4: la cadena recorre los tres niveles caja → blíster → comprimido` | (1) Crear producto "caja de 10 blísters", derivado "blíster" (factor 10) y derivado del blíster "comprimido" (factor 12). (2) Comprar 1 caja. (3) Fraccionar caja → 10 blísters. (4) Fraccionar 1 blíster → 12 comprimidos. (5) `cadena_trazabilidad_lote` desde el lote de comprimidos → **3 filas**, con niveles −2, −1 y 0. (6) Desde el lote de la caja → **3 filas**, con niveles 0, 1 y 2. Los seis pasos. |
| `RN-FR4: todo lote de origen conversión tiene padre` | `SELECT count(*) FROM lotes WHERE tenant_id = A AND origen = 'conversion' AND lote_padre_id IS NULL` → **0**. |
| `la cadena no cruza tenants` | Un lote de B no aparece en la cadena pedida con el tenant de A. |

**RN-FR12 en `fraccionamiento.service.test.ts` — el test que define el módulo:**

| `it()` | Caso |
|---|---|
| `RN-FR12: vender el derivado con existencia 0 falla, aunque haya existencia del padre` | Existencia **0** en "comprimido" y **positiva** en "caja", con la conversión caja→comprimido **activa**. `registrar_venta` de 1 comprimido → **falla con `INSUFFICIENT_STOCK`**. El sistema ofrece fraccionar; **no descuenta de la caja**. |
| `RN-FR12: ningún camino de escritura lee la vista de familia` | Guardrail estático: `grep` sobre `src/modules/` — ningún archivo que contenga `.rpc("registrar_venta"`, `.rpc("fraccionar_lote"`, `.rpc("ajustar_existencia"` o `.rpc("registrar_consumo_clinico"` menciona `v_stock_familia_unidad_base`. Escribilo como test, no como revisión manual. |
| `RN-FR12: ningún camino de escritura multiplica por factor_teorico` | Mismo criterio: ningún `.service.ts` del módulo usa `factor_teorico` fuera de `crearDerivado` y de las lecturas de reporte. |

**El primer caso de RN-FR12 es el que hay que escribir con más cuidado**, porque el fallo que
previene es el más "razonable" de todos: el usuario pide un comprimido, hay cajas, y total es lo
mismo. No es lo mismo: descontar atravesando el factor rompe la trazabilidad de lote y deja el
inventario diciendo que hay 0,916 cajas.

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR4 | El hijo guarda su padre y la cadena se recorre en los dos sentidos. | `it('RN-FR4: la cadena recorre los tres niveles caja → blíster → comprimido', …)` |
| RN-FR12 | El factor no descuenta existencia. **Nunca.** Se usa exclusivamente para reportes. → `409 INSUFFICIENT_STOCK` | Los tres `it('RN-FR12: …')` de 2.5 |

## 4. Orden de trabajo

1. Tests primero, en rojo.
2. Migración con marca y `NOTIFY`, aplicada.
3. `cadenaTrazabilidad` y el endpoint.
4. Los tres tests de RN-FR12.
5. `npm test && npm run typecheck && npm run test:integration`.
6. Matriz.

## 5. Definición de hecho

```bash
# 1. Las dos vistas existen y la peligrosa tiene su COMMENT
psql "$DATABASE_URL" -c "SELECT obj_description('public.v_stock_familia_unidad_base'::regclass,'pg_class');"
# → el texto tiene que decir "SOLO REPORTE" y "ES UN BUG"

# 2. Ningún camino de escritura menciona la vista de familia
grep -rn "v_stock_familia_unidad_base" supabase/functions/api/src/modules/
# → solo en el service/controller de REPORTES, nunca junto a un .rpc() de escritura

# 3. Ningún lote de conversión quedó sin padre
psql "$DATABASE_URL" -c "SELECT count(*) FROM lotes
  WHERE origen='conversion' AND lote_padre_id IS NULL;"
# → 0

# 4. La función de trazabilidad no la ejecuta anon
psql "$DATABASE_URL" -c "SELECT has_function_privilege('anon',
  'public.cadena_trazabilidad_lote(uuid,uuid)', 'EXECUTE');"
# → f

# 5. Tests
npx vitest run tests/unit/fraccionamiento.service.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/fraccionamiento.integration.test.ts
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
