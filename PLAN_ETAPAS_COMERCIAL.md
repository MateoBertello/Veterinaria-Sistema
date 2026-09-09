# PLAN_ETAPAS_COMERCIAL.md — Módulo Comercial (stock, costos y caja)

**Alcance: C1 a C8.** C9 (cuenta corriente) sigue siendo condicional a P-03.

> **Nota de historia del documento.** C7 y C8 se planificaron en una adenda posterior, después
> de que C1–C6 ya estuvieran cerradas. **Nada de C1 a C6 cambió**: ni la numeración, ni el corte
> en tandas, ni los prompts. C7 y C8 se agregaron al final, y la única consecuencia sobre lo
> anterior es que las cinco filas RN-CC de la matriz pasan de `N/A` a `PENDIENTE` **en C7·T1**,
> no antes — así los controles de cierre de C6·T4 siguen dando lo que esperan.

**Fuente de verdad:** `docs/ESPEC_MODULO_COMERCIAL.md` v1.0 + las **seis resoluciones de
planificación** de la sección 0 de este documento, que tienen precedencia sobre la spec en
todo lo que redefinen. Cuando la spec pase a v1.1 incorporándolas, esta sección queda como
registro de por qué dicen lo que dicen.

**Cómo se usa este plan.** Una etapa por vez, una tanda por sesión. Una etapa está
**terminada** cuando: (a) todas sus RN tienen test que cita su código en el `it()` y pasa,
(b) los tres guardrails de la sección 0.7 siguen en verde, (c) `tests/integration/rls.test.ts`
sigue en verde con las tablas nuevas, (d) el usuario revisó y aprobó los diffs. Recién
entonces se avanza.

---

## 0. Resoluciones de planificación

Las seis primeras salieron de verificar la spec contra el repositorio real y están
confirmadas por el dueño. Las tres últimas son decisiones de producto que el dueño respondió
en la Fase 1.

### 0.1 — Nombres de tabla en plural

La spec usa `movimiento_stock` / `existencia_lote` en D-02 y `movimientos_stock` /
`existencias_lote` en §4.4, §4.12 y §5. **El repositorio es plural sin excepción**
(`servicios`, `turnos`, `estadias`, `mascotas`, `clientes`, `registros_auditoria`,
`modulos_contratados`).

**Los nombres definitivos son plurales**, y así van escritos en cada prompt:

```
movimientos_stock   existencias_lote   lotes   productos   proveedores
familias_producto   producto_conversiones   compras   compras_items
ventas   ventas_items   ventas_pagos   cajas   sesiones_caja
movimientos_caja    recuentos   recuentos_detalle   contadores_tenant
```

### 0.2 — La columna "Etapa" de §5 está desfasada

La tabla de RPCs de §5 quedó escrita antes de que §11 partiera caja y ventas en dos etapas.
Dice `registrar_venta`→C3, `ajustar_existencia`→C4, `fraccionar_lote`→C5,
`registrar_consumo_clinico`→C6. **§11 es la autoridad.** La asignación correcta:

| RPC | Etapa |
|---|---|
| `confirmar_compra`, `recalcular_existencias`, `verificar_existencias` | C2 |
| `abrir_sesion_caja`, `registrar_movimiento_caja`, `cerrar_sesion_caja` | C3 |
| `registrar_venta`, `anular_venta` | **C4** |
| `ajustar_existencia`, `aplicar_recuento`, `registrar_devolucion` | **C5** |
| `fraccionar_lote` | **C6** |
| `registrar_consumo_clinico` | C7 — fuera de esta tanda |

### 0.3 — `UNIQUE (id, tenant_id)` falta en cinco tablas de producción

La convención de FKs compuestas de §4 exige que el lado referenciado tenga su
`UNIQUE (id, tenant_id)`. Hoy solo lo tienen `roles`
(`20260725000005_usuarios_integridad_referencial.sql`) y `especies` / `razas` /
`tipos_vacuna` (`20260827000001_catalogos_por_tenant.sql`).

**Faltan en cinco tablas vivas**, y se agregan en la migración de la tanda que las necesita:

| Tabla | Lo pide | Tanda |
|---|---|---|
| `clientes` | `proveedores.cliente_id` | **C1·T3** |
| `mascotas` | `movimientos_stock.mascota_id` | **C2·T1** |
| `historial_clinico` | `movimientos_stock.historial_id` | **C2·T1** |
| `plan_vacunacion` | `movimientos_stock.plan_vacunacion_id` | **C2·T1** |
| `servicios` | `ventas_items.servicio_id` | **C4·T1** |

Es DDL aditivo sobre tablas con datos, pero sin riesgo: el par `(id, tenant_id)` ya es único
por construcción porque `id` es PK. No hace falta guarda previa de datos.

### 0.4 — ErrorCodes que §7 no tiene

§7 no define ningún `*_NOT_FOUND` de catálogo, así que un `GET /productos/:id` inexistente se
queda sin código. Y RN-PR12 (nombre duplicado) apunta a `PRODUCT_CODE_DUPLICATE`, que es del
SKU. **Se agregan nueve códigos** al bloque de §7, además de los que la spec ya lista:

