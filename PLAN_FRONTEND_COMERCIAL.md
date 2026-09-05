# PLAN_FRONTEND_COMERCIAL.md — Frontend del Módulo Comercial

**Alcance:** las pantallas del Módulo Comercial sobre el backend ya cerrado (C1–C8, 90 RN,
887 unit + 424 integración en verde).

**Fuente de verdad de la superficie disponible:** los diez controllers de
`supabase/functions/api/src/modules/{productos,proveedores,stock,compras,caja,ventas,ajustes,fraccionamiento,consumo,reportes}/`
y sus `*.schemas.ts`. **Esa superficie es CERRADA.** Ninguna tanda de este plan agrega
endpoints, toca Services ni modifica RPCs. El backend está auditado; abrirlo desde el
frontend lo desauditaría.

**Cómo se usa este plan.** Una tanda por sesión, sesión nueva por tanda, un commit por tanda.
Una tanda está terminada cuando: (a) `npm run typecheck` pasa, (b) `cd web && npm run test:run`
pasa, (c) `npm test` (unit de backend) sigue en verde, (d) el usuario revisó el diff. Las
tandas están escritas para no requerir decisiones de diseño: lo que hay que decidir ya está
decidido acá.

> **Nota sobre el orden.** La tanda cero (precios) es **primera en prioridad** —sin precios el
> mostrador no sirve para nada— pero **tercera en secuencia**, porque la pantalla de carga
> necesita la capa de datos que construye F1·T1. El orden de fases F1→F8 que pidió el dueño
> queda intacto.

---

## 0. Prerrequisitos duros

Los tres tienen que estar cumplidos antes de F1. No son notas al pie: si falta cualquiera,
las pantallas de F1 en adelante no se pueden dar por terminadas.

### 0.1 — B0: dos campos de servicio en la API (BACKEND — **no se ejecuta ahora**)

**Estado: BLOQUEADO hasta después del merge de `feat/modulo-comercial` y de la re-auditoría.**
Gemini está corrigiendo los bloques 2 y 3 sobre esa rama. B0 va después.

**El problema.** Las columnas `servicios.precio` y `servicios.alicuota_iva` existen desde
C4·T1 (`supabase/migrations/20260922000001_comercial_ventas.sql`, líneas 13–16). La RPC
`registrar_venta` las lee y aborta con `PRODUCT_WITHOUT_PRICE` si `precio IS NULL` y el ítem
no trae `precioUnitario`. Pero `servicios.schemas.ts` no las declara en `CrearServicioSchema`
ni en `ActualizarServicioSchema`, y `servicios.service.ts` no las mapea: **no se pueden
escribir ni leer por la API**.

**Por qué no alcanza el workaround.** Pasar `precioUnitario` a mano en cada venta rompe D-03:
la alícuota es atributo del producto/servicio y se copia a la línea. Un precio tipeado en el
mostrador no lleva alícuota, y el workaround no se saca nunca.

**Alcance de B0** (aditivo; no toca RPCs, ni RLS, ni migraciones):

1. `precio` y `alicuotaIva` en `CrearServicioSchema` y `ActualizarServicioSchema`.
2. El mapeo de ida y vuelta en `servicios.service.ts` (escritura + `ServicioPublico`).
3. **Smoke de camino feliz contra base real**, no un controller test con el Service mockeado
   — ver `ADENDA_SPEC_COMERCIAL.md`, sección *"Nueva — Un controller test que mockea el
   Service no prueba el endpoint"*.
4. Entrada en `tests/integration/aislamiento-api.integration.test.ts`: el caso de escritura
   de `servicios` ya existe (`editar servicio`, PUT `/servicios/:id`); hay que extenderlo para
   que el body lleve `precio`/`alicuotaIva` y siga dando 404 contra el servicio de otro tenant.
