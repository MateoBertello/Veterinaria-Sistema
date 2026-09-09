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