```ts
  PRODUCT_NOT_FOUND      = "PRODUCT_NOT_FOUND",
  PRODUCT_NAME_DUPLICATE = "PRODUCT_NAME_DUPLICATE",
  FAMILY_NOT_FOUND       = "FAMILY_NOT_FOUND",
  SUPPLIER_NOT_FOUND     = "SUPPLIER_NOT_FOUND",
  CONVERSION_NOT_FOUND   = "CONVERSION_NOT_FOUND",
  PURCHASE_NOT_FOUND     = "PURCHASE_NOT_FOUND",
  SALE_NOT_FOUND         = "SALE_NOT_FOUND",
  CASH_SESSION_NOT_FOUND = "CASH_SESSION_NOT_FOUND",
  COUNT_NOT_FOUND        = "COUNT_NOT_FOUND",
```

**RN-PR12 pasa a devolver `409 PRODUCT_NAME_DUPLICATE`**, no `PRODUCT_CODE_DUPLICATE`.

### 0.5 — Agregar un valor a `modulo_vendible` toca seis archivos de código

La spec solo menciona `on_tenant_created()`. En el repo real, `ModuloVendible` está escrito a
mano en seis lugares más:

| Archivo | Qué hay que tocar |
|---|---|
| `supabase/functions/api/src/middleware/requireModule.ts` | `export type ModuloVendible` (línea 6) |
| `supabase/functions/api/src/modules/modulos/modulos.schemas.ts` | `ModuloVendibleEnum` (z.enum) |
| `web/src/types/index.ts` | `export type ModuloVendible` (línea 852) |
| `web/src/lib/navigation.ts` | `MODULE_NAV: Record<ModuloVendible, …>` |
| `web/src/lib/planes.ts` | `MODULO_META: Record<ModuloVendible, …>` y `MODULOS_ORDEN` |
| `web/src/lib/dashboard.ts` | usa `ModuloVendible` en `QUICK_ACTIONS` |

Los tres `Record<ModuloVendible, …>` hacen que `npm run typecheck` exija los dos valores
nuevos, así que el olvido se detecta. Los otros tres no: un `z.enum` incompleto rechaza el
toggle del Super Admin en runtime, sin error de compilación.

### 0.6 — `npm test` no corre integración

`npm test` = `vitest run tests/unit`. Toda RN que prueba que **la base rechaza** algo
—RN-MV2, MV5, MV11, RN-SC2, SC3, SC8, RN-CJ4— vive en `tests/integration/`, que necesita
`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY` y `TEST_SUPABASE_SERVICE_ROLE_KEY`.

Sin esas variables, `describeIntegration` (`tests/integration/_env.ts`) marca las suites como
**skipped**. Un skipped no es un falso verde, pero tampoco es una prueba, y "la suite pasó" se
puede decir de las dos.

**Consecuencia para toda tanda con tests de integración:** la definición de hecho exige contar
los `passed` del archivo nuevo, no que la suite termine sin rojo. El comando exacto va escrito
en cada prompt.

### 0.7 — Los tres guardrails automatizados reemplazan la auditoría por juicio

La auditoría de etapa la corre un modelo rápido, así que lo que la sostiene son chequeos
mecánicos que corren solos en toda tanda posterior, no una revisión que dependa de contexto
largo. **Los tres se escriben o se extienden en C1** y a partir de ahí son bloqueantes:

| # | Guardrail | Archivo | Se escribe en |
|---|---|---|---|
| G1 | Toda consulta de un service del módulo con `getServiceDb()` lleva `.eq("tenant_id", …)` | `tests/unit/tenant-filter-guardrail.test.ts` (ya existe, deriva las tablas del DDL) + **assert de cobertura nuevo** | **C1·T5** |
| G2 | Todo `module:` de `recordAudit` existe en el ENUM `modulo_auditoria` **y** en el tipo `AuditModule` | `tests/unit/audit-modulo-enum.test.ts` (ya existe, le falta la dirección TS) | **C1·T1** |
| G3 | `has_function_privilege('anon'\|'authenticated', …)` es `false` para **toda** función creada por las migraciones del módulo | `tests/integration/grants.integration.test.ts` — se le agrega un bloque que **enumera** las funciones desde las migraciones | **C1·T5** |

Los tres derivan su alcance del DDL o del código, no de una lista escrita a mano: una tabla,
un `module:` o un RPC nuevo entra solo al alcance el día que se agrega su migración. Eso es lo
que los hace servir como red para las cinco etapas siguientes.

**G1 necesita un assert de cobertura.** El guardrail existente escanea
`supabase/functions/api/src/modules/*/*.service.ts` y falla si encuentra una consulta sin
filtro. Su modo de falla silenciosa es escanear **cero** archivos del módulo comercial y dar
verde. El assert nuevo verifica que efectivamente vio los services del módulo.

### 0.8 — Decisiones de producto respondidas (Fase 1)

