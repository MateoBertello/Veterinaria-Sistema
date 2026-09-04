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