5. **Corrección del bug #5:** `productos.controller.ts` no lee `c.req.query("codigoBarras")`,
   así que el filtro existe en `ListarProductosQuerySchema` y en `ProductoService.buscarPaginado`
   y no hace nada. Es una línea. El match parcial de `search` sobre un escáner devuelve
   resultados equivocados con códigos que comparten prefijo.

> **B0.3 y B0.4 resuelven el licenciamiento en el seed.** Los dos corren contra base real y
> por lo tanto se llevan la habilitación de `stock` y `ventas` a la siembra, donde
> corresponde. Es lo que convierte a la tanda 0a de una tarea manual de consola en una simple
> verificación (§0.2).

Prompt: `prompts_frontend/B0_backend_precio_servicio.md`.

### 0.2 — 0a: verificación del tenant de prueba (sin código, sin consola)

**Ya no es un paso manual.** El licenciamiento lo resuelve el seed, por dos caminos que se
refuerzan:

- `crear_tenant` (migración `20260901000002_comercial_permisos_licenciamiento.sql`, paso 6)
  **ya inserta `stock` y `ventas` en `modulos_contratados` según el plan**: `stock` para
  `profesional` y `premium`, `ventas` solo para `premium`. Y el paso 4 de la misma migración
  hace el backfill de los tenants que ya existían.
- `scripts/seed.mjs` crea el tenant de demo con **`plan: "premium"`**, así que los cinco
  módulos vendibles quedan habilitados solos.
- B0.3 y B0.4 se apoyan en eso para su fixture, que es lo que lo deja fijado por un test en
  vez de por una convención.

Entonces 0a se reduce a **comprobar que el entorno quedó bien** antes de empezar F1. Si algo
de esto falla, el problema es del seed o del plan del tenant, no de las pantallas:

```
1. Entrar con un usuario del tenant de prueba (login normal, no /admin/login).
2. GET /api/v1/productos    → 200   (si da 403 MODULE_NOT_LICENSED, falta `stock`)
3. GET /api/v1/caja/cajas   → 200   (si da 403, falta `ventas`: son dos módulos distintos)
4. El sidebar muestra Stock y Ventas bajo *Módulos contratados*.
```

`web/src/lib/navigation.ts` y `web/src/lib/planes.ts` **ya conocen** `stock` y `ventas`, y
`buildNavItems` ya oculta el módulo no contratado (RN-G2). No se toca ninguno de los dos.

### 0.3 — 0b: los precios reales los carga el dueño

La pantalla de 0b es la **herramienta** de carga. **Cargar la lista real de precios es
trabajo del dueño de la clínica, no del sistema.** Ninguna tanda de este plan inventa
precios, ni los deriva del costo, ni los siembra con datos de ejemplo fuera del seed de
desarrollo. Ver P-06 en §7.

---

## 1. Superficie de API disponible

Todo lo que las pantallas pueden usar. Lo que no está acá, no existe para este plan.

### 1.1 — Catálogo comercial

| Endpoint | Filtros / body | Módulo | Permiso |
|---|---|---|---|
| `GET /productos` | `search`, `familiaId`, `activo`, `vendible`, `page`, `limit` | stock | `view_stock` |
| `GET /productos/:id` | — | stock | `view_stock` |
| `POST /productos` | ver `CrearProductoSchema` | stock | `manage_products` |
| `POST /productos/:id/derivado` | `CrearDerivadoSchema` | stock | `manage_products` |
| `PUT /productos/:id` | parcial de `CrearProductoSchema` | stock | `manage_products` |
| `PATCH /productos/:id/estado` | `{ activo }` | stock | `manage_products` |
| `GET /familias-producto` | `search`, `activo`, `page`, `limit` | stock | `view_stock` |
| `POST` / `PUT /:id` / `PATCH /:id/estado` | `{ nombre, unidadBaseId }` | stock | `manage_products` |
| `GET /producto-conversiones` | `productoOrigenId`, `activo`, `page`, `limit` | stock | `view_stock` |
| `POST` / `PUT /:id` / `PATCH /:id/estado` | `CrearConversionSchema` | stock | `manage_products` |
| `GET /proveedores` | `search`, `activo`, `page`, `limit` | stock | `manage_suppliers` |
| `GET /:id` / `POST` / `PUT /:id` / `PATCH /:id/estado` | `CrearProveedorSchema` | stock | `manage_suppliers` |