| Pregunta | Respuesta | Consecuencia |
|---|---|---|
| **P-01** | **Dos módulos vendibles: `stock` y `ventas`.** `ventas` requiere `stock` contratado, validado en el service de contratación (regla comercial, no restricción de integridad). | `ALTER TYPE modulo_vendible ADD VALUE` × 2 en C1·T1. Los seis archivos de 0.5 en C1·T2. |
| **P-01b** | **`stock` → plan `profesional` y `premium`. `ventas` → solo `premium`.** Escalonar la dependencia con el precio es el motivo de haber partido el módulo en dos: si los dos van a premium, partirlos no compra nada. | `on_tenant_created()` en C1·T2. Un tenant `profesional` tiene stock sin poder vender, que es el producto que D-16 describe. |
| **P-05** | **Monotributista.** | `configuracion_tenant.iva_compras_es_costo BOOLEAN NOT NULL DEFAULT true` en C2·T3. `lotes.costo_unitario_efectivo` = neto + IVA cuando la bandera está en `true`. |
| **P-10** | **Opción A: tablas separadas.** `proveedores` independiente, con `cliente_id` nullable como FK compuesta a `clientes (id, tenant_id)`. | C1·T3. No se migra `clientes`; solo se le agrega el `UNIQUE (id, tenant_id)` de 0.3. |

Las otras seis preguntas de §15 van con **default marcado** dentro del prompt de su etapa:

| Pregunta | Default aplicado | Dónde se cambia si el dueño responde distinto |
|---|---|---|
| P-02 (posición frente al fraccionamiento) | El sistema registra, no bloquea ni habilita. | Ninguna: el modelo ya lo cumple. |
| P-03 (cuenta corriente) | **No se implementa.** Solo el lugar reservado. | C9, condicional. |
| P-04 (vacuna sin insumo cargado) | Fuera de alcance: es de C7. | — |
| P-06 (precios de servicios) | `servicios.precio` nullable; **cargar la lista es tarea de datos del dueño**, no del código. | C4·T1. |
| P-07 (quién fracciona / quién ve ventas) | `split_stock` al veterinario y a la recepcionista; `view_sales` solo al admin. | `on_tenant_created()`, C1·T2. |
| P-08 (dimensión de depósito) | **Se reserva la columna**, no la feature: `lotes.deposito_id` y `movimientos_stock.deposito_id`, nullable, sin FK, sin uso. | C2·T1. |
| P-09 (cantidad de derivados) | Búsqueda por familia desde C4. | C4·T4. |

### 0.9 — Fuera de alcance de este plan

- **C9 — Cuenta corriente operativa.** El modelo ya le dejó lugar (`venta.condicion_pago`,
  `venta.saldo_pendiente`, `clientes.cuenta_corriente_habilitada`, `clientes.limite_credito`) y
  el arqueo ya está protegido estructuralmente, así que no es urgente. Se planifica solo si el
  dueño responde P-03.
- **Facturación electrónica, SIGTRAZAVET, tabla `receta`, depósitos múltiples, cadena de frío,
  órdenes de compra con aprobación.** Las columnas reservadas existen donde §13.1 lo pide; los
  puentes y las features, no. RN-CC5 es el test de que ese puente **no** se construyó.
- **Tests E2E de Playwright.** Ni §11 ni la matriz de §14 los piden y las 85 RN del alcance se
  cubren con unit + integración.
- **Frontend.** Este plan cubre migraciones, RPCs, Services, Controllers y tests. Las
  pantallas se planifican aparte, salvo los seis archivos de `web/` de 0.5, que entran porque
  sin ellos el typecheck no pasa.

---

## Etapa C1 — Fundaciones comerciales y catálogo

**Dependencias:** ninguna.
**Objetivo:** el tenant carga productos, familias, unidades y proveedores. Sin existencias.

**Alcance:**
- Migración de ENUMs en **archivo propio** (§9.1, §9.2, §9.3) + los seis valores en el tipo
  `AuditModule` de `shared/audit.ts` + los nueve ErrorCodes de 0.4 en `shared/errors.ts`.
- `unidades_medida` y `medios_pago` como catálogos globales con seed idempotente.
- `familias_producto`, `productos`, `producto_conversiones`, `proveedores`, con RLS de solo
  lectura y `UNIQUE (id, tenant_id)`.
- Trigger anti-ciclo de `producto_conversiones` (RN-FR2).
- Los diez permisos + `on_tenant_created()` actualizada + otorgamiento idempotente a los
  tenants ya creados.
- `stock` y `ventas` en `modulo_vendible`, en `modulos_contratados` y en los seis archivos
  de código de 0.5.
- CRUD completo de productos, familias, conversiones y proveedores: controller + service +
  schemas Zod, con `requireModule` y `requirePermission`.
- **Los tres guardrails de 0.7.**

**Criterios de aceptación (RN):** RN-PR1…PR12, RN-PRV1…PRV3, RN-FR2, RN-SC1…SC7.

**Definición de hecho:** un tenant nuevo carga 50 productos, dos familias y una conversión;
todo queda auditado con `module = 'products'`; `tests/integration/rls.test.ts` sigue en verde
con las cuatro tablas nuevas; los tres guardrails corren y se ponen rojos ante su mutación.

**Entregables:** 5 migraciones, 4 módulos de API, 2 guardrails nuevos + 1 extendido, filas de
la matriz.

