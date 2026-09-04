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
