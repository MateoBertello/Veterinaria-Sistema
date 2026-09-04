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