### Corte en tandas

| Tanda | Entrega | Por qué es su propia tanda |
|---|---|---|
| **T1** — ENUMs, ErrorCodes y `AuditModule` | La migración de ENUMs (archivo propio), los 15 `CREATE TYPE`, los 2 `ALTER modulo_vendible`, los 6 `ALTER modulo_auditoria`, los 2 `ALTER origen_notificacion`, los ErrorCodes de §7 + los nueve de 0.4, los seis valores de `AuditModule`, y **el guardrail G2 extendido**. | `ALTER TYPE … ADD VALUE` no se puede usar en la transacción que lo agregó: la migración tiene que ser un archivo aparte del que la consume. Y R-06 dice que agregar al ENUM y olvidarse del tipo TS **falla en silencio**: G2 va acá, antes de que exista el primer service que audite. |
| **T2** — Permisos, roles y licenciamiento | Los 10 permisos, `on_tenant_created()` con el mapeo de 8.2 y `stock`/`ventas` según P-01b, el backfill idempotente de tenants existentes, y los seis archivos de código de 0.5. | Es la tanda que decide quién ve qué. Mezclarla con el DDL del catálogo hace que el diff de permisos se revise junto a 200 líneas de `CREATE TABLE`. |
| **T3** — Migración del catálogo + tests de base | Catálogos globales (`unidades_medida`, `medios_pago`) con seed, las cuatro tablas del tenant, RLS, índices, el trigger anti-ciclo, `clientes UNIQUE (id, tenant_id)`, la función `cantidad_valida_para_unidad()`, **y los tests de integración de las reglas que la base hace cumplir**: RN-PR1, PR4, PR7, PR11, PR12, PRV1, FR2, SC2, SC4. | Las reglas de esta tanda son CHECKs, índices únicos y un trigger. Si el test se difiere a T4, la migración se da por buena sin que nadie haya comprobado que el anti-ciclo existe. |
| **T4** — CRUD de productos, familias y conversiones | `productos.controller.ts` / `.service.ts` / `.schemas.ts`, ídem familias y conversiones, rutas en `main.ts`, unit tests. RN-PR2, PR3, PR5, PR6, PR8, PR9, PR10. | Los tres comparten el permiso `manage_products` y el módulo `products` de auditoría. |
| **T5** — CRUD de proveedores + guardrails G1 y G3 + matriz | `proveedores.controller.ts` / `.service.ts` / `.schemas.ts`, el assert de cobertura de G1, el bloque enumerador de G3, la matriz rol × endpoint (RN-SC7) y las filas de `MATRIZ_RN_TESTS_COMERCIAL.md`. RN-PRV2, PRV3, SC1, SC3, SC5, SC7. | Proveedores es un CRUD independiente con su propio permiso (`manage_suppliers`); meterlo en T4 haría una tanda de cuatro CRUD. Y los guardrails se escriben cuando ya hay services del módulo que escanear. |

---

## Etapa C2 — Libro mayor, lotes y compras

**Dependencias:** C1.
**Objetivo:** entra mercadería y el sistema sabe cuánta hay, de qué lote y a qué costo.

**Alcance:**
- `lotes` **con `lote_padre_id` desde esta migración** (D-13), aunque no se use hasta C6.
- `movimientos_stock` con **todas** sus columnas reservadas: receta, prescriptor,
  trazabilidad, depósito, y las tres FKs clínicas de C7.
- `signo_movimiento()` `IMMUTABLE` con su `REVOKE`/`GRANT`; trigger de inmutabilidad; trigger
  de mantenimiento de la caché.
- `existencias_lote`, `recalcular_existencias()`, `verificar_existencias()`.
- Los cinco `UNIQUE (id, tenant_id)` de 0.3 que corresponden a esta etapa.
- `compras`, `compras_items`, las seis columnas de `configuracion_tenant`, RPC
  `confirmar_compra` con `NOTIFY pgrst`.
- Kárdex por lote, valorización de inventario, `v_lotes_por_vencer`, notificación de
  vencimiento próximo.

**Criterios de aceptación (RN):** RN-MV1…MV12, RN-LO1…LO8, RN-CM1…CM5.

**Definición de hecho:** compra de 20 ítems confirmada, existencia cuadrada,
`verificar_existencias` devuelve cero filas, el kárdex reconstruye el saldo, y el test de
adulteración de caché (RN-MV11) pasa **con los tres guardrails de C1 en verde**.

### Corte en tandas