> **Ojo con proveedores:** el `requirePermission("manage_suppliers")` está en el middleware
> compartido del router, así que **también la lectura** lo exige. El veterinario no puede
> listar proveedores.

### 1.2 — Stock

| Endpoint | Filtros | Módulo | Permiso |
|---|---|---|---|
| `GET /lotes` | `productoId`, `estado`, `venceAntesDe`, `conExistencia`, `page`, `limit` | stock | `view_stock` |
| `GET /lotes/candidatos` | `productoId`, `cantidad` — **es el FEFO** | stock | `view_stock` |
| `GET /lotes/:id` | — | stock | `view_stock` |
| `GET /lotes/:id/kardex` | `page`, `limit` | stock | `view_stock` |
| `GET /lotes/:id/trazabilidad` | — (cadena lote↔lote) | stock | `view_stock` |
| `GET /movimientos-stock` | `loteId`, `productoId`, `tipo`, `desde`, `hasta`, `operacionId`, `page`, `limit` | stock | `view_stock` |
| `GET /existencias` | `search`, `page`, `limit` | stock | `view_stock` |
| `GET /existencias/valorizacion` | — | stock | `view_stock` |

### 1.3 — Compras

`GET /compras` (`proveedorId`, `estado`, `desde`, `hasta`, `page`, `limit`), `POST /compras`,
`GET /compras/:id`, `PUT /compras/:id`, `POST /compras/:id/items`,
`PUT /compras/:id/items/:itemId`, `DELETE /compras/:id/items/:itemId`,
`POST /compras/:id/confirmar`, `POST /compras/:id/anular` (`{ motivo }`, mínimo 10 caracteres).
Módulo `stock`, permiso `manage_suppliers` en todos.

### 1.4 — Caja (módulo `ventas`, permiso `manage_cash` en todos)

`GET /caja/cajas`, `GET /caja/sesiones` (`estado`, `desde`, `hasta`, `page`, `limit`),
`GET /caja/sesiones/actual` (`?cajaId`), `GET /caja/sesiones/:id`,
`GET /caja/sesiones/:id/resumen`, `POST /caja/sesiones` (`{ cajaId?, saldoInicial }`),
`POST /caja/sesiones/:id/movimientos` (`{ tipo, medioPagoId, importe, motivo?, referencia? }`),
`POST /caja/sesiones/:id/cerrar` (`{ efectivoContado, motivo?, observaciones? }`).

`GET /caja/sesiones/:id/resumen` devuelve exactamente lo que necesita el arqueo:
`saldoInicial`, `saldoTeoricoEfectivo`, `efectivoContado`, `diferencia` y
`totalesPorMedioPago[]` con `afectaArqueo`.

### 1.5 — Ventas (módulo `ventas`)

| Endpoint | Permiso |
|---|---|
| `GET /ventas` (`clienteId`, `sesionCajaId`, `usuarioId`, `estado`, `desde`, `hasta`, `page`, `limit`) | `manage_sales` |
| `GET /ventas/:id` | `manage_sales` |
| `POST /ventas` | `manage_sales` |
| `POST /ventas/:id/anular` (`{ sesionCajaId, motivo }`) | `manage_sales` + `void_sales` |
| `GET /ventas/reportes/margen`, `/items-vendidos` | `manage_sales` + `view_sales` |

Sin `view_sales`, el Service acota el listado y el detalle a las ventas **del propio usuario**.
No es un error: es §8.2. La pantalla no tiene que hacer nada, pero el copy del estado vacío
no puede decir "no hay ventas" cuando puede haberlas de otro cajero.

