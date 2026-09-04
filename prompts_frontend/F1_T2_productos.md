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