| Tanda | Entrega | Por qué es su propia tanda |
|---|---|---|
| **T1** — Migración del libro mayor + tests de base | `signo_movimiento()`, `lotes`, `movimientos_stock`, `existencias_lote`, los dos triggers, RLS, índices, los tres `UNIQUE (id, tenant_id)` de 0.3. Tests de integración: RN-MV2, MV3, MV4, MV5, MV8, SC2. | Es la migración más grande del módulo y sus reglas las hace cumplir la base, no el código. Los tests van acá o la tanda se aprueba sin que nadie sepa si el trigger de inmutabilidad frena a `service_role`. |
| **T2** — Conciliación de la caché | `recalcular_existencias(p_tenant_id, p_producto_id)` y `verificar_existencias(p_tenant_id)` con `REVOKE`/`GRANT` y `NOTIFY pgrst`. RN-MV10, MV11, MV12. | RN-MV11 es **el test que justifica la existencia de la caché** (D-02). Aislarlo lo hace revisable: si esta tanda no cierra, la decisión de D-02 no está sostenida. |
| **T3** — Compras y `confirmar_compra` | `compras`, `compras_items`, las seis columnas de `configuracion_tenant` (con `iva_compras_es_costo` en `true` por P-05), el RPC con auditoría interna. RN-CM1, CM4, CM5, RN-LO1, LO2, LO3, RN-MV7. | Primera escritura transaccional del módulo. El RPC crea lotes y movimientos en una transacción: revisarlo junto al DDL del libro mayor sería un diff de 600 líneas. |
| **T4** — Services y Controllers de lotes, movimientos y compras | Kárdex por lote, valorización, consulta de candidatos FEFO, borrador y anulación de compra. RN-CM2, CM3, RN-LO4, LO5, LO7, RN-MV6, MV9. | Capa de aplicación pura: no toca migraciones. |
| **T5** — Notificaciones, guardrail G1 sobre el módulo y matriz | `v_lotes_por_vencer`, notificación de vencimiento próximo por flanco (§10.6), el guardrail estático de RN-MV1 y RN-MV10 (nadie escribe `existencias_lote` desde `src/modules/`), filas de la matriz. RN-LO8, RN-MV1, MV10. | RN-MV1 y MV10 son chequeos estáticos, no tests de comportamiento: agrupan bien y cierran la etapa. |

---

## Etapa C3 — Caja

**Dependencias:** C2.
**Objetivo:** se abre, se mueve y se cierra la caja. Todavía no se vende.

**Alcance:** `cajas`, `sesiones_caja`, `movimientos_caja`, índice parcial único de sesión
abierta, trigger de inmutabilidad de `movimientos_caja`, RPCs `abrir_sesion_caja`,
`registrar_movimiento_caja` y `cerrar_sesion_caja`.

**Criterios de aceptación (RN):** RN-CJ2, RN-CJ4…CJ9.

**Definición de hecho:** apertura, tres ingresos y dos egresos manuales, cierre con diferencia
y motivo. El test concurrente de doble apertura (RN-CJ4) pasa las repeticiones configuradas.

> **Por qué la caja va antes que las ventas y no junto con ellas.** Ventas + caja + FEFO +
> concurrencia, con todos sus tests, es demasiado para una etapa, y la caja es la mitad que se
> puede entregar y probar sola: el arqueo se verifica con movimientos manuales, sin necesidad
> de que exista una venta. Partirlas deja dos etapas cerradas en verde en vez de una que
> arrastra pendientes.

### Corte en tandas

| Tanda | Entrega |
|---|---|
| **T1** — Migración de caja + tests de base | Las tres tablas, `signo_movimiento_caja()`, el índice parcial único `uq_sesion_caja_abierta`, el trigger de inmutabilidad, RLS, índices. Tests de integración de lo que la base hace cumplir: unicidad de sesión abierta e inmutabilidad de `movimientos_caja`. |
| **T2** — Los tres RPCs + concurrencia | `abrir_sesion_caja`, `registrar_movimiento_caja`, `cerrar_sesion_caja`, con `REVOKE`/`GRANT` y `NOTIFY pgrst`. RN-CJ2, CJ4 (concurrente, con `rpcReallyRan()` y arnés de repetición), CJ5, CJ6, CJ7, CJ8, CJ9. |
| **T3** — Service, Controller, rutas y matriz | `caja.service.ts`, `caja.controller.ts`, `caja.schemas.ts`, rutas en `main.ts` con `requireModule('ventas')` y `requirePermission('manage_cash')`, unit tests, matriz rol × endpoint, filas de la matriz. |

---

## Etapa C4 — Ventas

**Dependencias:** C3.
**Objetivo:** se vende en el mostrador. **Es la etapa que el negocio percibe como "el módulo".**

**Alcance:** `ventas`, `ventas_items` con productos **y** servicios, `ventas_pagos`,
`contadores_tenant`, `servicios.precio` y `servicios.alicuota_iva`, las tres columnas nuevas
de `clientes`, RPCs `registrar_venta` y `anular_venta`, asignación FEFO con override motivado,
descomposición de IVA por línea, vistas `v_items_vendidos` y `v_margen_venta`.

**Criterios de aceptación (RN):** RN-VT1…VT8, RN-CJ1, RN-CJ3, RN-LO6, RN-SC8.

**Definición de hecho:** un turno completo —abrir caja, seis ventas con pago mixto y con
servicios, una anulación, cierre con arqueo— cuadra al centavo, y el test concurrente de
RN-SC8 pasa las repeticiones configuradas.

### Corte en tandas