**`POST /ventas` devuelve** `{ ventaId, numeroOperacion, operacionId, subtotalNeto, totalIva,
total, saldoPendiente }` en camelCase. **`GET /ventas` y `GET /ventas/:id` devuelven la fila
cruda de PostgREST en snake_case**, con `items: ventas_items(*)` y `pagos: ventas_pagos(*)`
embebidos. Es la única inconsistencia de forma del módulo y hay que tipearla como viene, sin
"arreglarla" en el Service.

### 1.6 — Ajustes, recuentos y devoluciones

Módulo `stock` + `manage_stock`: `POST /ajustes` (`{ loteId, tipo, cantidad, motivo }`),
`POST /lotes/:id/bloquear`, `POST /lotes/:id/desbloquear`, `POST /recuentos`, `GET /recuentos`
(`estado`, `page`, `limit`), `GET /recuentos/:id`, `PUT /recuentos/:id/detalles`,
`POST /recuentos/:id/aplicar` (`{ confirmarDesvios }`), `DELETE /recuentos/:id`.

Módulo `ventas` + `manage_sales`: `POST /devoluciones`
(`{ ventaId, items:[{ ventaItemId, cantidad, revendible }], motivo, reintegraEfectivo, sesionCajaId? }`).

### 1.7 — Fraccionamiento y consumo clínico (módulo `stock`)

`POST /fraccionamiento` (`split_stock`), `GET /fraccionamiento/sugerir-vencimiento`
(`view_stock`), `GET /fraccionamiento/historial` (`view_stock`).
`POST /consumos` (`consume_stock`), `GET /consumos/evento/:historialId` (`view_stock`),
`GET /consumos/disponibilidad?productoId=` (`view_stock`).

### 1.8 — Reportes

`stock` + `view_stock`: `/reportes/valorizacion-fecha`, `/rotacion`, `/fraccionamiento`,
`/consumo-profesional`, `/consumo-especie`.
`ventas` + `view_sales`: `/reportes/rentabilidad`, `/ventas-usuario`, `/ventas-sesion`,
`/ventas-medio-pago`.
Todos son GET, sin paginación y sin export. El CSV, si se quiere, se arma en el cliente.

### 1.9 — Lo que se lee por PostgREST directo (no por la API)

`medios_pago` y `unidades_medida` **no tienen endpoint, y no lo necesitan.** Son catálogos
**globales** (sin `tenant_id`), con policy `FOR SELECT USING (auth.uid() IS NOT NULL)` y sin
REVOKE posterior: se leen con el JWT del usuario, igual que `permisos` y los catálogos
clínicos. Es la excepción ya documentada en `CLAUDE.md`.

Es **imprescindible**: todo `medioPagoId` y `unidadMedidaId` de la API es un UUID que el
frontend tiene que poder resolver a un nombre, y el mostrador no puede dibujar los botones de
cobro sin la lista de medios de pago.

`servicios` también se lee por PostgREST (policy `tenant_id = current_tenant_id() AND
usuario_activo()`), que es de dónde sale `precio` para el mostrador. **Escribirlo va por la
API** (escritura auditable), y por eso B0 es prerrequisito.

El patrón exacto —proxy vs. modo directo, cache de lectura, invalidación— ya está escrito en
`web/src/api/catalogos.ts`. Se copia de ahí; no se inventa uno nuevo.

### 1.10 — Permisos por rol (define qué se ve y qué no)

| Rol | Permisos comerciales |
|---|---|
| **admin** | los diez |
| **veterinario** | `view_stock`, `split_stock`, `consume_stock`, `manage_sales` |
| **recepcionista** | `view_stock`, `split_stock`, `manage_suppliers`, `manage_sales`, `manage_cash` |

