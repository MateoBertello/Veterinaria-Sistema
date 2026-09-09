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
