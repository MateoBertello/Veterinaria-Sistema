# PROMPTS_FRONTEND.md — Todos los prompts del frontend comercial, en bloques copiables

Cada bloque es un prompt completo, autocontenido, listo para pegar en una **sesión nueva**.
Los archivos individuales están en [`prompts_frontend/`](prompts_frontend/); este documento es
la versión para copiar y pegar.

**Reglas de uso, iguales a las del backend:**

- **Una tanda por sesión.** No encadenes dos en la misma conversación.
- **Un commit por tanda.** El repo queda en verde al terminar cada una.
- **Orden estricto.** Cada prompt declara su precondición; no la saltees.
- Antes de empezar, leé `PLAN_FRONTEND_COMERCIAL.md` — sobre todo §1 (la superficie de API,
  que es **cerrada**), §2 (las reglas de UI que son reglas de negocio) y §4 (los bugs de
  backend que las pantallas rodean sin arreglar).

## Orden de ejecución

| # | Tanda | Estado |
|---|---|---|
| — | **B0** — precio de servicio + fix `codigoBarras` (BACKEND) | 🔒 bloqueada hasta el merge de `feat/modulo-comercial` y su re-auditoría |
| — | **0a** — setup del tenant | manual, sin código |
| 1 | **F1·T1** — capa de datos, tipos y rutas | |
| 2 | **0b** — carga asistida de precios *(la tanda cero)* | |
| 3 | **F1·T2** — productos | |
| 4 | **F1·T3** — familias y proveedores | |
| 5 | **F2·T1** — existencias, lotes y kardex | |
| 6 | **F2·T2** — vencimientos | |
| 7 | **F2·T3** — compras y recepción | |
| 8 | **F3·T1** — caja: apertura y movimientos | |
| 9 | **F3·T2** — arqueo y cierre | |
| 10 | **F4·T1** — mostrador: buscador y carrito | |
| 11 | **F4·T2** — mostrador: FEFO y cobro | |
| 12 | **F4·T3** — ventas: detalle, anulación y devolución | |
| 13 | **F5·T1** — ajustes y bloqueo de lotes | |
| 14 | **F5·T2** — recuentos | |
| 15 | **F6·T1** — fraccionamiento | |
| 16 | **F7·T1** — consumo clínico | |
| 17 | **F8·T1** — reportes de stock | |
| 18 | **F8·T2** — reportes de ventas | |

---

## B0 — Precio y alícuota de servicio en la API (+ fix de `codigoBarras`)

`prompts_frontend/B0_backend_precio_servicio.md`

`````markdown
# B0 — Precio y alícuota de servicio en la API (+ fix de `codigoBarras`)
> **Capa:** BACKEND · **Modelo:** Gemini Flash · **Rol:** ejecución
> **NO SE EJECUTA TODAVÍA.** Bloqueada hasta que `feat/modulo-comercial` esté mergeada y
> re-auditada (Gemini está corrigiendo los bloques 2 y 3 sobre esa rama).
> **Es prerrequisito duro de F1.** Sin B0, la tanda 0b no puede cargar precios de servicios
> y el mostrador no puede venderlos sin romper D-03.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/servicios/servicios.schemas.ts` | Los dos schemas a extender. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | `ServicioPublico`, el mapper de fila y los `insert`/`update`. |
| `supabase/migrations/20260922000001_comercial_ventas.sql` líneas 13–16 | El DDL real de las dos columnas. **No lo modifiques**: ya está aplicado. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` líneas 198–222 | Cómo la RPC lee `precio` y `alicuota_iva`, y cuándo lanza `PRODUCT_WITHOUT_PRICE`. |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `ALICUOTAS_IVA`: la lista y el mensaje de error a replicar tal cual. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | El `ListarProductosQuerySchema.safeParse({...})` del GET `/` — ahí falta una línea. |
| `ADENDA_SPEC_COMERCIAL.md`, sección *"Nueva — Un controller test que mockea el Service no prueba el endpoint"* | Por qué el test de esta tanda va contra base real. |
| `tests/integration/aislamiento-api.integration.test.ts` líneas 682–690 | El caso `editar servicio` que hay que extender. |

## R. Reglas transversales de backend

```
- tenant_id SIEMPRE de ctx.tenantId (JWT vía tenantContext). Nunca del body/query/params.
- Los Services escriben con getServiceDb() y filtran .eq('tenant_id', tenantId) en TODA
  consulta. service_role bypasea RLS: el filtro es el único aislamiento.
- Envelope estándar: ok(data, meta?) / fail(code, message, statusCode, details).
- Los ErrorCode salen del enum central de shared/errors.ts. No inventar códigos.
- NUMERIC con precisión explícita. Nunca float.
- Esta tanda NO crea migraciones. Las dos columnas YA EXISTEN.
- Esta tanda NO toca RPCs, ni RLS, ni políticas, ni grants.
```

## 1. Qué hacer — cuatro cambios, ninguno con margen de interpretación

### 1.1 — `servicios.schemas.ts`

Agregar a `CrearServicioSchema` (y por lo tanto a `ActualizarServicioSchema`, que es
`.partial()` del anterior — no lo dupliques):

```ts
precio:      z.number().nonnegative().nullish(),
alicuotaIva: z
  .number()
  .refine(
    (v) => (ALICUOTAS_IVA as readonly number[]).includes(v),
    "La alícuota debe ser 0, 10.50, 21 o 27",
  )
  .default(21),
```

`ALICUOTAS_IVA` ya está exportado desde `productos.schemas.ts`. **Importalo de ahí, no lo
redeclares.** El CHECK de la base (`alicuota_iva IN (0, 10.50, 21, 27)`) es la defensa real;
esto devuelve un 422 legible en vez de un 500 con el mensaje de Postgres.

`precio` es `nullish` a propósito: un servicio sin precio cargado es un estado válido — la
RPC lo rechaza recién al vender.

### 1.2 — `servicios.service.ts`

Tres puntos, y solo tres:

1. `ServicioPublico`: agregar `precio: number | null` y `alicuotaIva: number`.
2. El mapper de fila: `precio: row["precio"] != null ? Number(row["precio"]) : null` y
   `alicuotaIva: Number(row["alicuota_iva"])`. **Con `Number()`**: PostgREST devuelve NUMERIC
   como string y sin el cast el precio llega al frontend como `"1500.00"`.
3. Crear y actualizar: mapear `precio` → `precio` y `alicuotaIva` → `alicuota_iva`. En
   actualizar, el patrón del archivo es `if (dto.campo !== undefined) payload["col"] = ...` —
   seguilo, para que `null` explícito borre el precio y `undefined` lo deje como está.

**No cambies nada más de este archivo.** Ni `assertDuracion`, ni la pre-query de RN-SV2, ni el
`select("*")`.

### 1.3 — Fix del filtro `codigoBarras` muerto (`productos.controller.ts`)

`ListarProductosQuerySchema` declara `codigoBarras` y `ProductoService.buscarPaginado` lo
aplica (`q.eq("codigo_barras", query.codigoBarras)`), pero el controller **nunca lo lee**. En
el `safeParse` del `GET /` falta:

```ts
codigoBarras: c.req.query("codigoBarras"),
```

Es una línea. Es un bug, no una limitación de diseño: hoy el escaneo cae en el `search`, que
hace `ilike` sobre `codigo_barras` y con códigos que comparten prefijo devuelve el producto
equivocado.

**Cuidado con el fallback:** el objeto literal del `else` (cuando el parseo falla) también
tiene que incluir `codigoBarras: undefined`, o TypeScript se queja del tipo.

### 1.4 — Tests

**a) Unit del Service** (`tests/unit/servicios.service.test.ts`, extendiendo el que ya está):
- `RN-SV: crea un servicio con precio y alícuota y los devuelve como number`
- `RN-SV: rechaza una alícuota fuera de {0, 10.50, 21, 27} → VALIDATION_ERROR`
- `RN-SV: actualizar sin tocar precio no lo pisa` (el `undefined` no entra al payload)
- `RN-SV: actualizar con precio null lo borra`

**b) Smoke de camino feliz CONTRA BASE REAL** (`tests/integration/servicios.integration.test.ts`).
**No** un controller test con el Service mockeado: eso no prueba el endpoint (ver la adenda).
El smoke hace, con `callApp` y un JWT real, el ciclo completo:

```
POST /servicios  { nombre, tipo, duracionMinutos, requiereProfesional, precio: 1500, alicuotaIva: 21 }
  → 201, y data.precio === 1500 (number, no "1500.00")
GET  /servicios/:id
  → 200, precio 1500, alicuotaIva 21
PUT  /servicios/:id  { precio: 1800 }
  → 200, precio 1800, y duracionMinutos SIN cambiar
GET  /servicios?limit=100
  → el servicio aparece con su precio en el listado
```

Y un caso que cierra el círculo con la razón de ser de B0:

```
POST /ventas con un ítem { tipoItem: "servicio", servicioId } SIN precioUnitario
  → 201 (antes de B0 esto era imposible: precio era NULL y la RPC tiraba
     PRODUCT_WITHOUT_PRICE). Verificar que la línea guardada tiene la alícuota
     del servicio, que es lo que D-03 exige.
```

**c) Matriz de aislamiento** (`tests/integration/aislamiento-api.integration.test.ts`):
el caso `{ nombre: "editar servicio", method: "PUT", path: /servicios/${A.servicioId} }` ya
existe. Extendé su body para que lleve `precio` y `alicuotaIva`, y confirmá que sigue dando
**404** cuando el JWT es del tenant B. Un precio no puede ser el vector que abra la escritura
cross-tenant.

## 2. Prohibido en esta tanda

```
- Crear migraciones. Las columnas ya existen y ya están aplicadas.
- Tocar registrar_venta ni ningún otro RPC.
- Tocar RLS, políticas o grants de `servicios`.
- Cambiar la forma del envelope o los ErrorCode.
- Tocar cualquier archivo de web/.
- "Aprovechar el viaje" para arreglar otra cosa del módulo servicios.
```

## 3. Definición de terminado

1. `npm run typecheck` en verde.
2. `npm test` en verde (los unit nuevos incluidos).
3. `npm run test:integration` en verde, con **0 skipped** en `servicios.integration.test.ts`
   y en `aislamiento-api.integration.test.ts`. Contá los `passed`: una suite SKIPPED no es
   un rojo pero tampoco es una prueba (faltan `TEST_SUPABASE_*` en `.env`).
4. Un commit: `fix(servicios): precio y alícuota por API + filtro codigoBarras [B0]`
`````

---

## 0a — Setup del tenant de prueba

`prompts_frontend/F0a_setup_tenant.md`

`````markdown
# 0a — Setup del tenant de prueba
> **MANUAL. No hay código en esta tanda y no hay nada que pedirle a un modelo.**
> Está escrita como tanda porque si no se hace, todo lo demás parece roto.

## Por qué

Los endpoints comerciales pasan por `requireModule("stock")` o `requireModule("ventas")`. Si
el tenant no los tiene contratados, **todo devuelve `403 MODULE_NOT_LICENSED`** y desde el
frontend se ve como un bug de la pantalla.

## Pasos

1. Entrar a la consola Super Admin: `/admin/login`.
2. Tenants → el tenant de prueba → detalle.
3. Habilitar **Stock** y **Ventas** con los switches de módulos
   (`PUT /api/v1/admin/tenants/:id/modulos/:modulo`).
4. Cerrar sesión y entrar con un usuario **del tenant** (no el Super Admin).
5. Confirmar que el sidebar muestra **Stock** y **Ventas** bajo *Módulos contratados*.

## Verificación de que quedó bien

```
GET /api/v1/modulos-habilitados   → stock y ventas con habilitado: true
GET /api/v1/productos             → 200 (no 403)
GET /api/v1/caja/cajas            → 200 (no 403)
```

Si `GET /productos` da 200 y `GET /caja/cajas` da 403, falta habilitar **ventas**: son dos
módulos distintos y el mostrador necesita los dos.

## Lo que NO hay que hacer

- **No** tocar `web/src/lib/navigation.ts` ni `web/src/lib/planes.ts`. Los dos ya conocen
  `stock` y `ventas`, y `buildNavItems` ya oculta el módulo no contratado (RN-G2).
- **No** agregar un modo "módulo con candado". RN-G2 dice ocultar, no deshabilitar.
- **No** habilitar módulos escribiendo en `modulos_contratados` por SQL. El camino es la
  consola, que audita el cambio.
`````

---

## F1 · TANDA 1 — Capa de datos comercial, tipos, rutas y gating

`prompts_frontend/F1_T1_capa_datos_comercial.md`

`````markdown
# F1 · TANDA 1 — Capa de datos comercial, tipos, rutas y gating
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** B0 mergeada y en verde. Tanda 0a hecha (stock y ventas habilitados).
> **No dibuja ninguna pantalla.** Es la base tipada sobre la que se apoyan las 17 tandas
> siguientes. Si esto queda mal, se arrastra a todo el módulo.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1 | La superficie completa. Es la especificación de esta tanda. |
| `web/src/api/client.ts` | `apiClient`, `apiClientList`, `ApiError`. **No lo modifiques.** |
| `web/src/api/catalogos.ts` | El patrón PostgREST directo: proxy vs. modo directo, cache de lectura, invalidación. Se copia de acá. |
| `web/src/api/turnos.ts` | Un módulo de API típico: forma de las funciones, construcción del query string. |
| `web/src/types/index.ts` | Dónde viven los tipos y `ApiError`. |
| `web/src/App.tsx` | Cómo se registran rutas y cómo se envuelven en `RequirePermission`. |
| `web/src/lib/navigation.ts` | Ya conoce `stock` y `ventas`. **Solo se toca si hace falta una sub-ruta.** |
| Los `*.schemas.ts` y `*.service.ts` de los diez módulos comerciales | La forma EXACTA de cada DTO. Los tipos se derivan de ahí, no se inventan. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — el backend está auditado. Esta tanda NO toca
  supabase/functions/api/src/modules/ ni ninguna migración. Si falta un endpoint o un
  filtro: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id. Ni en body, ni en query, ni en params.
DOS CAMINOS SEPARADOS — web/src/api/comercial/*.ts va por la API;
  web/src/api/catalogos-comercial.ts va por PostgREST. No los mezcles en un archivo.
ENVELOPE — apiClient<T> devuelve data; apiClientList<T> devuelve { items, meta }.
  Los errores llegan como ApiError con .code. Se muestran por .code, no por status.
RENDIMIENTO — un fetch por listado. Prohibido llamar a la API dentro de un map/for.
PRECIO — precio_venta y servicios.precio SON el precio final con IVA incluido.
COPY — numero_operacion se muestra SIEMPRE como "Operación N°". Nunca "Comprobante",
  "Factura", "Ticket" ni "Recibo".
TESTS — Vitest + Testing Library, Xxx.test.tsx junto al archivo.
  Se corren con: cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — Tipos: `web/src/types/comercial.ts`

Un tipo por DTO que la API devuelve, derivado **literalmente** de los `*.service.ts` y
`*.schemas.ts` del backend. No inventes campos ni "mejores nombres".

Mínimo: `Producto`, `Familia`, `Conversion`, `Proveedor`, `Lote`, `LoteCandidato`,
`MovimientoStock`, `ExistenciaFila`, `Compra`, `CompraItem`, `Caja`, `SesionCaja`,
`MovimientoCaja`, `ResumenSesion`, `TotalMedioPago`, `Venta`, `VentaItem`, `VentaPago`,
`ResultadoVenta`, `Recuento`, `RecuentoDetalle`, `Fraccionamiento`, `ConsumoItem`,
`Disponibilidad`, y los tipos de cada reporte.

Y los uniones de ENUM, con los valores **exactos** del backend:

```ts
export type CondicionVenta   = "libre" | "bajo_receta" | "bajo_receta_archivada" | "uso_profesional";
export type CondicionFiscal  = "consumidor_final" | "monotributista" | "responsable_inscripto" | "exento" | "no_alcanzado" | "sin_datos";
export type EstadoLote       = "disponible" | "cuarentena" | "bloqueado" | "agotado" | "vencido";
export type EstadoCompra     = "borrador" | "confirmada" | "anulada";
export type EstadoVenta      = "registrada" | "anulada";
export type EstadoSesionCaja = "abierta" | "cerrada";
export type EstadoRecuento   = "borrador" | "aplicado";
export type CondicionPago    = "contado" | "cuenta_corriente";
export type TipoItemVenta    = "producto" | "servicio";
export type TipoAjuste       = "entrada_ajuste" | "salida_ajuste" | "merma_rotura" | "merma_vencimiento";
export type TipoMovimientoCaja =
  | "ingreso_venta" | "ingreso_cobro_cuenta_corriente" | "ingreso_manual"
  | "egreso_pago_proveedor" | "egreso_devolucion" | "egreso_manual" | "egreso_retiro";