Consecuencias que la UI tiene que respetar: el veterinario **no** tiene `manage_cash` (no abre
caja), **ni** `manage_suppliers` (no ve proveedores ni compras). La recepcionista **no** tiene
`manage_products` (no crea productos), **ni** `manage_stock` (no ajusta ni hace recuentos),
**ni** `consume_stock`, **ni** `view_sales`, **ni** `void_sales` (no anula ventas).

---

## 2. Reglas de UI que son reglas de negocio

No son sugerencias de diseño. Cada tanda que toca una de estas la cita en su test.

### 2.1 — Operaciones irreversibles

Cerrar caja, aplicar recuento, fraccionar, anular venta y confirmar compra van con
`AlertDialog` (el kit ya lo usa para destructivo) y **la confirmación dice qué queda
registrado y que no hay vuelta atrás**. Un "¿estás seguro?" genérico no cumple. El texto
nombra el efecto concreto:

- **Cerrar caja:** "Se registra el arqueo con una diferencia de $X. La sesión queda cerrada y
  no se puede reabrir."
- **Aplicar recuento:** "Se generan N movimientos de ajuste sobre M lotes. El recuento queda
  aplicado y no se puede deshacer."
- **Fraccionar:** "Se descuentan X del lote origen y se crea el lote destino con Y unidades.
  No se puede revertir."
- **Anular venta:** "La venta queda anulada, se reintegra el stock y se registra el egreso en
  la caja abierta. No se puede deshacer."

El error del backend se muestra **dentro del diálogo, sin cerrarlo** — el patrón de
`DesactivarCatalogoDialog.tsx`. Cerrar y tirar un toast deja al usuario sin saber qué falló.

### 2.2 — FEFO

`GET /lotes/candidatos?productoId=&cantidad=` devuelve los lotes en orden FEFO. **El primero
viene marcado como sugerido.** Elegir otro **exige motivo en el mismo formulario** —el campo
`motivoFefo` se habilita y pasa a requerido en el acto—, nunca en un paso posterior que se
pueda saltear. Aplica en el mostrador (`items[].loteId` + `motivoFefo`) y en el consumo
clínico (mismos dos campos).

### 2.3 — Fraccionamiento: la cantidad obtenida se tipea

`cantidadObtenida` es **un campo que el usuario escribe**. La pantalla puede mostrar el
teórico (`factorTeorico × cantidadOrigen`) **como referencia visible al lado del campo**, y el
campo arranca **vacío**. Si se precarga con el teórico, la gente lo acepta y se pierde la
merma real, que es el único dato que esta pantalla existe para capturar. Cuando lo tipeado
difiere del teórico, la pantalla muestra la merma resultante antes de confirmar.

### 2.4 — Costo y margen

**El margen se gatea con `view_sales`** —existe, y excluye a la recepcionista—. **El costo no
se renderiza en el mostrador**, como decisión de UI.

Y queda escrito acá con estas palabras: **no es una barrera de seguridad.** El costo viaja en
el payload de `GET /lotes` (`costoUnitarioNeto`, `costoUnitarioEfectivo`) y de `GET /productos`
(`costoReposicion`, `margenObjetivo`), ambos bajo `view_stock`, que la recepcionista **tiene**.
Se ve en la pestaña de red. Un `view_cost` real es cambio de backend, y no se hace en este plan.

### 2.5 — Precios e IVA

**El precio con IVA incluido es lo que se muestra.** `productos.precio_venta` y
`servicios.precio` **son el precio final de góndola**: la RPC calcula el neto por división
(`precio / (1 + alicuota/100)`) y el IVA por diferencia (RN-VT1). El desglose neto/IVA es
secundario: va en el detalle de la venta, no en el botón del producto ni en el total del
carrito.

### 2.6 — "Operación N°", nunca "Comprobante" ni "Factura"

`numero_operacion` se muestra **siempre** como **"Operación N°"**. No es un comprobante
fiscal. Prohibido "Comprobante N°", "Factura N°", "Ticket N°" y "Recibo N°" en cualquier
label, columna, título de diálogo, toast o texto impreso.

### 2.7 — Sidebar