| Tanda | Entrega |
|---|---|
| **T1** — Migración de ventas + tests de base | `contadores_tenant`, `ventas`, `ventas_items`, `ventas_pagos`, `servicios.precio` / `alicuota_iva` + `servicios UNIQUE (id, tenant_id)`, `clientes.condicion_fiscal` / `cuenta_corriente_habilitada` / `limite_credito`, los CHECKs de coherencia, RLS, índices. Tests de base: RN-VT3, RN-SC2 sobre las tablas nuevas. |
| **T2** — RPC `registrar_venta` | Validaciones sin bloqueo, asignación FEFO, bloqueo `FOR UPDATE` **ordenado por `lote_id`**, contador del tenant, descomposición de IVA por diferencia, pagos, movimientos de caja, auditoría en la misma transacción. RN-VT1, VT2, VT6, VT7, VT8, RN-CJ1, RN-LO5, LO6, RN-PR9, PR10. |
| **T3** — RPC `anular_venta` | Contra-asientos de existencia y de caja, egreso a la sesión abierta actual, motivo obligatorio. RN-VT4, VT5, RN-MV9. |
| **T4** — Services, Controllers, rutas y vistas | `ventas.service.ts` / `.controller.ts` / `.schemas.ts`, búsqueda de catálogo por familia (P-09), vistas `v_items_vendidos` y `v_margen_venta`. RN-CJ3, RN-MV6. |
| **T5** — Concurrencia RN-SC8 + matriz | Dos `.rpc("registrar_venta")` en `Promise.all` sobre un lote con existencia 1, con el guard `rpcReallyRan()` y repeticiones configurables por variable de entorno (default 50). Filas de la matriz. |

> **Por qué RN-SC8 tiene su propia tanda.** R-01 dice que descontar existencia desde el
> Service funciona perfecto en desarrollo, donde nunca hay dos operaciones a la vez, y que
> **sin este test eso se va a producción**. Es el único test del módulo cuyo valor está en que
> nadie lo pueda diluir en una tanda que entrega otras cinco cosas.

---

## Etapa C5 — Ajustes, mermas, recuento y devoluciones

**Dependencias:** C4.
**Objetivo:** el inventario se puede corregir sin mentir.

**Alcance:** `recuentos`, `recuentos_detalle`, RPCs `ajustar_existencia`, `aplicar_recuento` y
`registrar_devolucion`, bloqueo y desbloqueo de lotes.

**Criterios de aceptación (RN):** RN-AJ1…AJ7, RN-LO7.

**Definición de hecho:** recuento del depósito aplicado con ajustes en una sola operación y la
advertencia de RN-AJ3 funcionando.

### Corte en tandas

| Tanda | Entrega |
|---|---|
| **T1** — Migración de recuentos + tests de base | `recuentos`, `recuentos_detalle`, RLS, índices, CHECKs. Tests de base de lo que la migración hace cumplir. |
| **T2** — RPCs `ajustar_existencia` y `registrar_devolucion` | Motivo obligatorio de longitud mínima, bloqueo y desbloqueo de lotes, devolución validada contra lo vendido, lote bloqueado para lo no revendible. RN-AJ1, AJ2, AJ4, AJ5, AJ7, RN-LO7. |
| **T3** — RPC `aplicar_recuento` | Congelado de `cantidad_sistema` **al aplicar**, advertencia con los lotes movidos, confirmación explícita, irreversibilidad. RN-AJ3, AJ6. |
| **T4** — Services, Controllers, rutas y matriz | Los tres services con sus controllers y schemas, rutas en `main.ts`, matriz rol × endpoint, filas de la matriz. |

---

## Etapa C6 — Fraccionamiento

**Dependencias:** C2 y C5.
**Objetivo:** la operación central del módulo (D-06).

**Alcance:** RPC `fraccionar_lote` con atomicidad, rendimiento real, merma con costo cero,
costo heredado, vencimiento del hijo y trazabilidad padre–hijo; creación de producto derivado
desde plantilla; `v_costo_fraccionamiento` y `v_stock_familia_unidad_base` con su
`COMMENT ON VIEW`; consulta de cadena de trazabilidad con CTE recursivo.

**Criterios de aceptación (RN):** RN-FR1, FR3…FR13.

**Definición de hecho:** los dos casos reales del dueño funcionan de punta a punta —bolsa de
15 kg → kilos sueltos con rendimiento 14,2, y caja → blíster → comprimido con la cadena
completa en tres niveles— y RN-FR8 verifica que el valor del inventario **no cambió** por
fraccionar.

> **C5 va antes que C6, y no es negociable.** D-06.c define que un fraccionamiento mal hecho
> se corrige con un ajuste motivado. Si el fraccionamiento se habilita antes de que exista el
> ajuste, el único camino de corrección no existe y el primer error de carga se va a
> "arreglar" por SQL directo contra producción.

### Corte en tandas