export type TipoMovimientoStock =
  | "entrada_compra" | "entrada_ajuste" | "entrada_fraccionamiento" | "entrada_inicial"
  | "entrada_devolucion" | "salida_venta" | "salida_consumo_clinico" | "salida_ajuste"
  | "salida_fraccionamiento" | "salida_vencimiento" | "salida_merma";
```

**Atención con `Venta`.** `GET /ventas` y `GET /ventas/:id` devuelven la fila cruda de
PostgREST **en snake_case**, con `items: ventas_items(*)` y `pagos: ventas_pagos(*)`
embebidos — es la única inconsistencia de forma del módulo. Tipeala como llega
(`VentaRow` en snake_case) y convertila a camelCase **en `web/src/api/comercial/ventas.ts`,
en un solo lugar**. `POST /ventas` sí devuelve camelCase (`ResultadoVenta`).

### 1.2 — Cliente de API: `web/src/api/comercial/`

Un archivo por área, cada función tipada y con el query string armado con `URLSearchParams`
(copiá el helper `query()` de `web/src/api/catalogos.ts`):

```
productos.ts      listar/obtener/crear/actualizar/cambiarEstado/crearDerivado
                  familias: listar/obtener/crear/actualizar/cambiarEstado
                  conversiones: listar/obtener/crear/actualizar/cambiarEstado
proveedores.ts    listar/obtener/crear/actualizar/cambiarEstado
stock.ts          listarLotes/obtenerLote/kardex/trazabilidad/candidatosFefo
                  listarMovimientos/listarExistencias/valorizacion
compras.ts        listar/obtener/crear/actualizar/agregarItem/actualizarItem/quitarItem
                  confirmar/anular
caja.ts           listarCajas/listarSesiones/sesionActual/obtenerSesion/resumenSesion
                  abrirSesion/registrarMovimiento/cerrarSesion
ventas.ts         listar/obtener/registrar/anular/reporteMargen/reporteItemsVendidos
ajustes.ts        ajustar/bloquearLote/desbloquearLote
                  recuentos: crear/listar/obtener/guardarDetalles/aplicar/eliminar
                  devoluciones: registrar