`buildNavItems` ya oculta el módulo no contratado. Ninguna tanda toca `navigation.ts` salvo
para agregar sub-rutas, y **no se agrega el patrón "módulo con candado"**: RN-G2 dice ocultar,
no deshabilitar.

### 2.8 — Estilo

`docs/GUIA_ESTILO.md` manda el lenguaje visual: header de página (h1 + ícono lucide +
`text-orange-800` + descripción), cards con `CardHeader` degradado `from-orange-50 to-white`,
tablas con header `bg-orange-50` y ocultamiento progresivo de columnas, `AlertDialog` para
destructivo / `Dialog` o `Sheet` para formularios, estados vacío/cargando/error en toda lista
y todo detalle, WCAG 2.1 AA. El kit de `web/src/components/ui/` es heredado y **no se
reescribe**. Semántica de badges: verde activo/confirmado, rojo anulado/vencido, ámbar
próximo a vencer/pendiente, gris inactivo.

---

## 3. Tandas

Orden de ejecución. Una por sesión, un commit por tanda.

| # | Tanda | Qué entrega | Depende de |
|---|---|---|---|
| — | **B0** | dos campos de servicio + fix `codigoBarras` (BACKEND, bloqueado) | merge + re-auditoría |
| — | **0a** | verificación del tenant (sin código; el seed ya licencia) | B0 |
| 1 | **F1·T1** | capa de datos comercial, tipos, rutas y gating | B0, 0a |
| 2 | **0b** | carga asistida de precios ← *la tanda cero* | F1·T1 |
| 3 | **F1·T2** | pantalla Productos | F1·T1 |
| 4 | **F1·T3** | pantallas Familias y Proveedores | F1·T1 |
| 5 | **F2·T1** | Existencias y detalle de lote (kardex, trazabilidad) | F1·T1 |
| 6 | **F2·T2** | Vencimientos próximos | F2·T1 |
| 7 | **F2·T3** | Compras: borrador, ítems y recepción | F1·T3 |
| 8 | **F3·T1** | Caja: apertura y movimientos | F1·T1 |
| 9 | **F3·T2** | Arqueo de cierre | F3·T1 |
| 10 | **F4·T1** | Mostrador: buscador por familia, favoritos y carrito | 0b, F3·T1 |
| 11 | **F4·T2** | Mostrador: FEFO, cobro y cierre de venta | F4·T1 |
| 12 | **F4·T3** | Ventas: listado, detalle, anulación y devolución | F4·T2 |
| 13 | **F5·T1** | Ajustes y bloqueo de lotes | F2·T1 |
| 14 | **F5·T2** | Recuentos | F5·T1 |
| 15 | **F6·T1** | Fraccionamiento | F2·T1 |
| 16 | **F7·T1** | Widget de consumo clínico en la historia | F2·T1 |
| 17 | **F8·T1** | Reportes de stock | F2·T1 |
| 18 | **F8·T2** | Reportes de ventas | F4·T3 |

### Dos desvíos del orden pedido, con su razón

**La devolución va en F4·T3, no en F5.** El backend la ubicó en C5 junto a ajustes y
recuentos, pero la devolución necesita `ventaItemId`, que solo sale de `GET /ventas/:id`. La
pantalla natural es el detalle de la venta. Ponerla en F5 obligaría a construir un buscador de
ventas dentro de la pantalla de ajustes, que ya existe en F4·T3.

**F1·T1 va antes que 0b.** La carga de precios es la prioridad número uno, pero es una
pantalla, y toda pantalla necesita la capa de datos. F1·T1 no dibuja nada: es el cliente HTTP
tipado, los tipos y las rutas. Es la dependencia más chica posible para poder hacer 0b segundo.

### Rutas nuevas

