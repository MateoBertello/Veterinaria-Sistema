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