| Tanda | Entrega |
|---|---|
| **T1** — RPC `fraccionar_lote` | La operación completa: conversión definida y activa, decimales por unidad de cada producto, bloqueo del lote origen, rendimiento teórico contra real, costo heredado dividido por lo **realmente obtenido**, merma con costo total **cero**, vencimiento del hijo no posterior al del padre, auditoría en la misma transacción. RN-FR1, FR3, FR5, FR6, FR7, FR8, FR10, FR11, FR13. |
| **T2** — Producto derivado desde plantilla | Endpoint que copia familia, alícuota, marca y condición de venta del padre y crea la conversión, en una operación. Verificación de que **no existe** ningún camino inverso. RN-FR9. |
| **T3** — Vistas y trazabilidad | `v_costo_fraccionamiento`, `v_stock_familia_unidad_base` con su `COMMENT ON VIEW` diciendo que es solo reporte, CTE recursivo de la cadena `lote_padre_id`. RN-FR4, FR12. |
| **T4** — Service, Controller, rutas y matriz | `fraccionamiento.service.ts` / `.controller.ts` / `.schemas.ts`, ruta con `requirePermission('split_stock')`, unit tests, matriz rol × endpoint, cierre de la matriz de C1–C6. |

---

## Etapa C7 — Consumo clínico

**Dependencias:** C2 como mínimo; C6 solo si se consume producto fraccionado.
**Objetivo:** aplicar una vacuna descuenta el frasco.

**Alcance:**
- RPC `registrar_consumo_clinico`, con el mismo patrón que `registrar_venta`: `p_tenant_id`
  primero, `FOR UPDATE` sobre `existencias_lote` **ordenado por `lote_id`**, asignación FEFO,
  prohibición de despachar vencidos y auditoría con `module = 'inventory'` dentro de la
  transacción.
- Enganche desde historial clínico y plan de vacunación. **La dirección de la dependencia es
  movimiento → evento clínico, nunca al revés** (§10.3): el módulo clínico no se entera de que
  existe el catálogo, y un tenant sin `stock` contratado usa el historial exactamente igual que
  hoy.
- Trazabilidad lote ↔ animal en las dos direcciones (RN-CC4).
- `receta_id` y `profesional_prescriptor_id` se completan si vienen, **sin validar** (D-14).
- Reporte de costo de insumos por atención.

**Criterios de aceptación (RN):** RN-CC1…CC5.

**Definición de hecho:** aplicar una vacuna desde el historial descuenta el lote correcto por
FEFO, deja el movimiento con mascota y evento, y **no** genera venta ni movimiento de caja.

> **Prerrequisito ya cubierto en C2·T1.** Las tres columnas (`historial_id`,
> `plan_vacunacion_id`, `mascota_id`), sus FKs compuestas, los `UNIQUE (id, tenant_id)` de
> `mascotas`, `historial_clinico` y `plan_vacunacion`, el índice `idx_mov_historial` y la
> cláusula del CHECK documental que exige `historial_id` para `consumo_clinico` se crearon en
> la migración del libro mayor. **C7 no crea ninguna tabla ni ninguna columna**: solo el RPC,
> la capa de aplicación y sus tests. Eso es exactamente lo que §12.2 pedía al no dejar esas
> columnas para después.

> **Decisión provisoria sobre P-04, que sigue sin respuesta del dueño.** Si el insumo no está
> cargado en stock, **el acto clínico se registra igual y el consumo queda pendiente de
> regularizar**. No se bloquea el acto clínico y **no** se permite existencia negativa. Es la
> única de las tres opciones de §15 compatible con el modelo. Si el dueño responde distinto, lo
> que cambia es el guard del Service de C7·T2 y la bandera de `configuracion_tenant` que lo
> gobierna; el RPC y el libro mayor no se tocan.

### Corte en tandas

| Tanda | Entrega | Por qué es su propia tanda |
|---|---|---|
| **T1** — RPC `registrar_consumo_clinico` | El RPC completo con FEFO, bloqueo ordenado, prohibición de vencidos, auditoría interna y las columnas de receta sin validar. RN-CC1, CC2, CC3, CC5. | Es la cuarta escritura transaccional de existencia del módulo y la última. Su diff se revisa solo. |
| **T2** — Service, Controller, rutas y enganche clínico | `consumo.service.ts` / `.controller.ts` / `.schemas.ts`, el enganche desde el historial y desde el plan de vacunación, y el guard de "insumo no cargado" de la decisión provisoria de P-04. | Es la tanda que toca la frontera con el módulo clínico, que es donde se rompe la independencia si alguien se descuida. |
| **T3** — Trazabilidad lote↔animal, reporte de costo por atención y matriz | Las dos consultas de RN-CC4, el reporte de costo de insumos por atención, y el cierre de las 5 RN-CC en la matriz. | Consultas de lectura pura, sin migración ni RPC. |

---

## Etapa C8 — Reportes comerciales

**Dependencias:** C4, C6 y C7.
**Objetivo:** los números que el negocio usa para decidir, calculados sobre el libro mayor y no
sobre la caché.

**Alcance:**
- **Fixture de volumen versionado**, antes que cualquier reporte.
- Valorización de inventario a una fecha, **desde el libro mayor, no desde la caché**.
- Rotación y productos sin movimiento.
- Rentabilidad por producto y familia, con el costo efectivo guardado.
- Costo de fraccionamiento.
- Ventas por usuario, por sesión y por medio de pago.
- Consumo clínico por profesional y por especie.
- **`EXPLAIN` de los listados nuevos**, con el método de `docs/EXPLAIN_INDICES.md`.