`/stock` (índice del módulo stock, con tabs), `/stock/productos`, `/stock/productos/precios`,
`/stock/familias`, `/stock/proveedores`, `/stock/existencias`, `/stock/lotes/:id`,
`/stock/vencimientos`, `/stock/compras`, `/stock/compras/:id`, `/stock/ajustes`,
`/stock/recuentos`, `/stock/recuentos/:id`, `/stock/fraccionamiento`, `/stock/reportes`,
`/ventas` (mostrador), `/ventas/historial`, `/ventas/:id`, `/ventas/caja`,
`/ventas/caja/:sesionId`, `/ventas/reportes`.

Cada ruta va envuelta en el guard de módulo + `RequirePermission` que le corresponde según
§1.10. El widget de F7 no tiene ruta: vive dentro de `/historial/:mascotaId`.

---

## 4. Hallazgos de backend — anotados, NO se corrigen en este plan

Ninguno entra en B0. Las pantallas se diseñan asumiendo lo que la API da hoy.

### 4.1 — `GET /existencias` no agrega por producto

`existencias_lote` tiene PK por `lote_id`, y `StockService.existenciaPorProducto`
(`stock.service.ts:282`) selecciona `producto_id, cantidad` **sin GROUP BY**. Un producto con
tres lotes devuelve **tres filas**. El endpoint se llama "existencia por producto" y devuelve
existencia por lote.

### 4.2 — La paginación de `/existencias` no es confiable

Consecuencia directa de 4.1: `meta.total` cuenta **lotes**, no productos, así que el total y
la cantidad de páginas que informa la API **no corresponden a lo que la pantalla muestra**.

**Cómo lo trata F2·T1:** pide con `limit` alto, agrega por `productoId` en el cliente, y
**pagina del lado del cliente** sobre el resultado agregado. No muestra el `total` de la API.
Queda un comentario en el código apuntando a esta sección.

### 4.3 — `conExistencia` filtra después de paginar

En `StockService.listarLotes` (`stock.service.ts:158`), `conExistencia` se aplica como filtro
en memoria **sobre la página ya traída**. La página vuelve con menos ítems que `limit` y
`total` incluye los descartados.

**Es un bug de paginación con la misma forma que tenía el filtro de tenant: la respuesta
miente sin dar error.** No rompe, no tira 500, no aparece en ningún test — simplemente informa
un total que no es. F2·T1 y F5·T2 no usan el `total` de este endpoint.

### 4.4 — Cuatro métodos de Service sin ruta HTTP

Existen y no se pueden llamar desde ningún lado:

| Método | Qué haría |
|---|---|
| `ConsumoService.mascotasDeLote` | **El recall de un lote.** Si mañana hay que saber a qué animales se les aplicó algo de un lote fallado, es esta consulta y no hay otra. |
| `ConsumoService.lotesDeMascota` | Qué lotes recibió una mascota. |
| `ConsumoService.costoPorAtencion` | Costo de insumos por atención. |
| `ConsumoService.consumosPendientesDeRegularizar` | Atenciones sin consumo registrado. |

Además, la vista `v_stock_familia_unidad_base` no la consume nadie.

**No se planifican pantallas para ninguno.** Quedan anotados porque el día que se pidan, el
trabajo es exponerlos, no escribirlos.

### 4.5 — El umbral de vencimiento lo elige la pantalla, y no debería

`configuracion_tenant.dias_alerta_vencimiento` existe y `StockService.notificarLotesPorVencer`
la usa. **La API de configuración no la expone**: `ConfiguracionPublica` solo tiene
`cupoMaximoDiario`, `diasAvisoVacuna` y `parametrosExtra`.

**La config del tenant es la fuente correcta del umbral. La pantalla la está sustituyendo**
con un selector de rango (30 / 60 / 90 días, por defecto 60, que es el default del Service).
Está bien por ahora; queda escrito que es un reemplazo, no el diseño.

### 4.6 — `GET /productos` no trae stock, ni nombre de familia, ni de unidad

