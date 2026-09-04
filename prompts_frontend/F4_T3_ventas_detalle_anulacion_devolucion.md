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