**Criterios de aceptación (RN):** ninguna nueva. C8 **verifica sobre datos reales** RN-MV6 (el
costo guardado no se recalcula) y RN-FR8 (fraccionar no cambia el valor del inventario), que es
exactamente lo que el fixture hace posible.

**Definición de hecho:** los siete reportes corren contra el fixture de volumen, el `EXPLAIN` de
cada listado nuevo muestra uso de índice, y la matriz de las 90 RN queda completa.

> **Por qué el fixture va primero y no al final.** `docs/EXPLAIN_INDICES.md` deja constancia de
> que el seed de volumen de la Etapa 9 vivió en `scratchpad/` y **no se versionó**. Verificar que
> una consulta usa índice contra una tabla de 12 filas no significa nada: con esos datos Postgres
> hace scan secuencial porque es más rápido, y el `EXPLAIN` que se firma como evidencia no prueba
> nada sobre producción. El fixture es el entregable del que dependen los otros dos tercios de la
> etapa.

### Corte en tandas

| Tanda | Entrega | Por qué es su propia tanda |
|---|---|---|
| **T1** — Fixture de volumen versionado + valorización a fecha | El seed de volumen **en el repo**, con datos suficientes para que el planificador elija índice, y el primer reporte: valorización de inventario a una fecha reconstruida desde `movimientos_stock`. | El fixture es infraestructura de la que dependen T2 y T3. Y la valorización a fecha es el reporte que prueba que el libro mayor sirve para lo que D-02 prometió. |
| **T2** — Los seis reportes restantes | Rotación y productos sin movimiento; rentabilidad por producto y familia; costo de fraccionamiento; ventas por usuario, sesión y medio de pago; consumo clínico por profesional y especie. | Consultas de lectura sobre vistas que ya existen. Una tanda mecánica, que es lo que corresponde. |
| **T3** — `EXPLAIN`, verificación de RN-MV6 y RN-FR8 sobre datos reales, y cierre | El `EXPLAIN` de cada listado nuevo con el método de `docs/EXPLAIN_INDICES.md`, la reverificación de las dos RN contra el fixture, la checklist de cierre del módulo y la matriz completa. | Es el cierre del módulo: separarla hace que la evidencia de rendimiento no compita con la de corrección. |


---

## Grafo de dependencias

```
C1 Catálogo
 └─ C2 Libro mayor + compras
     ├─ C3 Caja
     │   └─ C4 Ventas
     │       └─ C5 Ajustes + recuento + devoluciones
     │           └─ C6 Fraccionamiento ──┐
     │                                   ├─ C8 Reportes
     └─ C7 Consumo clínico ──────────────┘
         (necesita C6 solo si se consume producto fraccionado)

C9 Cuenta corriente ── depende de C4, condicional a P-03
```

**C7 no está en el camino crítico.** Depende de C2, no de C6: se puede ejecutar en paralelo con
C3–C6 si hiciera falta, y solo necesita C6 en el caso de que se consuma un producto que salió de
un fraccionamiento. Se planifica después de C6 porque es el orden en que el dueño lo pidió, no
porque haya una dependencia técnica.

---

## Resumen de prompts

| Etapa | Tandas de ejecución | Prompt de auditoría |
|---|---|---|
| C1 | 5 | — |
| C2 | 5 | **`C2_AUDITORIA.md`** |
| C3 | 3 | — |
| C4 | 5 | — |
| C5 | 4 | — |
| C6 | 4 | **`C6_AUDITORIA.md`** |
| C7 | 3 | — |
| C8 | 3 | — (los controles de cierre van dentro de C8·T3) |
| **Total** | **32** | **2** |

Las dos auditorías están escritas como **checklist mecánica** —comandos, greps y consultas SQL
con su resultado esperado— y no como revisión de juicio, porque las corre un modelo rápido. Lo
que en un esquema con auditoría por etapa sostenía Opus, acá lo sostienen los tres guardrails
de 0.7, que corren en **toda** tanda y no solo al cierre de una etapa.

**C7 y C8 no suman un tercer prompt de auditoría**, por la misma decisión de densidad que dejó
solo dos. En su lugar, **C8·T3 lleva adentro la checklist de cierre del módulo**: los controles
que aplican a lo que C7 y C8 agregan —el RPC nuevo que escribe existencia, sus grants, su módulo
de auditoría, y la reverificación de RN-MV6 y RN-FR8 sobre el fixture de volumen— corren ahí,
con el mismo formato de comando y resultado esperado. Si preferís un `C8_AUDITORIA.md` separado,
es media hora de trabajo y no cambia nada de lo demás.

**Por qué post-C2 y post-C6 y no en otro lado.** C2 es donde se decide el modelo de datos que
§12.2 dice que es irrecuperable si sale mal —`lote_padre_id`, el costo en el lote, el
`operacion_id`, la escala `NUMERIC(14,3)`—. C6 es donde ese modelo se usa por primera vez de
punta a punta, y es la última oportunidad de detectar que algo de C2 estaba mal antes de que
haya datos históricos que dependan de ello.