`ProductoPublico` devuelve `familiaId` y `unidadMedidaId` crudos, sin embed. No es un problema:
familias y unidades son listas chicas que la pantalla resuelve con un mapa en memoria (una
consulta cada una, no una por fila).

Lo que sí cambia el diseño: **el mostrador no puede mostrar existencia en la lista de
resultados sin caer en N+1.** Por eso F4·T1 **no lleva columna de stock en el buscador**; la
disponibilidad se consulta al seleccionar el ítem, con `GET /lotes/candidatos`.

---

## 5. Convenciones de las tandas de frontend

- **`web/src/api/comercial/*.ts`** para lo que va por la API (`apiClient` / `apiClientList`),
  **`web/src/api/catalogos-comercial.ts`** para lo que va por PostgREST. Separados a propósito:
  son dos caminos de seguridad distintos y mezclarlos hace que nadie sepa cuál está mirando.
- **DTOs en camelCase**, salvo `GET /ventas` y `GET /ventas/:id`, que llegan en snake_case
  (§1.5). Se tipea como llega y se convierte en el módulo de API, en un solo lugar.
- Estados **vacío / cargando / error** en toda lista y todo detalle. `Skeleton` para cargando,
  `role="alert"` para error.
- **Un fetch por listado.** Nada de una request por fila. Si hace falta el nombre de una
  familia o una unidad, se carga el catálogo entero una vez y se resuelve con un `Map`.
- Los errores se muestran con el `code` del envelope, no con el status. `ApiError` ya lo trae.
- Tests con Vitest + Testing Library, junto al componente (`Xxx.test.tsx`), como el resto del
  repo. Cada test que cubre una regla de §2 la cita en el `it()`.

---

## 6. Definición de terminado (por tanda)

1. `npm run typecheck` en verde.
2. `cd web && npm run test:run` en verde, con los tests nuevos de la tanda.
3. `npm test` (unit de backend) sin cambios — ninguna tanda de frontend lo toca.
4. Las reglas de §2 que la tanda toca tienen test que las cita.
5. Diff revisado por el dueño.
6. Un commit, con el formato del repo: `feat(comercial-fe): <qué> [F<n>·T<n>]`.

---

## 7. Preguntas abiertas

**P-06 — ¿Quién carga la lista real de precios, y cuándo?**
La pantalla de 0b es la herramienta; **la lista es trabajo del dueño de la clínica, no del
sistema.** Sin una respuesta a esto con fecha, F4 se puede construir y demostrar pero el
mostrador no entra en producción: un catálogo sin precios devuelve `PRODUCT_WITHOUT_PRICE` en
cada venta. La pregunta concreta: ¿la carga es una sesión de trabajo del dueño con la
pantalla, o hay una lista en papel/Excel que alguien tiene que transcribir? En el segundo
caso, ¿cuántos ítems?

**P-09 — ¿Cuántos productos derivados va a haber realmente?**
No cambia el modelo, cambia la UI. Este plan asume **que sí van a ser cientos**: el buscador
del mostrador lleva búsqueda por familia y favoritos **desde F4**, no desde F8. La búsqueda
por familia sale gratis (`GET /productos?familiaId=` ya existe); **los favoritos no tienen
backend y van en `localStorage` por usuario**. Si resulta que son 80 fichas y no 400, sacar
los favoritos es barato. Si son 400 y además hacen falta favoritos compartidos por la clínica,
`localStorage` no alcanza y eso **sí** es backend nuevo.

**Costo y margen — ¿hace falta un `view_cost` de verdad?**
La decisión tomada está en §2.4: margen detrás de `view_sales`, costo no renderizado en el
mostrador **como decisión de UI, que no es una barrera de seguridad** —el costo viaja en el
payload y se ve en la pestaña de red—. Un `view_cost` real es cambio de backend. La pregunta
que decide si hace falta: ¿el problema es que el cliente lo vea por encima del hombro (lo
resuelve la decisión de UI) o que el empleado no deba conocerlo (no lo resuelve, y hace falta
el permiso)?