fraccionamiento.ts fraccionar/sugerirVencimiento/historial
consumo.ts        registrar/porEvento/disponibilidad
reportes.ts       las nueve consultas de PLAN_FRONTEND_COMERCIAL.md §1.8
```

Reglas mecánicas para estos archivos:
- Listados paginados → `apiClientList`. Todo lo demás → `apiClient`.
- Los parámetros opcionales **no se mandan si son `undefined`** (no mandes `familiaId=undefined`).
- Ningún archivo de acá arma un `tenantId`.
- **`listarExistencias` lleva un comentario** apuntando a `PLAN_FRONTEND_COMERCIAL.md` §4.1
  y §4.2: la API devuelve una fila por LOTE, no por producto, y su `meta.total` cuenta lotes.
  Quien consuma esta función tiene que agregar por `productoId` y paginar del lado del cliente.
- **`listarLotes` lleva un comentario** apuntando a §4.3: con `conExistencia`, el filtro se
  aplica después de paginar, así que la página vuelve con menos ítems que `limit` y el
  `total` incluye los descartados. No uses ese `total`.

### 1.3 — Catálogos por PostgREST: `web/src/api/catalogos-comercial.ts`

Copiá el mecanismo completo de `web/src/api/catalogos.ts` (modo proxy / modo directo, `Bearer`
del usuario, `cache: "no-store"`, cache de promesas por path, invalidación).

```
listarUnidadesMedida()      unidades_medida?select=id,codigo,nombre,abreviatura,admite_decimales,escala_decimal&activo=eq.true&order=nombre
listarMediosPago()          medios_pago?select=id,codigo,nombre,afecta_arqueo,requiere_referencia&activo=eq.true&order=nombre
listarServiciosVendibles()  servicios?select=id,nombre,precio,alicuota_iva,tipo&activo=eq.true&order=nombre
```

Los dos primeros son catálogos **globales** (sin `tenant_id`): la policy es
`auth.uid() IS NOT NULL`. `servicios` sí es por tenant y lo filtra RLS. **Ninguna de las tres
manda un tenant, y no debe hacerlo.**

Comentario obligatorio en la cabecera del archivo, explicando por qué estas tres lecturas no
van por la API: son catálogos de solo lectura, es la excepción documentada en `CLAUDE.md`, y
**escribir** cualquiera de ellos sigue yendo por la API.

### 1.4 — Rutas y gating: `web/src/App.tsx`

Registrar las rutas de `PLAN_FRONTEND_COMERCIAL.md` §3 apuntando a un placeholder
(`<PantallaEnConstruccion titulo="..." />`, un componente mínimo en
`web/src/components/comercial/`). Las pantallas reales llegan en las tandas siguientes; lo que
esta tanda fija es **el árbol de rutas y el gating**, para que ninguna tanda posterior tenga
que decidirlo.

Cada ruta envuelta en `RequirePermission` con el permiso de §1.10:

```
/stock, /stock/existencias, /stock/lotes/:id, /stock/vencimientos → view_stock
/stock/productos, /stock/productos/precios, /stock/familias       → manage_products
/stock/proveedores, /stock/compras, /stock/compras/:id            → manage_suppliers
/stock/ajustes, /stock/recuentos, /stock/recuentos/:id            → manage_stock
/stock/fraccionamiento                                            → split_stock
/stock/reportes                                                   → view_stock
/ventas, /ventas/historial, /ventas/:id                           → manage_sales
/ventas/caja, /ventas/caja/:sesionId                              → manage_cash
/ventas/reportes                                                  → view_sales
```

**El gate de módulo ya lo da el sidebar** (`buildNavItems` oculta lo no contratado). Si alguien
entra por URL a una ruta de un módulo no contratado, la API devuelve
`403 MODULE_NOT_LICENSED` y la pantalla muestra ese mensaje. No inventes un guard de módulo
en el router: duplicaría la fuente de verdad.

## 2. Tests obligatorios

`web/src/api/comercial/*.test.ts` con `fetch` mockeado:
- Cada función arma **el path y el query string exactos** (incluido que los `undefined` no
  aparecen en la URL).
- `apiClientList` devuelve `{ items, meta }` y `apiClient` devuelve `data`.
- Un error del envelope se convierte en `ApiError` con el `code` del backend.
- **Ninguna función manda `tenantId`.** Un test que recorra los requests emitidos y falle si
  aparece la cadena `tenantId` en URL o body.

`web/src/api/catalogos-comercial.test.ts`:
- Las tres lecturas mandan `Authorization: Bearer`.
- Ninguna manda un filtro de tenant.
- El cache sirve la segunda llamada sin volver a hacer fetch, y un fallo **no** se cachea.

## 3. Prohibido en esta tanda

```
- Dibujar pantallas reales. Placeholders y nada más.
- Tocar web/src/api/client.ts, web/src/api/catalogos.ts o web/src/lib/planes.ts.
- Tocar navigation.ts salvo para sub-rutas, y sin agregar "módulo con candado".
- Tocar cualquier archivo de supabase/.
- Inventar campos que el backend no devuelve, o renombrar los que devuelve.
```

## 4. Definición de terminado

1. `npm run typecheck` en verde.
2. `cd web && npm run test:run` en verde.
3. `npm test` sin cambios.
4. Navegar a cada ruta nueva muestra el placeholder, no un 404 ni una pantalla en blanco.
5. Un commit: `feat(comercial-fe): capa de datos, tipos y rutas del módulo comercial [F1·T1]`
`````

---

## TANDA 0b — Carga asistida de precios *(la tanda cero)*

`prompts_frontend/F0b_carga_precios.md`

`````markdown
# TANDA 0b — Carga asistida de precios *(la tanda cero)*
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** B0 en verde (sin ella no se pueden cargar precios de servicios) y F1·T1
> en verde (esta pantalla usa su capa de datos).
> **Es la tanda de mayor prioridad del plan.** Hoy no hay un solo precio cargado:
> `productos.precio_venta` existe desde C1 y `servicios.precio` desde C4·T1, y **los dos
> están vacíos**. Sin precios, `POST /ventas` devuelve `PRODUCT_WITHOUT_PRICE` en cada línea
> y el mostrador no sirve para nada.

> **Lo que esta pantalla NO hace:** inventar precios. No los deriva del costo, no los estima,
> no los siembra con datos de ejemplo. **Cargar la lista real es trabajo del dueño de la
> clínica, no del sistema** (P-06). Esta tanda entrega la herramienta para que lo haga en una
> sola sesión de trabajo en vez de entrar producto por producto.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §0.3, §2.5, §4.6, §7 (P-06) | El alcance y por qué el precio es con IVA incluido. |
| `web/src/api/comercial/productos.ts` (de F1·T1) | `listar` y `actualizar`. |
| `web/src/api/catalogos-comercial.ts` (de F1·T1) | `listarServiciosVendibles`, `listarUnidadesMedida`. |
| `web/src/api/servicios.ts` | El `actualizar` de servicios, al que B0 le agregó `precio` y `alicuotaIva`. |
| `web/src/pages/CatalogosPage.tsx` | El patrón de tabla + filtros + debounce + paginación. |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `ALICUOTAS_IVA`: 0, 10.5, 21, 27. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No hay endpoint de carga masiva y no se crea:
  la pantalla hace N PUT secuenciales. Si algo más falta: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PRECIO — el precio que se carga es el PRECIO FINAL CON IVA INCLUIDO (el de góndola).
  La RPC calcula el neto por división y el IVA por diferencia (RN-VT1). El label del campo
  lo dice explícitamente.
ENVELOPE — errores como ApiError con .code.
RENDIMIENTO — un fetch por listado.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

Pantalla `web/src/pages/CargaPreciosPage.tsx` en la ruta `/stock/productos/precios`
(ya registrada en F1·T1), con permiso `manage_products`.

### 1.1 — Layout

Header de página + **dos pestañas**: **Productos** y **Servicios**. Son dos endpoints
distintos (`PUT /productos/:id` y `PUT /servicios/:id`) y dos formas distintas; una sola
tabla mezclada haría el código ambiguo.

Encima de la tabla, una **barra de filtros**: búsqueda con debounce de 300 ms, selector de
**familia** (`GET /familias-producto`, solo en la pestaña Productos) y un switch
**"Solo los que no tienen precio"** — que es el modo en que esta pantalla se usa de verdad.

### 1.2 — La tabla es editable en línea

Una fila por producto/servicio, con las columnas: código, nombre, familia, unidad,
**alícuota** (Select con 0 / 10,5 / 21 / 27) y **precio final** (Input numérico).

- El campo de precio arranca con el valor actual, o **vacío** si es `null`.
- Las filas sin precio se marcan con un badge ámbar **"Sin precio"**.
- Editar una fila la marca como **sucia** (borde naranja + badge "Sin guardar").
- **Nada se guarda al tipear.** Se guarda con el botón "Guardar cambios" de la barra
  inferior, que muestra cuántas filas hay pendientes.
- El `Select` de familia y el de alícuota se resuelven con un `Map` cargado una vez
  (`GET /familias-producto?limit=100` y `listarUnidadesMedida()`), **no con un fetch por fila**.

### 1.3 — El guardado es N PUT secuenciales, y hay que tratarlo como tal

**No hay endpoint de carga masiva** (`PLAN_FRONTEND_COMERCIAL.md` §0.1 / hallazgo #3). El
botón "Guardar cambios" recorre las filas sucias y hace un `PUT` por cada una,
**secuencialmente** (no `Promise.all`: cien PUT en paralelo contra una Edge Function es una
mala idea).

Durante el guardado:
- Barra de progreso con "Guardando N de M".
- Cada fila que vuelve OK pierde su marca de sucia y muestra un check verde por un momento.
- **Cada fila que falla se queda sucia y muestra su error** (`ApiError.message`) en la fila.
- El proceso **no se corta** ante un fallo: sigue con las siguientes.
- Al terminar, un resumen: "Se guardaron X de M. Y filas quedaron con error." Si hubo
  errores, un botón "Reintentar las que fallaron".

Esto es lo que hace la pantalla usable con doscientos productos: un fallo parcial no puede
obligar a rehacer todo.

### 1.4 — Salir con cambios sin guardar

Si hay filas sucias y el usuario navega afuera o cierra la pestaña, se advierte
(`beforeunload` + bloqueo de navegación de React Router). Perder media hora de carga por un
click al sidebar es exactamente el fracaso que esta pantalla tiene que evitar.

### 1.5 — Validación en el cliente

- Precio: número ≥ 0, hasta 2 decimales. Vacío es válido (deja el precio en `null`).
- Alícuota: solo 0, 10.5, 21, 27. El backend también lo valida (422); el cliente evita el viaje.
- Si el usuario escribe algo no numérico, la fila no se manda y se marca en rojo.

## 2. Tests obligatorios

`web/src/pages/CargaPreciosPage.test.tsx`:
- Renderiza filas con precio y sin precio, y las segundas llevan el badge "Sin precio".
- El filtro "Solo los que no tienen precio" acota el listado.
- Editar un precio marca la fila como sucia y habilita "Guardar cambios".
- **Guardar hace un PUT por fila sucia, y solo por las sucias.**
- **Fallo parcial:** con tres filas sucias y la segunda devolviendo `ApiError`, las otras dos
  se guardan igual, la que falló queda sucia con su mensaje, y el resumen dice "2 de 3".
- El precio se manda tal como se tipeó (**es el precio final con IVA incluido**; la pantalla
  no lo divide ni le suma nada).
- La alícuota fuera de {0, 10.5, 21, 27} no se puede elegir.
- La pestaña Servicios usa `PUT /servicios/:id` y manda `precio` y `alicuotaIva`.
- Ningún request contiene `tenantId`.

## 3. Prohibido en esta tanda

```
- Calcular, derivar o sugerir un precio a partir del costo, del margen objetivo o de nada.
  El precio lo pone una persona. Si la pantalla lo sugiere, alguien lo acepta.
- Sembrar precios de ejemplo fuera del seed de desarrollo.
- Guardar automáticamente al tipear (autosave). El guardado es explícito.
- Promise.all sobre los PUT.
- Tocar supabase/, ni buscar un rodeo para escribir precios por PostgREST: `productos` y
  `servicios` solo tienen policy de SELECT para el usuario; la escritura va por la API
  porque es auditable.
```

## 4. Definición de terminado

1. `npm run typecheck` en verde.
2. `cd web && npm run test:run` en verde.
3. `npm test` sin cambios.
4. Con el tenant de prueba: cargar precio a diez productos y dos servicios, recargar la
   página, y verificar que quedaron.
5. Un commit: `feat(comercial-fe): carga asistida de precios de productos y servicios [0b]`
`````

---

## F1 · TANDA 2 — Pantalla de Productos

`prompts_frontend/F1_T2_productos.md`

`````markdown
# F1 · TANDA 2 — Pantalla de Productos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §2.4, §2.5, §2.8, §4.6 | Superficie, costo/margen, precio con IVA, estilo. |
| `web/src/pages/CatalogosPage.tsx` | El patrón completo: tabs, tabla, debounce, paginación, `useCatalogoTab`. **Es el molde.** |
| `web/src/components/catalogos/CatalogoSheets.tsx` | El formulario en `Sheet`. |
| `web/src/components/catalogos/DesactivarCatalogoDialog.tsx` | Baja lógica con el error DENTRO del diálogo. |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `CrearProductoSchema` completo: los 20 campos y sus límites. |
| `web/src/auth/AuthContext.tsx` | Cómo se leen los permisos de la sesión. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta un campo o un filtro: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
RENDIMIENTO — un fetch por listado. Familias y unidades se resuelven con un Map cargado
  UNA vez, nunca con un fetch por fila.
PRECIO — precio_venta es el precio FINAL con IVA incluido. El label lo dice.
COSTO Y MARGEN — costoReposicion y margenObjetivo se muestran en esta pantalla (es el ABM,
  no el mostrador), pero el margen calculado va detrás de view_sales.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/ProductosPage.tsx` en `/stock/productos`, permiso `manage_products`.

### 1.1 — Listado

`GET /productos` con los filtros que la API acepta **y ninguno más**: `search`, `familiaId`,
`activo`, `vendible`, `page`, `limit`.

Barra de filtros: búsqueda con debounce 300 ms, Select de familia, Select de estado
(Todos / Activos / Dados de baja), switch "Solo vendibles".

Columnas, con ocultamiento progresivo: código, nombre, **familia** (resuelta por `Map`),
marca (`hidden md:table-cell`), **unidad** (`hidden lg:table-cell`, resuelta por `Map`),
**precio** (con IVA), alícuota (`hidden xl:table-cell`), estado, acciones.

Badges: verde "Activo" / gris "Dado de baja"; ámbar **"Sin precio"** cuando `precioVenta`
es `null` — ese badge es el que hace visible el trabajo pendiente de la tanda 0b.
Badge extra para `condicionVenta` distinto de `libre` (púrpura, "Bajo receta" /
"Bajo receta archivada" / "Uso profesional").

**No hay columna de stock.** `GET /productos` no lo devuelve y traerlo por fila sería N+1
(§4.6). La existencia se ve en `/stock/existencias`, que es la pantalla de F2·T1.

### 1.2 — Alta y edición (`Sheet`)

Todos los campos de `CrearProductoSchema`, agrupados:

- **Identificación:** `codigo`, `nombre`, `descripcion`, `marca`, `codigoBarras`.
- **Clasificación:** `familiaId` (Select), `unidadMedidaId` (Select desde
  `listarUnidadesMedida()`), `condicionVenta` (Select con los cuatro valores del ENUM).
- **Precio:** `precioVenta` (label **"Precio final (IVA incluido)"**), `alicuotaIva`
  (Select 0 / 10,5 / 21 / 27), `costoReposicion`, `margenObjetivo`.
- **Control de stock:** `controlaLote`, `controlaVencimiento`, `vidaUtilPostAperturaDias`,
  `stockMinimo`, `requiereFrio`, `trazable`.
- **Uso:** `esVendible`, `esConsumibleClinico`.

Validación en el cliente espejando el schema (longitudes, `alicuotaIva` en el conjunto
permitido, `vidaUtilPostAperturaDias` entre 1 y 3650, `margenObjetivo` entre 0 y 999.99).
El backend valida igual; el cliente evita el viaje y da el mensaje al lado del campo.

`vidaUtilPostAperturaDias` solo tiene sentido con `controlaVencimiento`: deshabilitalo cuando
está en `false`, con un `title` que lo explique.

### 1.3 — Baja lógica

`PATCH /productos/:id/estado`. `AlertDialog` con el texto: *"«{nombre}» deja de ofrecerse en
ventas nuevas y en el mostrador. Los lotes y las ventas que ya lo usan lo siguen mostrando."*
El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

Reactivar no lleva diálogo: no es destructivo.

### 1.4 — Margen calculado, detrás del permiso

Si el producto tiene `precioVenta` y `costoReposicion`, mostrar el margen real calculado
(`(precio − costo) / costo`) **solo si la sesión tiene `view_sales`**. Sin el permiso, la
línea no se renderiza (no se muestra vacía ni tachada).

Comentario obligatorio en el código: *no es una barrera de seguridad — `costoReposicion` y
`margenObjetivo` viajan en el payload de `GET /productos` bajo `view_stock`, que la
recepcionista tiene. Ver `PLAN_FRONTEND_COMERCIAL.md` §2.4.*

## 2. Tests obligatorios

`web/src/pages/ProductosPage.test.tsx`:
- Estados vacío, cargando y error.
- Los filtros arman el query string correcto y el de búsqueda hace debounce.
- Un producto con `precioVenta: null` muestra el badge "Sin precio".
- El nombre de la familia y el de la unidad salen del `Map`: **con 20 filas, la cantidad de
  fetch es constante** (un test que cuente las llamadas).
- Alta: manda exactamente los campos del schema, ninguno de más, y **ningún `tenantId`**.
- El label del precio dice "IVA incluido" (regla §2.5).
- `RN §2.4: el margen no se renderiza sin view_sales`.
- `RN §2.1: la baja pide confirmación y el error del backend queda dentro del diálogo`.
- No aparece la palabra "Comprobante", "Factura" ni "Ticket" en ningún lado.

## 3. Prohibido

```
- Columna de stock en el listado (sería N+1 — §4.6).
- Inventar filtros que la API no acepta (no hay filtro por marca, ni por condición de venta,
  ni por "sin precio" — el badge se calcula en el cliente sobre la página traída).
- Borrado físico. Solo baja lógica.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck` en verde. 2. `cd web && npm run test:run` en verde.
3. `npm test` sin cambios. 4. Alta, edición y baja probadas contra el tenant de prueba.
5. Un commit: `feat(comercial-fe): ABM de productos [F1·T2]`
`````

---

## F1 · TANDA 3 — Familias de producto y Proveedores

`prompts_frontend/F1_T3_familias_proveedores.md`

`````markdown
# F1 · TANDA 3 — Familias de producto y Proveedores
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde. F1·T2 conviene, para reusar sus piezas.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §1.10, §2.8 | Superficie y permisos. |
| `web/src/pages/CatalogosPage.tsx` | El molde de tabla + filtros + paginación. |
| `web/src/pages/ProductosPage.tsx` (F1·T2) | Piezas reutilizables (badges de estado, diálogo de baja). |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `CrearFamiliaSchema`: **solo** `nombre` y `unidadBaseId`. |
| `supabase/functions/api/src/modules/proveedores/proveedores.schemas.ts` | `CrearProveedorSchema` completo. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
RENDIMIENTO — un fetch por listado. Unidades por Map, cargado una vez.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
PERMISOS — familias exige manage_products; proveedores exige manage_suppliers TAMBIÉN PARA
  LEER (el requirePermission está en el middleware compartido del router). El veterinario
  no puede listar proveedores.
TESTS — cd web && npm run test:run
```

## 1. Qué construir — dos pantallas separadas

Son dos rutas y dos permisos distintos, así que **no van en tabs de una misma pantalla**
(a diferencia de `CatalogosPage`, donde los tres catálogos comparten `manage_catalogs`).

### 1.1 — `web/src/pages/FamiliasPage.tsx` en `/stock/familias` (`manage_products`)

Listado con `GET /familias-producto` (`search`, `activo`, `page`, `limit`).
Columnas: nombre, **unidad base** (por `Map` desde `listarUnidadesMedida()`), estado, acciones.

Alta/edición en `Dialog` (son dos campos, no justifica un `Sheet`): `nombre` (2–100) y
`unidadBaseId` (Select, **obligatorio y sin default** — RN-PR8).

Baja lógica con `PATCH /:id/estado` y `AlertDialog`: *"«{nombre}» deja de ofrecerse al
clasificar productos nuevos. Los productos que ya la usan la siguen mostrando."* El error del
backend queda **dentro** del diálogo.

> **Por qué la unidad base importa y hay que explicarlo en la UI:** es la unidad en la que se
> compara el stock de toda la familia. Poné un texto de ayuda bajo el Select.

### 1.2 — `web/src/pages/ProveedoresPage.tsx` en `/stock/proveedores` (`manage_suppliers`)

Listado con `GET /proveedores` (`search`, `activo`, `page`, `limit`).
Columnas: razón social, nombre de fantasía (`hidden md:table-cell`), CUIT, condición fiscal
(badge), teléfono (`hidden lg:table-cell`), email (`hidden xl:table-cell`), estado, acciones.

Alta/edición en `Sheet` con todos los campos de `CrearProveedorSchema`: `razonSocial`,
`nombreFantasia`, `cuit`, `condicionFiscal` (Select con los seis valores del ENUM), `telefono`,
`email`, `direccion`, `contactoNombre`, `observaciones`, `clienteId`.

**`clienteId` es el campo delicado.** Vincula la ficha de proveedor con una de cliente cuando
son el mismo sujeto real (decisión P-10, opción A). **No las fusiona.** Va como un buscador de
clientes opcional, con texto de ayuda: *"Si este proveedor también es cliente de la clínica,
vinculá su ficha. Las dos fichas siguen siendo independientes."*

**El CUIT no se valida por dígito verificador**: el backend solo valida formato y longitud
(máx. 20). No agregues una validación que el backend no hace — rechazarías datos que la API
acepta.

Baja lógica con `AlertDialog`: *"«{razonSocial}» deja de ofrecerse al cargar compras nuevas.
Las compras ya registradas lo siguen mostrando."*

## 2. Tests obligatorios

`FamiliasPage.test.tsx`:
- Estados vacío, cargando, error.
- La unidad base sale del `Map`: cantidad de fetch constante con N filas.
- El alta **no manda** la familia sin `unidadBaseId` (RN-PR8).
- `RN §2.1: la baja pide confirmación y el error queda dentro del diálogo`.

`ProveedoresPage.test.tsx`:
- Estados vacío, cargando, error, y el caso **403** (un rol sin `manage_suppliers` ve el
  mensaje del backend, no una tabla vacía).
- El alta manda exactamente los campos del schema; los vacíos van como `null`, no como `""`.
- Un CUIT con formato raro pero dentro de 20 caracteres **se manda** (no lo bloquea el cliente).
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Fusionar proveedor y cliente en una sola ficha. clienteId ENLAZA, no fusiona (P-10).
- Validar el dígito verificador del CUIT.
- Meter las dos pantallas en tabs de una sola ruta: son permisos distintos.
- Borrado físico. Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Alta, edición y baja probadas en las dos pantallas.
5. Un commit: `feat(comercial-fe): ABM de familias y proveedores [F1·T3]`
`````

---

## F2 · TANDA 1 — Existencias y detalle de lote

`prompts_frontend/F2_T1_existencias_lotes.md`

`````markdown
# F2 · TANDA 1 — Existencias y detalle de lote
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde.
> **Esta tanda convive con dos bugs conocidos del backend. No los arregles: la pantalla se
> diseña alrededor de ellos.** Ver `PLAN_FRONTEND_COMERCIAL.md` §4.1, §4.2 y §4.3.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.2, §2.4, §4.1, §4.2, §4.3 | Superficie y los dos bugs. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` líneas 282–326 | `existenciaPorProducto`: la prueba de que devuelve una fila por LOTE. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` líneas 114–182 | `listarLotes`: el post-filtro de `conExistencia`. |
| `web/src/pages/CatalogosPage.tsx` | El molde de tabla, filtros y paginación. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Los bugs §4.1/§4.2/§4.3 se rodean, no se arreglan.
TENANT — el frontend NUNCA manda tenant_id.
RENDIMIENTO — un fetch por listado. Prohibido un fetch por fila.
COSTO — esta pantalla SÍ muestra costo (es la de stock, no el mostrador). El margen, no.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/ExistenciasPage.tsx` en `/stock/existencias` (`view_stock`)

**El punto crítico de esta tanda.** `GET /existencias` devuelve **una fila por LOTE**, no por
producto: `existencias_lote` tiene PK por `lote_id` y el Service no agrupa. Un producto con
tres lotes vuelve tres veces. Y `meta.total` cuenta lotes, así que **la paginación de la API
no corresponde a lo que la pantalla muestra**.

Cómo se resuelve, y es la única forma admitida:

1. Pedir con `limit` alto (100, el máximo que acepta el schema) recorriendo las páginas hasta
   agotar `meta.total`.
2. **Agregar en el cliente por `productoId`**, sumando `cantidad`.
3. **Paginar del lado del cliente** sobre el resultado agregado.
4. **No mostrar el `total` de la API en ningún lado.**

Comentario obligatorio arriba de la función de agregación, citando §4.1 y §4.2 y explicando
que es un rodeo de un bug del backend, no una decisión de diseño.

Columnas: producto (código + nombre), unidad, **cantidad total**, cantidad de lotes,
**valorización** (`GET /existencias/valorizacion`), acciones (→ ver lotes).
Filtro de búsqueda con debounce (el `search` de la API filtra por nombre de producto).

Arriba, una tarjeta con la **valorización total del inventario**.

### 1.2 — `web/src/pages/LotesPage.tsx` — listado de lotes

Ruta `/stock/existencias` con un parámetro de producto, o una vista embebida al expandir una
fila. `GET /lotes` con `productoId`, `estado`, `venceAntesDe`, `conExistencia`, `page`, `limit`.

Columnas: código de lote, producto, proveedor, fecha de ingreso, **vencimiento**,
**cantidad**, **costo unitario efectivo**, estado (badge), acciones.

Badges de estado: verde `disponible`, ámbar `cuarentena`, rojo `bloqueado` y `vencido`,
gris `agotado`.

**Trampa de `conExistencia` (§4.3):** el filtro se aplica **después** de paginar, en memoria
sobre la página ya traída. La página vuelve con menos ítems que `limit` y el `total` incluye
los descartados. **No uses el `total` de este endpoint cuando `conExistencia` está activo**;
paginá con "Anterior / Siguiente" en vez de con números de página, y deshabilitá "Siguiente"
cuando la respuesta cruda venga con menos de `limit` ítems. Comentario en el código citando §4.3.

### 1.3 — `web/src/pages/LoteDetallePage.tsx` en `/stock/lotes/:id` (`view_stock`)

Tres bloques:

- **Ficha:** `GET /lotes/:id` — producto, código de lote, proveedor, ingreso, vencimiento,
  cantidad, costo unitario neto y efectivo, estado, origen.
- **Kardex:** `GET /lotes/:id/kardex` paginado. Tabla de movimientos con fecha, tipo (badge
  por tipo), cantidad con signo, y el documento asociado. **Si el movimiento referencia una
  venta, la columna dice "Operación N°", nunca "Comprobante".**
- **Trazabilidad:** `GET /lotes/:id/trazabilidad` — la cadena lote padre ↔ lotes hijos que
  dejó el fraccionamiento. Renderizala como árbol, con link a cada lote.

## 2. Tests obligatorios

`ExistenciasPage.test.tsx`:
- `§4.1: tres filas del mismo productoId se muestran como UNA con la cantidad sumada.`
- `§4.2: el total de meta no se usa para paginar` (con `meta.total: 30` y 10 productos
  distintos, el paginador dice 10, no 30).
- Estados vacío, cargando, error.
- Con N productos, la cantidad de fetch es constante.

`LotesPage.test.tsx`:
- `§4.3: con conExistencia activo, el paginador no usa meta.total` y "Siguiente" se
  deshabilita cuando la respuesta trae menos de `limit`.
- Los badges de estado corresponden a los cinco valores del ENUM.

`LoteDetallePage.test.tsx`:
- Los tres bloques cargan y muestran sus estados vacío/cargando/error.
- `§2.6: el kardex dice "Operación N°" y en ninguna parte "Comprobante" ni "Factura".`
- La trazabilidad sin padre ni hijos muestra el estado vacío, no un árbol roto.

## 3. Prohibido

```
- "Arreglar" §4.1 o §4.3 tocando supabase/. Se rodean en el cliente y se comentan.
- Un fetch de lotes por cada fila de existencias.
- Mostrar el margen (no hay dato de venta acá) ni inventar un cálculo de rentabilidad.
- Botones de ajuste, bloqueo o recuento: son F5.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Con un producto que tenga 3 lotes cargados, la pantalla de existencias muestra **una** fila.
5. Un commit: `feat(comercial-fe): existencias, lotes y kardex [F2·T1]`
`````

---

## F2 · TANDA 2 — Vencimientos próximos

`prompts_frontend/F2_T2_vencimientos.md`

`````markdown
# F2 · TANDA 2 — Vencimientos próximos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.2, §4.3, §4.5 | Superficie, el bug de `conExistencia` y por qué el umbral lo elige la pantalla. |
| `web/src/pages/LotesPage.tsx` (F2·T1) | Piezas reutilizables: badges de estado, tabla de lotes. |
| `web/src/lib/fechas.ts` | Helpers de fecha del repo. **Usá estos, no escribas otros.** |
| `supabase/functions/api/src/modules/stock/stock.service.ts` `notificarLotesPorVencer` | De dónde sale el default de 60 días. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No existe GET /lotes-por-vencer: la vista
  v_lotes_por_vencer está REVOCADA para `authenticated` y no tiene endpoint. Esta pantalla
  se arma con GET /lotes?venceAntesDe=... Si hace falta algo más: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
ESTILO — docs/GUIA_ESTILO.md. Ámbar = próximo a vencer. Rojo = vencido.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/VencimientosPage.tsx` en `/stock/vencimientos` (`view_stock`).

### 1.1 — El umbral lo elige la pantalla, y hay que dejarlo escrito

`configuracion_tenant.dias_alerta_vencimiento` **es la fuente correcta del umbral**, y el
Service la usa para las notificaciones. Pero la API de configuración **no la expone**
(`ConfiguracionPublica` solo tiene `cupoMaximoDiario`, `diasAvisoVacuna` y `parametrosExtra`).

Entonces: un `Select` de rango con **30 / 60 / 90 días**, por defecto **60**, que es el
default del Service (`config?.dias_alerta_vencimiento ?? 60`).

**Comentario obligatorio** en el componente: *la config del tenant es la fuente correcta de
este umbral; la pantalla la está sustituyendo porque la API no la expone. Ver
`PLAN_FRONTEND_COMERCIAL.md` §4.5.*

### 1.2 — Los datos

`GET /lotes?venceAntesDe=<hoy + N días>&conExistencia=true&limit=100`, recorriendo páginas.

**Trampa (§4.3):** `conExistencia` filtra **después** de paginar. No uses `meta.total`;
recorré las páginas hasta que la respuesta cruda venga con menos de `limit` ítems.

Los lotes **ya vencidos** también entran: `venceAntesDe` es un `lte`, así que vuelven solos.
Hay que separarlos visualmente, no esconderlos — un lote vencido con existencia es el caso
más urgente de todos.

### 1.3 — Presentación

Tres grupos, en este orden, cada uno con su contador en el encabezado:

1. **Vencidos** (rojo) — `fechaVencimiento < hoy`.
2. **Vencen esta semana** (ámbar) — dentro de 7 días.
3. **Vencen en el rango elegido** (gris/ámbar suave) — el resto hasta N días.

Columnas: producto, código de lote, **vencimiento**, **días restantes** (negativos si venció),
cantidad, proveedor, acciones (→ `/stock/lotes/:id`).

Filtro adicional por producto (Select alimentado por los lotes ya traídos, sin fetch extra).

Estado vacío con copy propio: *"No hay lotes que venzan en los próximos N días."* — no el
genérico "No hay resultados".

### 1.4 — Nada de acciones destructivas acá

Esta pantalla **informa**. Dar de baja un lote vencido es un ajuste
(`merma_vencimiento`) y vive en F5·T1. Poné un link a `/stock/ajustes` en cada fila vencida,
no el formulario.

## 2. Tests obligatorios

`VencimientosPage.test.tsx`:
- Los tres grupos se arman bien: un lote con vencimiento de ayer va a "Vencidos", uno de
  dentro de 3 días a "Esta semana", uno de dentro de 45 al tercer grupo.
- Los días restantes de un lote vencido son negativos y se muestran como tales.
- Cambiar el rango a 30 dispara un fetch nuevo con el `venceAntesDe` recalculado.
- `§4.3: la paginación no usa meta.total` — con `meta.total: 100` y una respuesta de 3 ítems
  (post-filtro), no intenta pedir más páginas.
- `§4.5: el selector de rango existe y arranca en 60.`
- Estado vacío con el copy propio.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Pedir la vista v_lotes_por_vencer por PostgREST: está REVOCADA para `authenticated`
  (migración 20261027000001) y devolvería 401/403. No es un descuido: es hardening.
- Poner el formulario de ajuste acá. Es F5·T1.
- Usar meta.total con conExistencia activo.
- Escribir helpers de fecha propios: usá web/src/lib/fechas.ts.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Con un lote vencido y uno por vencer en el tenant de prueba, los dos aparecen en su grupo.
5. Un commit: `feat(comercial-fe): panel de vencimientos próximos [F2·T2]`
`````

---

## F2 · TANDA 3 — Compras: borrador, ítems y recepción

`prompts_frontend/F2_T3_compras.md`

`````markdown
# F2 · TANDA 3 — Compras: borrador, ítems y recepción
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T3 en verde (necesita proveedores) y F2·T1 (para ver el resultado).

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.3, §2.1, §2.5 | Superficie y la regla de irreversibles. |
| `supabase/functions/api/src/modules/compras/compras.schemas.ts` | Los cinco schemas exactos. |
| `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql` | Qué hace confirmar: crea los lotes y los movimientos de entrada. |
| `web/src/pages/ProveedoresPage.tsx` (F1·T3) | El buscador de proveedor. |
| `web/src/components/catalogos/DesactivarCatalogoDialog.tsx` | Confirmación con el error dentro del diálogo. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — todo /compras exige manage_suppliers (módulo stock). El veterinario no entra.
COSTO — esta pantalla trabaja con costos: es su razón de ser. No hay margen acá.
IVA — en compras el costo se carga NETO (costoUnitarioNeto) + alicuotaIva por separado.
  OJO: es al revés que en ventas, donde el precio es final con IVA incluido. No los mezcles.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/ComprasPage.tsx` en `/stock/compras`

Listado con `GET /compras` (`proveedorId`, `estado`, `desde`, `hasta`, `page`, `limit`).
Columnas: fecha, proveedor, comprobante del proveedor (tipo + número), estado (badge:
gris `borrador`, verde `confirmada`, rojo `anulada`), total, acciones.

> **Nota de copy:** `comprobanteProveedorTipo` / `comprobanteProveedorNumero` **sí** son un
> comprobante — el que emitió el proveedor. Ahí la palabra "Comprobante" es correcta. La
> prohibición de §2.6 es sobre `numero_operacion`, que es otra cosa.

Botón "Nueva compra" → `POST /compras` (borrador) y navegación al detalle.

### 1.2 — `web/src/pages/CompraDetallePage.tsx` en `/stock/compras/:id`

**Estado `borrador` — todo editable:**

- Cabecera (`PUT /compras/:id`): proveedor, fecha, tipo y número de comprobante del proveedor,
  observaciones, y el switch **`generaEgresoCaja`** con texto de ayuda: *"Al confirmar, registra
  el egreso en la caja abierta."*
- Ítems (`POST/PUT/DELETE /compras/:id/items`): tabla editable con producto (buscador),
  cantidad, **costo unitario neto**, alícuota (Select 0 / 10,5 / 21 / 27), **código de lote**
  y **fecha de vencimiento**.
- **Los dos campos de lote son el corazón de la recepción.** `codigoLote` y `fechaVencimiento`
  son los que van a crear el lote al confirmar. Si el producto tiene `controlaLote` o
  `controlaVencimiento` en `true`, marcá el campo como requerido en la UI y explicá por qué.
- Totales calculados en el cliente y mostrados con el desglose neto / IVA / total. Acá **sí**
  el desglose es primario: es una compra, no una venta de mostrador.

**Estados `confirmada` y `anulada` — solo lectura.** Ningún control de edición se renderiza
(no deshabilitado: no se renderiza).

### 1.3 — Confirmar es irreversible (§2.1)

`POST /compras/:id/confirmar` con `AlertDialog`, y el texto **dice qué queda registrado**:

> *"Se van a crear N lotes con las cantidades y vencimientos cargados, y sus movimientos de
> entrada en el libro de stock. La compra queda confirmada y sus ítems no se pueden volver a
> editar. No se puede deshacer."*

Si `generaEgresoCaja` está activo, sumá: *"Además se registra el egreso de $X en la caja
abierta."*

El error del backend se muestra **dentro del diálogo, sin cerrarlo**. Los casos que hay que
poder leer sin adivinar: sin sesión de caja abierta con `generaEgresoCaja`, compra sin ítems,
producto inactivo.

### 1.4 — Anular

`POST /compras/:id/anular` con `{ motivo }`, **mínimo 10 caracteres** (lo valida el backend;
validalo también en el cliente con el contador de caracteres a la vista).
`AlertDialog`: *"Se revierten los movimientos de stock de esta compra. Los lotes creados
quedan sin existencia. No se puede deshacer."*

## 2. Tests obligatorios

`ComprasPage.test.tsx`: estados vacío/cargando/error, filtros, badges por estado.

`CompraDetallePage.test.tsx`:
- En `borrador` los controles de edición están; en `confirmada` **no se renderizan**.
- Agregar un ítem manda exactamente los campos de `agregarItemCompraSchema`.
- Los totales se calculan bien: neto × cantidad, IVA por alícuota, total.
- `RN §2.1: confirmar pide confirmación explícita, el texto nombra los lotes que se crean y
  dice que no se puede deshacer.`
- `RN §2.1: el error de confirmar queda DENTRO del diálogo y el diálogo no se cierra.`
- Anular con motivo de menos de 10 caracteres no habilita el botón.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Editar ítems de una compra confirmada o anulada.
- Cargar el costo con IVA incluido. En compras el costo es NETO (al revés que en ventas).
- Confirmar sin AlertDialog, o con un texto genérico tipo "¿Estás seguro?".
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Ciclo completo probado: crear borrador → agregar 2 ítems con lote y vencimiento →
   confirmar → verificar en `/stock/existencias` que las cantidades entraron.
5. Un commit: `feat(comercial-fe): compras y recepción de mercadería [F2·T3]`
`````

---

## F3 · TANDA 1 — Caja: apertura y movimientos

`prompts_frontend/F3_T1_caja_apertura_movimientos.md`

`````markdown
# F3 · TANDA 1 — Caja: apertura y movimientos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde.
> **Es prerrequisito del mostrador:** `RegistrarVentaSchema` exige `sesionCajaId`. Sin una
> sesión abierta, F4 no puede vender.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.4, §1.9, §1.10 | Superficie, medios de pago por PostgREST, permisos. |
| `supabase/functions/api/src/modules/caja/caja.schemas.ts` | Los cuatro schemas exactos. |
| `supabase/functions/api/src/modules/caja/caja.service.ts` | La forma de `SesionCaja` y `MovimientoCaja`. |
| `web/src/api/catalogos-comercial.ts` (F1·T1) | `listarMediosPago()`. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — todo /caja exige manage_cash (módulo ventas). El veterinario NO lo tiene.
MEDIOS DE PAGO — no hay endpoint. Se leen por PostgREST con listarMediosPago(). Es un
  catálogo GLOBAL con policy auth.uid() IS NOT NULL. Sin esa lista no se puede registrar
  un movimiento: medioPagoId es obligatorio y es un UUID.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/CajaPage.tsx` en `/ventas/caja` (`manage_cash`)

**Lo primero que hace es preguntar si hay sesión abierta:** `GET /caja/sesiones/actual`.
De ahí salen dos estados de pantalla completamente distintos.

**Estado A — sin sesión abierta.** Panel centrado con el formulario de apertura:
- Select de caja (`GET /caja/cajas`; si hay una sola, preseleccionada y sin Select).
- `saldoInicial` (número ≥ 0, requerido).
- Botón "Abrir caja" → `POST /caja/sesiones`.
- Texto de ayuda: *"El saldo inicial es el efectivo con el que arranca el turno. Se usa para
  calcular el arqueo al cerrar."*

Abrir **no** es irreversible, así que **no lleva `AlertDialog`**. Cerrar sí (F3·T2).

**Estado B — con sesión abierta.** Tres bloques:

1. **Cabecera de la sesión:** caja, quién la abrió, desde cuándo, saldo inicial, y un botón
   destacado **"Cerrar caja"** que navega a `/ventas/caja/:sesionId` (F3·T2).
2. **Resumen en vivo:** `GET /caja/sesiones/:id/resumen` — tarjetas con `saldoInicial`,
   `saldoTeoricoEfectivo` y una tabla de `totalesPorMedioPago` (medio, ingresos, egresos,
   neto), marcando cuáles **afectan el arqueo** (`afectaArqueo`).
3. **Movimientos:** la lista de la sesión, con el formulario de alta.

### 1.2 — Registrar un movimiento

`POST /caja/sesiones/:id/movimientos` con `{ tipo, medioPagoId, importe, motivo?, referencia? }`.

Formulario en `Dialog`:
- `tipo`: Select con los siete valores del ENUM, **agrupados en dos grupos visuales**
  (Ingresos: `ingreso_venta`, `ingreso_cobro_cuenta_corriente`, `ingreso_manual`; Egresos:
  `egreso_pago_proveedor`, `egreso_devolucion`, `egreso_manual`, `egreso_retiro`).
- `medioPagoId`: Select desde `listarMediosPago()`.
- `importe`: número **positivo** (el schema exige `> 0`; el signo lo da el `tipo`, no el importe).
- `motivo`: si se completa, **mínimo 10 caracteres** (el schema lo exige cuando no es null).
  Contador de caracteres a la vista.
- `referencia`: mostrala como **requerida** cuando el medio de pago elegido tiene
  `requiere_referencia: true`. El backend no lo obliga; la UI sí lo pide, porque una
  transferencia sin referencia no se concilia después.

> **Ojo con `ingreso_venta`:** los movimientos de venta los crea la RPC de `POST /ventas`
> automáticamente. Ofrecer `ingreso_venta` a mano permite duplicar el ingreso. Dejalo en el
> Select (el backend lo acepta) pero **con un texto de advertencia**: *"Las ventas registran
> su ingreso automáticamente. Usá esta opción solo para corregir."*

### 1.3 — Lista de movimientos

Columnas: hora, tipo (badge verde ingreso / rojo egreso), medio de pago, importe, motivo,
referencia. Sin paginación propia: los movimientos vienen embebidos en `GET /caja/sesiones/:id`.

### 1.4 — Historial de sesiones

`GET /caja/sesiones` (`estado`, `desde`, `hasta`, `page`, `limit`) en una tabla debajo, o en
una segunda pestaña. Columnas: caja, apertura, cierre, saldo inicial, efectivo contado,
**diferencia** (verde si 0, ámbar si menor, rojo si mayor a un umbral visual), estado.

## 2. Tests obligatorios

`CajaPage.test.tsx`:
- Sin sesión abierta se muestra el formulario de apertura; con sesión abierta, los tres bloques.
- Abrir manda `{ cajaId, saldoInicial }` y **no** lleva `AlertDialog`.
- El Select de medios de pago se llena desde `listarMediosPago()` (PostgREST), no desde la API.
- Un motivo de 5 caracteres no habilita el botón; uno de 10, sí.
- Elegir un medio con `requiere_referencia: true` marca `referencia` como requerida.
- El importe negativo se rechaza en el cliente.
- `ingreso_venta` muestra la advertencia.
- El resumen marca cuáles medios afectan el arqueo.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Poner el cierre de caja acá. Es F3·T2, y es irreversible: tiene su propia pantalla.
- Inventar un endpoint de medios de pago. Se leen por PostgREST.
- Mandar el importe con signo. Es siempre positivo; el signo lo da el tipo.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Abrir una caja, registrar un ingreso manual y un egreso, y ver los dos en el resumen
   por medio de pago.
5. Un commit: `feat(comercial-fe): apertura de caja y movimientos [F3·T1]`
`````

---

## F3 · TANDA 2 — Arqueo y cierre de caja

`prompts_frontend/F3_T2_arqueo_cierre.md`

`````markdown
# F3 · TANDA 2 — Arqueo y cierre de caja
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F3·T1 en verde.
> **Cerrar caja es irreversible.** No hay endpoint que reabra una sesión. Esta pantalla es
> el ejemplo canónico de la regla §2.1: la confirmación dice qué queda registrado y que no
> hay vuelta atrás.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.4, §2.1 | La forma de `ResumenSesion` y la regla de irreversibles. |
| `supabase/functions/api/src/modules/caja/caja.service.ts` `resumenSesion` | Los cinco campos del arqueo y `totalesPorMedioPago`. |
| `supabase/functions/api/src/modules/caja/caja.schemas.ts` `CerrarSesionSchema` | `{ efectivoContado, motivo?, observaciones? }`. |
| `web/src/components/catalogos/DesactivarCatalogoDialog.tsx` | Error dentro del diálogo. |
| `web/src/pages/CajaPage.tsx` (F3·T1) | El resumen que se reusa. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No existe endpoint para reabrir una sesión y no
  se inventa uno. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_cash.
IRREVERSIBLE — §2.1: AlertDialog cuyo texto nombra el efecto concreto y dice que no se
  deshace. Un "¿Estás seguro?" genérico NO cumple.
ESTILO — docs/GUIA_ESTILO.md. Verde = sin diferencia. Ámbar/rojo = diferencia.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/ArqueoCajaPage.tsx` en `/ventas/caja/:sesionId` (`manage_cash`).

### 1.1 — Lo que se muestra antes de contar

`GET /caja/sesiones/:id/resumen` da todo lo necesario:

- `saldoInicial`
- `saldoTeoricoEfectivo` — lo que **debería** haber en el cajón
- `totalesPorMedioPago[]` con `{ medioPagoId, codigo, nombre, afectaArqueo, ingresos, egresos, neto }`

Presentación: una tarjeta grande con el **saldo teórico en efectivo**, y una tabla con los
totales por medio de pago **separando los que afectan el arqueo de los que no**. Solo el
efectivo afecta el arqueo (`afecta_arqueo: true` únicamente en `efectivo`); los demás se
listan como informativos, porque el cajero igual necesita verlos para cuadrar con el
liquidador de tarjetas.

### 1.2 — El conteo

Un solo campo obligatorio: **`efectivoContado`** (número ≥ 0).

**El campo arranca vacío.** No lo precargues con el saldo teórico: si lo hacés, la gente lo
acepta y el arqueo deja de existir. Es el mismo razonamiento que la regla §2.3 del
fraccionamiento.

Opcional: una **ayuda de conteo por denominación** (billetes × cantidad) que suma al campo.
Si la implementás, el campo sigue siendo editable a mano y el total de la ayuda solo lo
sugiere al presionar "Usar este total".

### 1.3 — La diferencia, en vivo

Apenas hay un valor tipeado, mostrar **`efectivoContado − saldoTeoricoEfectivo`**:

- **0** → verde, "Sin diferencia".
- **Negativo** → rojo, "Faltan $X".
- **Positivo** → ámbar, "Sobran $X".

Cuando hay diferencia (distinta de 0), el campo **`motivo` pasa a ser requerido en la UI**,
con mínimo 10 caracteres y contador a la vista. El backend acepta `motivo` nulo; **la pantalla
lo exige igual**, porque una diferencia sin explicación es exactamente el dato que después
nadie puede reconstruir.

`observaciones` queda siempre opcional (máx. 500).

### 1.4 — La confirmación (§2.1)

`AlertDialog` con el texto armado con los números reales:

> **"Cerrar la caja"**
> *"Se registra el arqueo con un efectivo contado de $X sobre un saldo teórico de $Y, con una
> diferencia de $Z. La diferencia y su motivo quedan asentados en la sesión y en la auditoría.
> La sesión queda cerrada y **no se puede volver a abrir**: las ventas siguientes van a
> necesitar una sesión nueva."*

Cuando la diferencia es 0, la frase de la diferencia se ajusta a *"sin diferencia"*, pero
**las dos últimas oraciones no cambian**: el cierre es irreversible igual.

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

### 1.5 — Después de cerrar

La pantalla pasa a **solo lectura** mostrando el arqueo final (`efectivoContado`,
`diferencia`, motivo, observaciones) y un botón para volver a `/ventas/caja`, que ahora va a
ofrecer abrir una sesión nueva.

Una sesión ya cerrada abierta por URL muestra directamente esta vista de solo lectura, sin
formulario.

## 2. Tests obligatorios

`ArqueoCajaPage.test.tsx`:
- El resumen se renderiza con los cinco campos y la tabla por medio de pago, separando los
  que afectan el arqueo.
- **`§2.3/§1.2: el campo de efectivo contado arranca VACÍO, no precargado con el teórico.`**
- La diferencia se calcula y se colorea bien en los tres casos (0, faltante, sobrante).
- Con diferencia distinta de 0, `motivo` es requerido y con menos de 10 caracteres el botón
  de cerrar no se habilita.
- Con diferencia 0, `motivo` no es requerido.
- `RN §2.1: el AlertDialog nombra el efectivo contado, el teórico, la diferencia, y dice que
  la sesión no se puede volver a abrir.`
- `RN §2.1: el error del backend queda DENTRO del diálogo y el diálogo no se cierra.`
- Una sesión con estado `cerrada` se renderiza en solo lectura, sin formulario.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Precargar efectivoContado con el saldo teórico. Es el error que anula el arqueo entero.
- Cerrar sin AlertDialog, o con un texto que no nombre la diferencia y la irreversibilidad.
- Ofrecer "reabrir sesión". No existe el endpoint y no se inventa.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
2. Ciclo probado: abrir caja con $1000 → un ingreso de $500 → cerrar contando $1450 →
   la diferencia dice "Faltan $50", exige motivo, y la sesión queda cerrada.
5. Un commit: `feat(comercial-fe): arqueo y cierre de caja [F3·T2]`
`````

---

## F4 · TANDA 1 — Mostrador: buscador por familia, favoritos y carrito

`prompts_frontend/F4_T1_mostrador_buscador_carrito.md`

`````markdown
# F4 · TANDA 1 — Mostrador: buscador por familia, favoritos y carrito
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** 0b en verde (sin precios el mostrador no sirve) y F3·T1 en verde
> (sin sesión de caja no se puede vender).
> **Es la pantalla que el negocio percibe COMO el módulo.** Esta tanda arma el buscador y el
> carrito; el cobro y el FEFO son F4·T2.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §1.5, §2.4, §2.5, §4.6, §7 (P-09) | Superficie, costo, precio con IVA, por qué no hay columna de stock. |
| `supabase/functions/api/src/modules/ventas/ventas.schemas.ts` | `ItemVentaInputSchema` completo. |
| `web/src/api/catalogos-comercial.ts` (F1·T1) | `listarServiciosVendibles()`. |
| `web/src/components/ui/command.tsx` | El componente de búsqueda del kit. |
| `web/src/pages/CajaPage.tsx` (F3·T1) | Cómo se obtiene la sesión abierta. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No hay endpoint de favoritos: van en
  localStorage. No hay stock en GET /productos: no hay columna de stock. Si falta otra
  cosa: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_sales (módulo ventas).
PRECIO — precio_venta y servicios.precio SON el precio final con IVA incluido. Es lo que se
  muestra en el botón, en la línea y en el total. El desglose neto/IVA NO va acá.
COSTO — el costo NO se renderiza en el mostrador. Decisión de UI, no barrera de seguridad
  (§2.4): costoReposicion viaja igual en el payload bajo view_stock.
COPY — nunca "Comprobante", "Factura", "Ticket" ni "Recibo".
RENDIMIENTO — un fetch por búsqueda. Prohibido un fetch por resultado.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/MostradorPage.tsx` en `/ventas` (`manage_sales`). Layout de dos columnas:
**buscador a la izquierda, carrito a la derecha** (apilado en mobile).

### 1.1 — Guardia de sesión de caja

Antes de todo, `GET /caja/sesiones/actual`. **Sin sesión abierta el mostrador no se dibuja**:
en su lugar, un panel que explica *"No hay una caja abierta. Las ventas necesitan una sesión
de caja."* con un link a `/ventas/caja`.

Si el usuario no tiene `manage_cash`, el panel dice que **pida a alguien que abra la caja**,
sin el link (no puede abrirla).

### 1.2 — El buscador (P-09: familia y favoritos desde acá, no desde F8)

Se planifica **asumiendo que va a haber cientos de derivados** por el fraccionamiento. Tres
formas de encontrar un ítem, las tres en pantalla al mismo tiempo:

**a) Búsqueda por texto.** `GET /productos?search=&vendible=true&activo=true`, debounce 250 ms.
El `search` del backend hace `ilike` sobre nombre, código **y código de barras**, así que el
escáner funciona pegando el código acá.

**b) Filtro por familia.** Una fila de chips con las familias
(`GET /familias-producto?activo=true&limit=100`, una sola vez). Click en un chip →
`GET /productos?familiaId=...&vendible=true&activo=true`. Es el camino principal cuando el
catálogo se llena de derivados.

**c) Favoritos.** Una grilla de accesos rápidos arriba de todo.
**No hay backend de favoritos** (§7, P-09): van en `localStorage`, con una clave que incluya
el id del usuario (`leo:mostrador:favoritos:<userId>`) para que dos personas en la misma
máquina no compartan la lista. Cada resultado tiene una estrella para agregar/quitar.
Envolvé lectura y escritura de `localStorage` en `try/catch`: en modo privado tira.

**Pestaña de servicios.** Un tab aparte alimentado por `listarServiciosVendibles()`
(PostgREST). Un servicio sin `precio` se muestra deshabilitado con el badge ámbar
"Sin precio" — no se puede agregar al carrito, porque la RPC lo va a rechazar igual.

**Sin columna de stock (§4.6).** `GET /productos` no devuelve existencia y traerla por fila
sería N+1. La disponibilidad se consulta al agregar el ítem, en F4·T2. Un producto con
`precioVenta: null` sí se marca deshabilitado con "Sin precio".

### 1.3 — El carrito

Estado local. Cada línea:

- Descripción, **precio unitario (con IVA)**, cantidad editable, **descuento por línea (%)**,
  y el importe de la línea.
- Botón de quitar.
- Para productos, un espacio reservado para el selector de lote — **lo llena F4·T2**.
- Para productos, un selector opcional de **mascota** (`mascotaId` del schema), que sirve para
  ligar la venta a un paciente.

Totales al pie: **total con IVA incluido, en grande**. Un descuento global (`descuento`, ≥ 0)
y un selector de cliente opcional (`clienteId`; sin cliente es venta de mostrador anónima).

`condicionPago`: `contado` por defecto. `cuenta_corriente` **solo se ofrece si hay cliente
seleccionado** — sin cliente no hay a quién ponerle la cuenta.

**Validación de cantidad por unidad.** La RPC valida que la cantidad respete los decimales de
la unidad (`cantidad_valida_para_unidad`, RN-PR6) y responde `UNIT_NO_DECIMALS`. Con
`listarUnidadesMedida()` ya tenés `admite_decimales` y `escala_decimal`: usalos para poner el
`step` del input y evitar el viaje. **No repliques la validación como regla propia**: el
backend manda, el cliente solo ayuda.

### 1.4 — Lo que esta tanda NO hace

El botón de cobrar queda visible pero **deshabilitado**, con el texto "Cobro — F4·T2".
Nada de `POST /ventas` todavía.

## 2. Tests obligatorios

`MostradorPage.test.tsx`:
- Sin sesión de caja abierta, el mostrador no se dibuja y aparece el panel con el link.
- Sin `manage_cash`, el panel no muestra el link.
- La búsqueda por texto hace debounce y manda `vendible=true&activo=true`.
- **`P-09: el filtro por familia existe y manda familiaId.`**
- **`P-09: los favoritos persisten en localStorage por usuario y sobreviven al remontado.`**
- `localStorage` que tira excepción no rompe la pantalla.
- Un producto con `precioVenta: null` está deshabilitado con el badge "Sin precio".
- Un servicio sin precio, igual.
- `§2.5: el precio que se muestra es precio_venta tal cual, sin sumarle ni restarle IVA.`
- `§2.4: el costo no aparece en ninguna parte del mostrador.`
- `§2.6: no aparece "Comprobante", "Factura", "Ticket" ni "Recibo".`
- `cuenta_corriente` solo se puede elegir con cliente seleccionado.
- El total del carrito es la suma de las líneas con IVA incluido, menos el descuento global.
- Con 20 resultados, la cantidad de fetch es constante (no hay N+1).

## 3. Prohibido

```
- Columna de stock en los resultados (sería N+1 — §4.6).
- Mostrar costo o margen.
- Inventar un endpoint de favoritos, o guardarlos en la base por otro camino.
- Llamar a POST /ventas: es F4·T2.
- Desglosar neto/IVA en el carrito. El desglose es del detalle de la venta.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Con caja abierta y precios cargados: buscar por texto, filtrar por familia, marcar un
   favorito, recargar y verificar que sigue, y armar un carrito de 3 líneas con el total bien.
5. Un commit: `feat(comercial-fe): mostrador — buscador, favoritos y carrito [F4·T1]`
`````

---

## F4 · TANDA 2 — Mostrador: FEFO, cobro y cierre de venta

`prompts_frontend/F4_T2_mostrador_fefo_cobro.md`

`````markdown
# F4 · TANDA 2 — Mostrador: FEFO, cobro y cierre de venta
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F4·T1 en verde.
> **Acá viven dos reglas de negocio que se manifiestan en pantalla y no se negocian:** el
> lote sugerido por FEFO (§2.2) y el precio con IVA incluido (§2.5).

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.5, §2.2, §2.5, §2.6 | Superficie, FEFO, precio, copy. |
| `supabase/functions/api/src/modules/ventas/ventas.schemas.ts` | `ItemVentaInputSchema` (`loteId`, `motivoFefo`) y `PagoVentaInputSchema`. |
| `supabase/functions/api/src/modules/stock/stock.service.ts` `listarCandidatosFefo` | El orden en que vuelven los lotes: el primero es el sugerido. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` | Qué errores puede tirar y con qué código. |
| `web/src/api/catalogos-comercial.ts` (F1·T1) | `listarMediosPago()`. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_sales.
FEFO — §2.2: el lote sugerido viene marcado; elegir otro EXIGE motivo EN EL MISMO
  FORMULARIO, no en un paso posterior que se pueda saltear.
PRECIO — con IVA incluido. El desglose neto/IVA es secundario y va en el comprobante interno
  posterior a la venta, no en el carrito ni en el total.
COPY — "Operación N°". NUNCA "Comprobante N°", "Factura N°", "Ticket N°" ni "Recibo N°".
COSTO — no se renderiza en el mostrador.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — Selector de lote con FEFO (§2.2)

Al agregar un **producto** al carrito, la línea consulta
`GET /lotes/candidatos?productoId=&cantidad=`. Devuelve los lotes en orden FEFO.

Comportamiento obligatorio:

- **El primer lote viene preseleccionado y marcado visualmente como "Sugerido (vence antes)"**,
  con su fecha de vencimiento y su existencia a la vista.
- Si el usuario abre el selector y **elige otro lote**, en el acto:
  - aparece el campo **`motivoFefo`** en **la misma línea del carrito**, y
  - pasa a ser **requerido**: sin motivo, la venta no se puede cobrar.
- **El motivo no puede quedar para después.** Nada de "te lo pedimos al confirmar": ese paso
  se saltea y el dato se pierde, que es exactamente lo que la regla evita.
- Si la respuesta viene vacía, la línea se marca **"Sin stock disponible"** y bloquea el cobro.
- Si la suma de los lotes candidatos es menor a la cantidad pedida, avisá antes de cobrar.

Cuando el usuario cambia la cantidad de la línea, **se vuelve a consultar** con la cantidad
nueva (con debounce). No reutilices los candidatos de una cantidad distinta.

### 1.2 — El cobro

Panel de cobro que se abre desde el botón "Cobrar" (habilitado cuando el carrito tiene al
menos una línea y todas las líneas de producto tienen lote resuelto y, si corresponde, motivo).

- **Total a cobrar, con IVA incluido, en grande.**
- Lista de **pagos** (`pagos[]`): cada uno con `medioPagoId` (desde `listarMediosPago()`),
  `importe` (> 0) y `referencia`. Botón para agregar más de un pago (venta mixta).
- **`referencia` se marca como requerida** cuando el medio elegido tiene
  `requiere_referencia: true`.
- Un indicador en vivo de **cuánto falta cubrir**: `total − suma(pagos)`. Con
  `condicionPago: "contado"` el botón de confirmar se habilita cuando la suma cubre el total;
  con `cuenta_corriente` se permite cubrir menos, y lo que falta queda como
  `saldoPendiente`.
- Atajo "Pagar todo en efectivo" que arma un único pago por el total.

### 1.3 — Confirmar la venta

`POST /ventas` con `{ sesionCajaId, clienteId, condicionPago, items, pagos, descuento,
observaciones }`.

`items[]` lleva, por línea: `tipoItem`, `productoId` **o** `servicioId` (nunca los dos),
`cantidad`, `descuentoPorcentaje`, `loteId`, `motivoFefo`, `mascotaId`.

**No mandes `precioUnitario`.** El campo existe y es opcional, pero el precio tiene que salir
del catálogo: es la única forma de que la línea se lleve la alícuota del producto (D-03). Si
un ítem no tiene precio, el problema se arregla en el catálogo, no en el mostrador.

**Errores de la RPC que hay que mostrar con un mensaje entendible**, cada uno por su `code`:
`PRODUCT_WITHOUT_PRICE`, `PRODUCT_NOT_SELLABLE`, `PRODUCT_INACTIVE`, `UNIT_NO_DECIMALS`,
`INSUFFICIENT_STOCK`, `CASH_SESSION_NOT_FOUND` (o cerrada), y el genérico. **El carrito no se
vacía ante un error**: el cajero tiene que poder corregir y reintentar.

### 1.4 — Después de vender

Panel de éxito con:

- **"Operación N° {numeroOperacion}"** — así, con esas palabras. Es el único lugar donde el
  número se muestra al cerrar la venta, y **no es un comprobante fiscal**.
- Total, medios de pago usados, y `saldoPendiente` si hubo.
- El **desglose neto / IVA acá sí** (es el detalle posterior, no el carrito).
- Botones: "Nueva venta" (vacía el carrito) y "Ver detalle" (→ `/ventas/:id`, que llega en F4·T3).

### 1.5 — Comprobante interno imprimible (opcional dentro de esta tanda)

Si lo hacés, el encabezado dice **"Operación N° X"** y lleva la leyenda
**"Documento no válido como factura"**. Ninguna palabra de las prohibidas.

## 2. Tests obligatorios

`MostradorPage.test.tsx` (ampliando el de F4·T1):
- **`RN §2.2: el primer lote candidato viene preseleccionado y marcado como sugerido.`**
- **`RN §2.2: elegir un lote distinto al sugerido muestra motivoFefo EN LA MISMA LÍNEA y lo
  vuelve requerido.`**
- **`RN §2.2: con lote no sugerido y motivo vacío, el botón de cobrar queda deshabilitado.`**
- `RN §2.2: cambiar la cantidad vuelve a pedir candidatos con la cantidad nueva.`
- Sin candidatos, la línea dice "Sin stock disponible" y bloquea el cobro.
- El cobro exige `referencia` cuando el medio de pago la requiere.
- Con `contado`, cobrar se habilita solo cuando los pagos cubren el total.
- Con `cuenta_corriente` y cliente, se permite cubrir menos.
- **`POST /ventas` NO manda `precioUnitario`.**
- Cada `code` de error de la RPC produce su mensaje, y **el carrito no se vacía**.
- **`RN §2.6: el panel de éxito dice "Operación N°" y en ningún lado "Comprobante", "Factura",
  "Ticket" ni "Recibo".`**
- `§2.5: el total del carrito es con IVA incluido; el desglose aparece recién después de vender.`
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Pedir el motivo FEFO en un paso posterior, en un modal de confirmación, o "al final".
  Va en la misma línea, en el momento.
- Preseleccionar un lote que no sea el primero que devuelve /lotes/candidatos.
- Mandar precioUnitario desde el mostrador (rompe D-03: la línea perdería la alícuota).
- Las palabras "Comprobante", "Factura", "Ticket" o "Recibo" para numero_operacion.
- Vaciar el carrito ante un error de la RPC.
- Mostrar costo o margen. Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Venta real de punta a punta contra el tenant de prueba: 2 productos (uno con lote no
   sugerido + motivo) y 1 servicio, pago mixto, y verificar en `/stock/existencias` que el
   stock bajó de los lotes correctos.
5. Un commit: `feat(comercial-fe): mostrador — FEFO, cobro y cierre de venta [F4·T2]`
`````

---

## F4 · TANDA 3 — Ventas: listado, detalle, anulación y devolución

`prompts_frontend/F4_T3_ventas_detalle_anulacion_devolucion.md`

`````markdown
# F4 · TANDA 3 — Ventas: listado, detalle, anulación y devolución
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F4·T2 en verde.
> **La devolución vive acá y no en F5** (donde el backend la ubicó, en C5): necesita
> `ventaItemId`, que solo sale de `GET /ventas/:id`. Ver `PLAN_FRONTEND_COMERCIAL.md` §3.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.5, §1.6, §2.1, §2.6, §3 | Superficie, irreversibles, copy, el desvío de la devolución. |
| `supabase/functions/api/src/modules/ventas/ventas.service.ts` `obtenerPorId` y `buscarPaginado` | **Devuelven snake_case crudo.** La conversión está en `web/src/api/comercial/ventas.ts` (F1·T1). |
| `supabase/functions/api/src/modules/ajustes/ajustes.schemas.ts` `RegistrarDevolucionSchema` | La forma exacta de la devolución. |
| `supabase/migrations/20260922000003_comercial_anular_venta_rpc.sql` | Qué hace anular: revierte stock y registra el egreso. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISOS — listar/ver/devolver: manage_sales. ANULAR: manage_sales + void_sales (que la
  recepcionista NO tiene). Sin view_sales, el backend acota listado y detalle a las ventas
  DEL PROPIO USUARIO (§8.2): el copy del estado vacío no puede afirmar que no hay ventas.
FORMA — GET /ventas y GET /ventas/:id llegan en snake_case con items y pagos embebidos.
COPY — "Operación N°" siempre. NUNCA "Comprobante", "Factura", "Ticket" ni "Recibo".
IRREVERSIBLES — anular y devolver van con AlertDialog que nombra el efecto (§2.1).
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/VentasHistorialPage.tsx` en `/ventas/historial` (`manage_sales`)

`GET /ventas` con `clienteId`, `sesionCajaId`, `usuarioId`, `estado`, `desde`, `hasta`,
`page`, `limit`.

Columnas: **Operación N°**, fecha/hora, cliente (o "Mostrador" si es anónima), vendedor,
total, condición de pago, saldo pendiente, estado (badge verde `registrada` / rojo `anulada`).

**El filtro por vendedor (`usuarioId`) solo se muestra si la sesión tiene `view_sales`**: sin
ese permiso el backend ignora el filtro y acota al usuario llamador, así que ofrecerlo
engañaría.

**Copy del estado vacío, con cuidado:** sin `view_sales`, decí *"No registraste ventas con
estos filtros."* — no *"No hay ventas"*, que sería falso: puede haberlas de otro cajero.
Con `view_sales`, *"No hay ventas con estos filtros."*

### 1.2 — `web/src/pages/VentaDetallePage.tsx` en `/ventas/:id` (`manage_sales`)

`GET /ventas/:id`. Bloques:

- **Cabecera:** **"Operación N° {numero_operacion}"** como título, fecha, cliente, vendedor,
  sesión de caja, condición de pago, estado.
- **Ítems:** descripción (el snapshot que guardó la RPC), cantidad, precio unitario,
  descuento, importe. Si la línea tiene lote, mostralo con su vencimiento; si tiene
  `motivo_fefo`, **mostralo también** — es el registro de por qué no se siguió el FEFO y
  esconderlo lo vuelve inútil.
- **Totales:** total con IVA en grande y, **acá sí**, el desglose `subtotal_neto` / `total_iva`.
- **Pagos:** medio, importe, referencia.
- **Acciones:** "Anular" (solo con `void_sales` y si la venta está `registrada`) y "Devolver".

Si la venta está `anulada`, ninguna acción se renderiza y un banner rojo lo dice.

### 1.3 — Anular (§2.1)

`POST /ventas/:id/anular` con `{ sesionCajaId, motivo }` (motivo mínimo 10 caracteres,
contador a la vista). El `sesionCajaId` es **la sesión abierta ahora**
(`GET /caja/sesiones/actual`), no la sesión original de la venta.

`AlertDialog`:

> **"Anular la operación N° X"**
> *"Se reintegra el stock a los lotes de los que salió, se registra el egreso de $Y en la caja
> abierta y la operación queda marcada como anulada. El motivo queda asentado en la auditoría.
> **No se puede deshacer.**"*

**Sin caja abierta no se puede anular**: el botón se deshabilita con un `title` que lo
explique, porque la RPC va a fallar igual.

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

### 1.4 — Devolver (§2.1)

`POST /devoluciones` con
`{ ventaId, items: [{ ventaItemId, cantidad, revendible }], motivo, reintegraEfectivo, sesionCajaId }`.

Formulario en `Sheet`, partiendo de los ítems de la venta:

- Una fila por ítem, con checkbox para incluirlo y un campo de cantidad **acotado a lo
  vendido**.
- Por ítem, un switch **`revendible`**. Texto de ayuda: *"Revendible reintegra la unidad al
  stock. Si no lo es, se registra como merma."* Es la diferencia que decide si la mercadería
  vuelve a estar disponible, y no se puede dejar implícita.
- `motivo` (mínimo 10 caracteres, contador a la vista).
- `reintegraEfectivo` con `sesionCajaId` de la sesión abierta; si no hay caja abierta, el
  switch queda deshabilitado y explicado.

`AlertDialog` antes de enviar:

> **"Registrar la devolución"**
> *"Se devuelven N unidades de la operación N° X. Las marcadas como revendibles vuelven al
> stock; las demás se registran como merma. {Se reintegran $Y en efectivo desde la caja
> abierta.} La devolución queda asentada y **no se puede deshacer**."*

## 2. Tests obligatorios

`VentasHistorialPage.test.tsx`:
- Estados vacío, cargando, error.
- **`§8.2: sin view_sales, el filtro por vendedor no se renderiza y el copy vacío dice
  "No registraste ventas", no "No hay ventas".`**
- `§2.6: la columna dice "Operación N°" y no aparece "Comprobante", "Factura", "Ticket" ni
  "Recibo".`

`VentaDetallePage.test.tsx`:
- La fila snake_case se renderiza bien (items y pagos embebidos).
- `§2.2: si una línea tiene motivo_fefo, se muestra.`
- El desglose neto/IVA aparece acá (y no aparecía en el carrito).
- **`sin void_sales el botón Anular no se renderiza.`**
- `RN §2.1: anular pide confirmación, el texto nombra el reintegro de stock, el egreso de
  caja y que no se puede deshacer.`
- Sin caja abierta, Anular queda deshabilitado y explicado.
- `RN §2.1: el error de anular queda DENTRO del diálogo.`
- Devolución: la cantidad no puede superar la vendida; `revendible` se manda por ítem;
  el motivo de menos de 10 caracteres no habilita.
- `RN §2.1: la confirmación de devolución distingue revendible de merma.`
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Ofrecer Anular sin void_sales, aunque sea deshabilitado con candado: no se renderiza.
- Mandar como sesionCajaId la sesión original de la venta. Va la sesión ABIERTA AHORA.
- Dejar `revendible` implícito o con un default invisible.
- Las palabras prohibidas de §2.6.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado contra el tenant: ver una venta de F4·T2, devolver una unidad revendible y
   verificar que el stock volvió; anular otra venta y verificar el egreso en la caja.
5. Un commit: `feat(comercial-fe): historial, detalle, anulación y devolución de ventas [F4·T3]`
`````

---

## F5 · TANDA 1 — Ajustes de existencia y bloqueo de lotes

`prompts_frontend/F5_T1_ajustes_bloqueo.md`

`````markdown
# F5 · TANDA 1 — Ajustes de existencia y bloqueo de lotes
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.6, §1.10, §2.1 | Superficie, permisos, irreversibles. |
| `supabase/functions/api/src/modules/ajustes/ajustes.schemas.ts` | `AjustarExistenciaSchema`, `BloquearLoteSchema`, `DesbloquearLoteSchema`. |
| `web/src/pages/LotesPage.tsx` (F2·T1) | El listado de lotes que se reusa para elegir el lote. |
| `web/src/pages/VencimientosPage.tsx` (F2·T2) | De ahí llegan los links de lotes vencidos. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_stock (módulo stock). Ni la recepcionista ni el veterinario lo tienen:
  esta pantalla es de admin. El gating ya está en la ruta (F1·T1).
IRREVERSIBLE — un ajuste escribe en el libro mayor y NO se borra. AlertDialog con el
  efecto nombrado (§2.1).
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/AjustesPage.tsx` en `/stock/ajustes` (`manage_stock`).

### 1.1 — Elegir el lote

Buscador de producto → lista de sus lotes (`GET /lotes?productoId=&conExistencia=true`), con
código de lote, vencimiento, existencia actual y estado. Si se llega con un `loteId` en la
query (desde `/stock/vencimientos`), viene preseleccionado.

**Trampa de `conExistencia` (§4.3):** el filtro se aplica después de paginar. No uses
`meta.total`. Para un solo producto, con `limit=100` alcanza en la práctica.

### 1.2 — Registrar el ajuste

`POST /ajustes` con `{ loteId, tipo, cantidad, motivo }`.

- `tipo`: Select con los cuatro valores del ENUM, **con su explicación al lado, porque la
  diferencia importa y no es obvia**:
  - `entrada_ajuste` — "Aparece stock que el sistema no tenía."
  - `salida_ajuste` — "Falta stock que el sistema tenía."
  - `merma_rotura` — "Se rompió o se perdió."
  - `merma_vencimiento` — "Se descarta por vencido."
- `cantidad`: número **positivo** (el signo lo da el tipo, no el importe).
- `motivo`: **mínimo 10 caracteres**, contador a la vista. Es lo único que va a quedar para
  explicar el desvío dentro de seis meses.

Mostrá en vivo **la existencia resultante** (`existencia actual ± cantidad`) antes de
confirmar. Si diera negativa, avisá: la RPC lo va a rechazar (RN-MV5) y es mejor saberlo antes.

`AlertDialog`:

> **"Registrar el ajuste"**
> *"Se registra un movimiento de {tipo} por {cantidad} sobre el lote {código}. La existencia
> pasa de {X} a {Y}. El movimiento queda asentado en el libro de stock y en la auditoría, y
> **no se puede borrar**: para corregirlo hay que registrar otro ajuste en sentido contrario."*

Esa última frase es importante y va tal cual: explica **cómo** se corrige un error, que es lo
que el usuario va a necesitar saber justo después de equivocarse.

### 1.3 — Bloquear y desbloquear lotes

`POST /lotes/:id/bloquear` y `/desbloquear`, los dos con `{ motivo }` de mínimo 10 caracteres.

Van como acciones en la fila del lote y en `/stock/lotes/:id`.

`AlertDialog` de bloqueo:
> *"El lote {código} deja de estar disponible para ventas y para consumo clínico. Su
> existencia no cambia. Se puede desbloquear después."*

El bloqueo **sí** es reversible, y el texto lo dice — no lo pintes de irreversible, porque
entonces nadie lo usa. El de desbloqueo es el simétrico.

Badge rojo "Bloqueado" en todas las vistas de lote (ya está en F2·T1; verificá que se vea).

## 2. Tests obligatorios

`AjustesPage.test.tsx`:
- Los cuatro tipos aparecen con su explicación.
- La cantidad negativa se rechaza en el cliente.
- La existencia resultante se calcula y se muestra antes de confirmar.
- Una existencia resultante negativa muestra la advertencia.
- El motivo de menos de 10 caracteres no habilita el botón.
- `RN §2.1: el AlertDialog nombra el tipo, la cantidad, el lote, la existencia antes y
  después, y dice que no se puede borrar sino corregir con otro ajuste.`
- `RN §2.1: el error del backend queda DENTRO del diálogo.`
- Bloquear/desbloquear mandan `{ motivo }` y su diálogo dice que **sí** es reversible.
- `§4.3: no se usa meta.total con conExistencia activo.`
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Mandar la cantidad con signo. Es positiva; el signo lo da el tipo.
- Ofrecer "borrar" o "revertir" un ajuste: no existe el endpoint. Se corrige con otro ajuste.
- Pintar el bloqueo como irreversible.
- Poner recuentos acá. Son F5·T2.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: una merma por vencimiento sobre un lote real, verificando en el kardex del lote
   (F2·T1) que el movimiento quedó.
5. Un commit: `feat(comercial-fe): ajustes de existencia y bloqueo de lotes [F5·T1]`
`````

---

## F5 · TANDA 2 — Recuentos de inventario

`prompts_frontend/F5_T2_recuentos.md`

`````markdown
# F5 · TANDA 2 — Recuentos de inventario
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F5·T1 en verde.
> **Aplicar un recuento es irreversible** y genera tantos ajustes como desvíos haya. Es la
> operación de mayor impacto de todo el módulo stock.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.6, §2.1, §2.3, §4.3 | Superficie, irreversibles, la regla de no precargar, el bug de paginación. |
| `supabase/functions/api/src/modules/ajustes/ajustes.schemas.ts` | `CrearRecuentoSchema`, `GuardarDetallesRecuentoSchema`, `AplicarRecuentoSchema`. |
| `supabase/migrations/20260929000003_comercial_aplicar_recuento_rpc.sql` | Qué hace aplicar, y qué significa `confirmarDesvios`. |
| `web/src/pages/AjustesPage.tsx` (F5·T1) | El patrón de confirmación con el efecto nombrado. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_stock.
NO PRECARGAR LO CONTADO — mismo razonamiento que §2.3 y que el arqueo de F3·T2: si el campo
  viene con el número del sistema, la gente lo acepta y el recuento no cuenta nada.
IRREVERSIBLE — aplicar va con AlertDialog que nombra cuántos ajustes se generan.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/RecuentosPage.tsx` en `/stock/recuentos` (`manage_stock`)

`GET /recuentos` (`estado`, `page`, `limit`). Columnas: fecha, quién lo creó, estado (badge
gris `borrador` / verde `aplicado`), cantidad de lotes contados, observaciones.

Botón "Nuevo recuento" → `POST /recuentos` con `{ observaciones? }` y navegación al detalle.

Un recuento en `borrador` se puede **eliminar** (`DELETE /recuentos/:id`) — eso sí es
reversible, porque todavía no escribió nada en el libro mayor. `AlertDialog` simple.

### 1.2 — `web/src/pages/RecuentoDetallePage.tsx` en `/stock/recuentos/:id`

**Estado `borrador` — la planilla de conteo.**

Se arma con los lotes con existencia: `GET /lotes?conExistencia=true&limit=100`, recorriendo
páginas. **Trampa §4.3:** el filtro se aplica después de paginar; no uses `meta.total`, seguí
pidiendo hasta que la respuesta cruda venga con menos de `limit`.

Una fila por lote: producto, código de lote, vencimiento, **cantidad del sistema** y
**cantidad contada** (input).

Reglas de la planilla, y son el punto de la tanda:

- **El campo "cantidad contada" arranca VACÍO.** No lo precargues con la cantidad del sistema.
- La **cantidad del sistema se muestra**, pero en una columna aparte y visualmente secundaria.
  Se muestra porque el schema tiene `cantidadSistema` y sirve para detectar el desvío en el
  momento; no se precarga porque entonces nadie cuenta.
- Apenas hay un valor tipeado, la fila muestra **el desvío** (contado − sistema) con color:
  verde 0, ámbar/rojo distinto de 0.
- Una fila con desvío habilita su campo **`motivo`** (opcional para el backend, pero pedilo:
  un desvío sin explicación es un dato perdido).
- Filtro por producto y buscador, para poder contar por sector.
- **Guardado parcial:** `PUT /recuentos/:id/detalles` manda el conjunto **completo** de ítems
  cargados hasta el momento. Botón "Guardar avance", más autoguardado cada N cambios. Un
  recuento de inventario dura horas: perder el avance es inaceptable.
- Advertencia al salir con cambios sin guardar.

**Estado `aplicado` — solo lectura.** Tabla con sistema, contado, desvío y motivo por fila, y
un resumen arriba: cuántos lotes se contaron, cuántos tuvieron desvío, y el desvío neto.

### 1.3 — Aplicar (§2.1)

`POST /recuentos/:id/aplicar` con `{ confirmarDesvios }`.

Antes de mostrar el diálogo, **calculá y mostrá el impacto**: cuántas filas tienen desvío,
cuántas unidades en total hacia arriba y hacia abajo.

`AlertDialog`:

> **"Aplicar el recuento"**
> *"Se van a generar {N} movimientos de ajuste sobre {M} lotes, para llevar la existencia del
> sistema a lo contado: {A} unidades de entrada y {B} de salida. Los movimientos quedan
> asentados en el libro de stock y en la auditoría. El recuento queda aplicado y **no se puede
> deshacer** — para corregirlo hay que registrar ajustes nuevos."*

**`confirmarDesvios`** es un checkbox **dentro del diálogo**, no un switch escondido en la
página: *"Confirmo que los desvíos son correctos y deben aplicarse."* Sin tildarlo, el botón
de aplicar no se habilita cuando hay desvíos. Si no hay ninguno, no hace falta.

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

## 2. Tests obligatorios

`RecuentosPage.test.tsx`: estados vacío/cargando/error, badges, eliminar solo en `borrador`.

`RecuentoDetallePage.test.tsx`:
- **`RN §2.3: el campo "cantidad contada" arranca VACÍO, no precargado con la cantidad del
  sistema.`**
- La cantidad del sistema se muestra en su columna.
- Tipear un valor distinto muestra el desvío con el color correcto; igual, verde.
- Una fila con desvío habilita el campo de motivo.
- "Guardar avance" manda el conjunto **completo** de ítems cargados.
- `§4.3: la carga de lotes no usa meta.total con conExistencia activo.`
- `RN §2.1: el AlertDialog nombra la cantidad de movimientos, los lotes afectados, las
  unidades de entrada y salida, y dice que no se puede deshacer.`
- **`RN §2.1: con desvíos, el botón de aplicar no se habilita hasta tildar confirmarDesvios,
  y el checkbox está DENTRO del diálogo.`**
- `RN §2.1: el error del backend queda DENTRO del diálogo.`
- Un recuento `aplicado` se renderiza en solo lectura, sin inputs.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Precargar la cantidad contada con la del sistema. Es el error que anula el recuento entero.
- Poner confirmarDesvios como un switch en la página, lejos de la confirmación.
- Ofrecer "deshacer" un recuento aplicado: no existe el endpoint.
- Editar un recuento aplicado.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Ciclo completo: crear recuento → contar 3 lotes, uno con desvío → guardar avance →
   recargar y verificar que el avance está → aplicar → verificar el ajuste en el kardex.
5. Un commit: `feat(comercial-fe): recuentos de inventario [F5·T2]`
`````

---

## F6 · TANDA 1 — Fraccionamiento

`prompts_frontend/F6_T1_fraccionamiento.md`

`````markdown
# F6 · TANDA 1 — Fraccionamiento
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.
> **Acá vive la regla §2.3, que es la razón de ser de esta pantalla:** la cantidad obtenida
> la TIPEA el usuario. Si la precargás con el teórico, la gente la acepta y se pierde la
> merma real, que es el único dato que esta pantalla existe para capturar.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §1.7, §2.1, §2.3 | Superficie, conversiones, irreversibles, la regla de la cantidad tipeada. |
| `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.schemas.ts` | `FraccionarLoteSchema`: los siete campos. |
| `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.calculo.ts` | Cómo se calcula el teórico y la merma. **Leelo para mostrar los mismos números, no para reimplementarlo.** |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` `CrearDerivadoSchema` | El alta de producto derivado desde plantilla. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISOS — POST /fraccionamiento exige split_stock (lo tienen admin, veterinario y
  recepcionista). Las dos lecturas (sugerir-vencimiento e historial) exigen view_stock.
  Crear un producto derivado exige manage_products, que SOLO tiene el admin.
IRREVERSIBLE — fraccionar consume el lote origen y crea uno nuevo. AlertDialog con el
  efecto nombrado (§2.1).
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/FraccionamientoPage.tsx` en `/stock/fraccionamiento` (`split_stock`).

### 1.1 — Elegir origen y destino

1. **Producto origen** → buscador. Luego **lote origen**:
   `GET /lotes?productoId=&conExistencia=true` (trampa §4.3: no uses `meta.total`).
   Mostrá existencia y vencimiento de cada lote.
2. **Producto destino**: `GET /producto-conversiones?productoOrigenId=&activo=true` da las
   conversiones definidas, cada una con su `factorTeorico` y su `mermaEsperadaPorcentaje`.
   Si no hay ninguna, mostrá el estado vacío con un link a crear una (F1·T2 / catálogo), o
   —si la sesión tiene `manage_products`— el atajo de `POST /productos/:id/derivado`, que crea
   el producto derivado y su conversión de una vez.

### 1.2 — El formulario (§2.3 — el corazón de la tanda)

Cuatro campos:

- **`cantidadOrigen`** — cuánto se toma del lote. Número positivo, acotado a la existencia.
- **`cantidadObtenida`** — **EL CAMPO QUE EL USUARIO TIPEA. ARRANCA VACÍO.**
- **`codigoLoteDestino`** — requerido, 1–50 caracteres. Podés sugerir un patrón
  (`{loteOrigen}-F1`) **en el placeholder**, no como valor.
- **`fechaVencimientoDestino`** — precargado con lo que devuelve
  `GET /fraccionamiento/sugerir-vencimiento?loteOrigenId=&productoDestinoId=` **y editable**.
  Este sí se precarga: es un cálculo del backend sobre la vida útil post-apertura, no una
  observación de la realidad.
- **`motivo`** — opcional.

**Al lado del campo de cantidad obtenida, y no dentro de él**, mostrá permanentemente:

```
Teórico: {cantidadOrigen × factorTeorico} {unidad destino}
Merma esperada: {mermaEsperadaPorcentaje}%
```

Y apenas el usuario tipea algo, debajo:

```
Merma real: {teórico − obtenido} {unidad} ({porcentaje}%)
```

Con color: verde/neutro si está dentro de la merma esperada, ámbar si la supera, rojo si el
obtenido supera al teórico (que es posible y hay que poder registrarlo, pero merece que se vea).

**Nunca escribas el teórico dentro del input.** Ni al cargar, ni al cambiar el producto
destino, ni con un botón "usar el teórico". El número tiene que salir de mirar la balanza.

### 1.3 — Confirmar (§2.1)

`POST /fraccionamiento`. `AlertDialog`:

> **"Fraccionar el lote"**
> *"Se descuentan {cantidadOrigen} {unidad origen} del lote {código origen} y se crea el lote
> {código destino} con {cantidadObtenida} {unidad destino}. La merma de {X} queda registrada
> como tal. Los movimientos quedan asentados en el libro de stock y **no se pueden deshacer**."*

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

Después del éxito: panel con el lote nuevo creado y link a `/stock/lotes/:id`, donde la
trazabilidad (F2·T1) ya muestra la cadena padre → hijo.

### 1.4 — Historial

`GET /fraccionamiento/historial` (`productoOrigenId`, `productoDestinoId`, `page`, `limit`) en
una tabla debajo o en una pestaña: fecha, lote origen, lote destino, cantidad origen,
cantidad obtenida, **merma**, quién lo hizo.

## 2. Tests obligatorios

`FraccionamientoPage.test.tsx`:
- **`RN §2.3: el campo cantidadObtenida arranca VACÍO.`**
- **`RN §2.3: cambiar el producto destino o la cantidad origen NO escribe el teórico dentro
  del input.`**
- `RN §2.3: el teórico y la merma esperada se muestran al lado del campo, siempre.`
- `RN §2.3: al tipear, la merma real se calcula y se colorea` (dentro de lo esperado, por
  encima, y obtenido > teórico).
- `fechaVencimientoDestino` se precarga desde `sugerir-vencimiento` **y es editable**.
- `codigoLoteDestino` vacío no habilita el botón; el patrón sugerido está en el placeholder,
  no en el valor.
- `cantidadOrigen` mayor a la existencia del lote se rechaza en el cliente.
- `RN §2.1: el AlertDialog nombra las dos cantidades, los dos lotes, la merma, y dice que no
  se puede deshacer.`
- `RN §2.1: el error del backend queda DENTRO del diálogo.`
- Sin conversiones para el producto origen, estado vacío con la salida correcta.
- Sin `manage_products`, el atajo de crear derivado no se renderiza.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Precargar cantidadObtenida con el teórico. Ni al inicio, ni al cambiar de destino, ni con
  un botón. Es LA regla de esta pantalla.
- Reimplementar el cálculo de merma del backend como regla propia: mostrás el mismo número,
  el que manda es el servidor.
- Ofrecer "deshacer" un fraccionamiento.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: fraccionar una bolsa en unidades sueltas con una cantidad obtenida MENOR al
   teórico, y verificar la merma en el historial y la cadena en la trazabilidad del lote.
5. Un commit: `feat(comercial-fe): fraccionamiento de lotes [F6·T1]`
`````

---

## F7 · TANDA 1 — Widget de consumo clínico en la historia

`prompts_frontend/F7_T1_consumo_clinico.md`

`````markdown
# F7 · TANDA 1 — Widget de consumo clínico en la historia
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.
> **Es la tanda que toca la frontera con el módulo clínico.** La dependencia va en una sola
> dirección: el movimiento de stock apunta al evento clínico, nunca al revés (§10.3 de la
> spec comercial). Esta tanda **no modifica la lógica de historial ni de vacunación**: agrega
> un widget que llama a `/consumos`.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.7, §2.2, §2.4 | Superficie de consumo, FEFO, costo. |
| `supabase/functions/api/src/modules/consumo/consumo.schemas.ts` | `RegistrarConsumoSchema` y su forma de ítem. |
| `supabase/functions/api/src/modules/consumo/consumo.controller.ts` | Los tres endpoints y sus permisos. |
| `web/src/pages/HistorialClinicoPage.tsx` | Dónde se engancha el widget. **Leelo para saber qué NO tocar.** |
| `web/src/pages/MostradorPage.tsx` (F4·T2) | El selector de lote con FEFO: se reusa el mismo patrón. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
FRONTERA CLÍNICA — esta tanda NO cambia la lógica de web/src/pages/HistorialClinicoPage.tsx
  ni de los componentes de vacunación. Solo agrega el widget y su punto de montaje.
TENANT — el frontend NUNCA manda tenant_id. El schema del backend es strict y el tenantId
  del body se ignora igual: no lo mandes.
PERMISOS — registrar consumo exige consume_stock (SOLO admin y veterinario; la
  recepcionista NO lo tiene). Ver el consumo exige view_stock.
FEFO — §2.2: mismo comportamiento que el mostrador. Lote sugerido marcado; elegir otro exige
  motivo en el MISMO formulario.
COSTO — el widget NO muestra costo. Es una consulta clínica, con el tutor presente.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/components/historial/ConsumoInsumosWidget.tsx`, montado dentro del detalle de un
evento de `web/src/pages/HistorialClinicoPage.tsx`.

**Sin `consume_stock`, el widget no se renderiza** — pero **con `view_stock` sí se muestra en
modo lectura**: el veterinario que registró y la recepcionista que consulta necesitan ver qué
se usó, aunque solo el primero pueda registrarlo.

### 1.1 — Modo lectura

`GET /consumos/evento/:historialId`. Lista de lo ya consumido en ese evento: producto,
cantidad, lote, y si hubo `motivoFefo`, **mostralo**.

Si no hay consumos, estado vacío: *"No se registraron insumos en esta atención."* Con
`consume_stock`, un botón "Registrar insumos".

### 1.2 — Registrar insumos

`POST /consumos` con `{ historialId, items[], planVacunacionId?, recetaId?,
profesionalPrescriptorId? }`.

Formulario, en `Sheet` o inline expandible:

- **Buscador de producto**, acotado a los consumibles clínicos:
  `GET /productos?search=&activo=true`. Filtrá en el cliente por `esConsumibleClinico`
  (la API no tiene ese filtro; con la página traída alcanza y **no** hay que inventar el
  parámetro).
- Por ítem: `cantidad`, y el **selector de lote con FEFO**.
- **Disponibilidad:** `GET /consumos/disponibilidad?productoId=` antes de agregar, para
  mostrar cuánto hay. Si es 0, el producto se marca sin stock.

### 1.3 — FEFO en el widget (§2.2) — idéntico al mostrador

`GET /lotes/candidatos?productoId=&cantidad=`:

- El primer lote viene **preseleccionado y marcado "Sugerido (vence antes)"**, con
  vencimiento y existencia.
- Elegir otro hace aparecer **`motivoFefo` en el mismo ítem**, y lo vuelve **requerido**.
- Sin motivo, no se puede registrar.
- Cambiar la cantidad vuelve a pedir candidatos.

**Reusá el componente de selección de lote de F4·T2.** Si en F4·T2 quedó acoplado a la página,
extraelo a `web/src/components/comercial/SelectorLoteFefo.tsx` y usalo en los dos lados. Es la
única refactorización que esta tanda tiene permitido hacer sobre F4.

### 1.4 — Campos opcionales de contexto

- `profesionalPrescriptorId`: precargado con el profesional del evento si está disponible,
  editable.
- `planVacunacionId`: si el evento está ligado a una dosis del plan, precargalo.
- `recetaId`: si el sistema no lo tiene resuelto en esta pantalla, **no lo inventes**: mandalo
  como `null`. No agregues un buscador de recetas que la API no necesita.

### 1.5 — Confirmación

Registrar consumo **descuenta stock**, así que va con confirmación, aunque es menos grave que
las de §2.1 (no hay endpoint para revertirlo desde acá):

> *"Se descuentan {N} unidades de {M} lotes y quedan registradas en esta atención. El
> movimiento queda asentado en el libro de stock."*

Errores por `code`: `INSUFFICIENT_STOCK`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`. **El
formulario no se limpia ante un error.**

## 2. Tests obligatorios

`ConsumoInsumosWidget.test.tsx`:
- Sin `view_stock`, el widget no se renderiza.
- Con `view_stock` y sin `consume_stock`, se renderiza en modo lectura sin botón de registrar.
- Modo lectura muestra los consumos y el `motivoFefo` cuando lo hay.
- **`RN §2.2: el primer lote candidato viene preseleccionado y marcado como sugerido.`**
- **`RN §2.2: elegir otro lote muestra motivoFefo EN EL MISMO ÍTEM y lo vuelve requerido.`**
- **`RN §2.2: sin motivo, el botón de registrar queda deshabilitado.`**
- El buscador acota a `esConsumibleClinico` en el cliente, sin mandar un filtro inventado.
- La disponibilidad en 0 marca el producto sin stock.
- **El body NO lleva `tenantId`.**
- `§2.4: el widget no muestra costo en ninguna parte.`
- Cada `code` de error produce su mensaje y el formulario no se limpia.

## 3. Prohibido

```
- Modificar la lógica de HistorialClinicoPage, de los componentes de vacunación, o de
  cualquier archivo de modules/historial o modules/vacunacion.
- Inventar el query param esConsumibleClinico: la API no lo tiene. Se filtra en el cliente.
- Agregar un buscador de recetas.
- Mostrar costo.
- Pedir el motivo FEFO en un paso posterior.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: en una atención real, registrar dos insumos (uno con lote no sugerido + motivo)
   y verificar el descuento en el kardex de los lotes.
5. Un commit: `feat(comercial-fe): widget de consumo clínico en la historia [F7·T1]`
`````

---

## F8 · TANDA 1 — Reportes de stock

`prompts_frontend/F8_T1_reportes_stock.md`

`````markdown
# F8 · TANDA 1 — Reportes de stock
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.8, §2.4 | Los cinco reportes de stock y sus filtros. |
| `supabase/functions/api/src/modules/reportes/reportes.schemas.ts` | Los query params exactos de cada uno. |
| `supabase/functions/api/src/modules/reportes/reportes.service.ts` | La forma de cada respuesta. **Derivá los tipos de acá.** |
| `web/src/components/ui/chart.tsx` | El componente de gráficos del kit, si lo usás. |
| `web/src/lib/fechas.ts` | Helpers de fecha. Usá estos. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Los cinco reportes son GET, sin paginación y sin
  export. Si falta un filtro: PARÁS Y REPORTÁS, no lo agregues.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — los cinco exigen módulo stock + view_stock.
COSTO — estos reportes SON de costo y valorización: mostrarlo acá es correcto. El margen no
  está en estos cinco (está en los de ventas, F8·T2, detrás de view_sales).
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error en CADA reporte por separado.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/ReportesStockPage.tsx` en `/stock/reportes` (`view_stock`), con **una pestaña
por reporte**. Cada pestaña carga **solo cuando se abre** (no cinco fetch al montar).

### 1.1 — Valorización a fecha

`GET /reportes/valorizacion-fecha` (`fechaCorte`, `productoId`, `familiaId`).
Filtros: date picker de corte (por defecto hoy), Select de familia, buscador de producto.
Tabla por producto con cantidad, costo unitario y valorizado. Total arriba, en una tarjeta.

### 1.2 — Rotación

`GET /reportes/rotacion` (`diasSinMovimiento` — **default 30**, `desde`, `hasta`, `familiaId`).
Input numérico para los días (mínimo 1), rango de fechas, Select de familia.
Tabla ordenada por días sin movimiento, descendente: lo que no se mueve primero, que es el
punto del reporte. Badge ámbar para lo que supera el umbral.

### 1.3 — Costo de fraccionamiento

`GET /reportes/fraccionamiento` (`desde`, `hasta`, `productoOrigenId`, `productoDestinoId`).
Tabla con origen, destino, cantidades, **merma** y su costo. Destacá la merma acumulada del
período en una tarjeta: es el número que justifica la pantalla.

### 1.4 — Consumo por profesional

`GET /reportes/consumo-profesional` (`desde`, `hasta`, `profesionalId`).
Tabla por profesional con cantidad de consumos y costo total. Select de profesional
alimentado con `GET /doctores`.

### 1.5 — Consumo por especie

`GET /reportes/consumo-especie` (`desde`, `hasta`, `especieId`).
El Select de especies se lee por **PostgREST directo** con el `listarEspecies()` que ya existe
en `web/src/api/catalogos.ts` — no inventes un endpoint.

### 1.6 — Export

**No hay endpoint de export.** Si querés ofrecer CSV, armalo **en el cliente** con los datos
ya traídos y bajalo con un `Blob`. No llames a `apiClientBlob` contra estos reportes: no
devuelven binario.

## 2. Tests obligatorios

`ReportesStockPage.test.tsx`:
- Cada pestaña tiene sus estados vacío, cargando y error, **por separado**.
- **Abrir la página carga UN solo reporte, no cinco.**
- Cada reporte manda **exactamente** los query params de su schema, y los `undefined` no
  aparecen en la URL.
- `diasSinMovimiento` arranca en 30.
- El Select de especies sale de PostgREST, no de un endpoint inventado.
- Si el CSV está implementado, se arma en el cliente sin llamar a la API.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Inventar filtros o paginación que estos endpoints no tienen.
- Cargar los cinco reportes al montar la página.
- Llamar a un endpoint de export que no existe.
- Mostrar margen acá (está en F8·T2, detrás de view_sales).
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Los cinco reportes devuelven datos contra el tenant de prueba (con lo cargado en F2 y F6).
5. Un commit: `feat(comercial-fe): reportes de stock e inventario [F8·T1]`
`````

---

## F8 · TANDA 2 — Reportes de ventas y finanzas

`prompts_frontend/F8_T2_reportes_ventas.md`

`````markdown
# F8 · TANDA 2 — Reportes de ventas y finanzas
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F4·T3 en verde (sin ventas registradas no hay nada que reportar).
> **Última tanda del plan.**

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.5, §1.8, §2.4 | Los reportes, y la regla de costo y margen. |
| `supabase/functions/api/src/modules/reportes/reportes.schemas.ts` | Los query params exactos. |
| `supabase/functions/api/src/modules/ventas/ventas.schemas.ts` | `ReporteMargenQuerySchema`, `ReporteItemsVendidosQuerySchema`. |
| `supabase/functions/api/src/modules/reportes/reportes.service.ts` | La forma de cada respuesta. |
| `web/src/pages/ReportesStockPage.tsx` (F8·T1) | El molde de pestañas con carga diferida. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. GET sin paginación y sin export. Si falta un
  filtro: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — los cuatro reportes de /reportes exigen módulo ventas + view_sales. Los dos de
  /ventas/reportes exigen manage_sales + view_sales. La recepcionista NO tiene view_sales:
  la ruta /ventas/reportes ya está gateada en F1·T1 y no le aparece.
MARGEN — es exactamente lo que view_sales protege. Se muestra acá sin reparos.
COPY — "Operación N°". Nunca "Comprobante", "Factura", "Ticket" ni "Recibo".
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/ReportesVentasPage.tsx` en `/ventas/reportes` (`view_sales`), con **una
pestaña por reporte** y carga diferida (igual que F8·T1).

### 1.1 — Rentabilidad

`GET /reportes/rentabilidad` (`desde`, `hasta`, `familiaId`, `productoId`).
Tabla por producto: unidades vendidas, ingreso, costo, **margen** absoluto y porcentual.
Ordenable por margen. Tarjeta arriba con el margen total del período.

### 1.2 — Ventas por usuario

`GET /reportes/ventas-usuario` (`desde`, `hasta`, `usuarioId`).
Tabla por vendedor: cantidad de operaciones y total vendido. Select de usuario desde
`GET /usuarios`.

### 1.3 — Ventas por sesión de caja

`GET /reportes/ventas-sesion` (`desde`, `hasta`, `cajaId`, `sesionId`).
Tabla por sesión: caja, apertura, cierre, cantidad de operaciones, total.
Link de cada fila al arqueo de esa sesión (`/ventas/caja/:sesionId`, F3·T2).
Select de caja desde `GET /caja/cajas` — **ojo: ese endpoint exige `manage_cash`**, que un
usuario con `view_sales` puede no tener. Si la llamada da 403, degradá a un input de texto
libre o escondé el filtro; **no rompas la pantalla**.

### 1.4 — Ventas por medio de pago

`GET /reportes/ventas-medio-pago` (`desde`, `hasta`, `medioPagoId`).
Tabla por medio: cantidad de pagos y total. El Select sale de `listarMediosPago()`
(PostgREST, F1·T1). Un gráfico de torta acá se justifica: la distribución por medio de pago
es exactamente una composición del total.

### 1.5 — Margen por ítem e ítems vendidos

Los dos endpoints que viven bajo `/ventas`, no bajo `/reportes`:

- `GET /ventas/reportes/margen` (`itemId`, `tipoItem`, `desde`, `hasta`)
- `GET /ventas/reportes/items-vendidos` (`itemId`, `tipoItem`, `desde`, `hasta`)

`tipoItem` es un Select con `producto` / `servicio`. Dos pestañas más, o una sola con un
toggle: elegí una y sé consistente con el resto de la página.

### 1.6 — Export

Igual que F8·T1: **no hay endpoint**. Si ofrecés CSV, se arma en el cliente con los datos ya
traídos.

## 2. Tests obligatorios

`ReportesVentasPage.test.tsx`:
- Cada pestaña tiene sus estados vacío, cargando y error, por separado.
- **Abrir la página carga UN solo reporte.**
- Cada reporte manda exactamente los query params de su schema; los `undefined` no van.
- **`§1.3: si GET /caja/cajas devuelve 403, la pestaña de ventas por sesión sigue funcionando
  sin ese filtro.`**
- El Select de medios de pago sale de PostgREST.
- `§2.6: no aparece "Comprobante", "Factura", "Ticket" ni "Recibo" en ninguna columna ni
  encabezado.`
- El margen se muestra (esta ruta ya exige `view_sales`).
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Inventar filtros, paginación o export que estos endpoints no tienen.
- Cargar todos los reportes al montar.
- Dejar que el 403 de /caja/cajas rompa la pantalla.
- Las palabras prohibidas de §2.6.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Los seis reportes devuelven datos contra el tenant de prueba, con las ventas de F4.
5. Un commit: `feat(comercial-fe): reportes de ventas y finanzas [F8·T2]`
6. **Cierre del plan:** con esta tanda quedan las 18 de frontend. Repasá contra
   `PLAN_FRONTEND_COMERCIAL.md` §3 que ninguna quedó abierta, y contra §7 qué preguntas
   siguen sin responder.
`````

---

## Reglas transversales (referencia)

Están incrustadas en cada prompt. El archivo
[`prompts_frontend/_REGLAS_TRANSVERSALES.md`](prompts_frontend/_REGLAS_TRANSVERSALES.md) las
tiene en un solo lugar, para poder corregirlas de una vez y volver a propagarlas.

## Preguntas que siguen abiertas

Al cierre del plan quedan tres, detalladas en `PLAN_FRONTEND_COMERCIAL.md` §7:

- **P-06** — quién carga la lista real de precios y cuándo. Es trabajo del dueño de la
  clínica, no del sistema; sin una respuesta con fecha, el mostrador no entra en producción.
- **P-09** — cuántos productos derivados va a haber. Decide si los favoritos en
  `localStorage` alcanzan o si hacen falta favoritos compartidos por la clínica, que **sí**
  serían backend nuevo.
- **Costo y margen** — si el problema es que el cliente lo vea por encima del hombro (lo
  resuelve la decisión de UI de §2.4) o que el empleado no deba conocerlo (no lo resuelve, y
  haría falta un permiso `view_cost` que hoy no existe).
