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
