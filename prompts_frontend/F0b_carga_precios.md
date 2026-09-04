# TANDA 0b — Carga asistida de precios *(la tanda cero)*
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** B0 en verde (sin ella no se pueden cargar precios de servicios) y F1·T1
> en verde (esta pantalla usa su capa de datos).
> **Es la tanda de mayor prioridad del plan.** Hoy no hay un solo precio cargado:
> `productos.precio_venta` existe desde C1 y `servicios.precio` desde C4·T1, y **los dos
> están vacíos**. Sin precios, `POST /ventas` devuelve `PRODUCT_WITHOUT_PRICE` en cada línea
> y el mostrador no sirve para nada.

> **Lo que esta pantalla NO hace:** inventar precios. No los deriva del costo, no los estima,
> no los siembra con datos de ejemplo. **Cargar la lista real es trabajo del dueño de la
> clínica, no del sistema** (P-06). Esta tanda entrega la herramienta para que lo haga en una
> sola sesión de trabajo en vez de entrar producto por producto.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §0.3, §2.5, §4.6, §7 (P-06) | El alcance y por qué el precio es con IVA incluido. |
| `web/src/api/comercial/productos.ts` (de F1·T1) | `listar` y `actualizar`. |
| `web/src/api/catalogos-comercial.ts` (de F1·T1) | `listarServiciosVendibles`, `listarUnidadesMedida`. |
| `web/src/api/servicios.ts` | El `actualizar` de servicios, al que B0 le agregó `precio` y `alicuotaIva`. |
| `web/src/pages/CatalogosPage.tsx` | El patrón de tabla + filtros + debounce + paginación. |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `ALICUOTAS_IVA`: 0, 10.5, 21, 27. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No hay endpoint de carga masiva y no se crea:
  la pantalla hace N PUT secuenciales. Si algo más falta: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PRECIO — el precio que se carga es el PRECIO FINAL CON IVA INCLUIDO (el de góndola).
  La RPC calcula el neto por división y el IVA por diferencia (RN-VT1). El label del campo
  lo dice explícitamente.
ENVELOPE — errores como ApiError con .code.
RENDIMIENTO — un fetch por listado.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

Pantalla `web/src/pages/CargaPreciosPage.tsx` en la ruta `/stock/productos/precios`
(ya registrada en F1·T1), con permiso `manage_products`.

### 1.1 — Layout

Header de página + **dos pestañas**: **Productos** y **Servicios**. Son dos endpoints
distintos (`PUT /productos/:id` y `PUT /servicios/:id`) y dos formas distintas; una sola
tabla mezclada haría el código ambiguo.

Encima de la tabla, una **barra de filtros**: búsqueda con debounce de 300 ms, selector de
**familia** (`GET /familias-producto`, solo en la pestaña Productos) y un switch
**"Solo los que no tienen precio"** — que es el modo en que esta pantalla se usa de verdad.

### 1.2 — La tabla es editable en línea

Una fila por producto/servicio, con las columnas: código, nombre, familia, unidad,
**alícuota** (Select con 0 / 10,5 / 21 / 27) y **precio final** (Input numérico).

- El campo de precio arranca con el valor actual, o **vacío** si es `null`.
- Las filas sin precio se marcan con un badge ámbar **"Sin precio"**.
- Editar una fila la marca como **sucia** (borde naranja + badge "Sin guardar").
- **Nada se guarda al tipear.** Se guarda con el botón "Guardar cambios" de la barra
  inferior, que muestra cuántas filas hay pendientes.
- El `Select` de familia y el de alícuota se resuelven con un `Map` cargado una vez
  (`GET /familias-producto?limit=100` y `listarUnidadesMedida()`), **no con un fetch por fila**.

### 1.3 — El guardado es N PUT secuenciales, y hay que tratarlo como tal

**No hay endpoint de carga masiva** (`PLAN_FRONTEND_COMERCIAL.md` §0.1 / hallazgo #3). El
botón "Guardar cambios" recorre las filas sucias y hace un `PUT` por cada una,
**secuencialmente** (no `Promise.all`: cien PUT en paralelo contra una Edge Function es una
mala idea).

Durante el guardado:
- Barra de progreso con "Guardando N de M".
- Cada fila que vuelve OK pierde su marca de sucia y muestra un check verde por un momento.
- **Cada fila que falla se queda sucia y muestra su error** (`ApiError.message`) en la fila.
- El proceso **no se corta** ante un fallo: sigue con las siguientes.
- Al terminar, un resumen: "Se guardaron X de M. Y filas quedaron con error." Si hubo
  errores, un botón "Reintentar las que fallaron".

Esto es lo que hace la pantalla usable con doscientos productos: un fallo parcial no puede
obligar a rehacer todo.

### 1.4 — Salir con cambios sin guardar

Si hay filas sucias y el usuario navega afuera o cierra la pestaña, se advierte
(`beforeunload` + bloqueo de navegación de React Router). Perder media hora de carga por un
click al sidebar es exactamente el fracaso que esta pantalla tiene que evitar.

### 1.5 — Validación en el cliente

- Precio: número ≥ 0, hasta 2 decimales. Vacío es válido (deja el precio en `null`).
- Alícuota: solo 0, 10.5, 21, 27. El backend también lo valida (422); el cliente evita el viaje.
- Si el usuario escribe algo no numérico, la fila no se manda y se marca en rojo.

## 2. Tests obligatorios

`web/src/pages/CargaPreciosPage.test.tsx`:
- Renderiza filas con precio y sin precio, y las segundas llevan el badge "Sin precio".
- El filtro "Solo los que no tienen precio" acota el listado.
- Editar un precio marca la fila como sucia y habilita "Guardar cambios".
- **Guardar hace un PUT por fila sucia, y solo por las sucias.**
- **Fallo parcial:** con tres filas sucias y la segunda devolviendo `ApiError`, las otras dos
  se guardan igual, la que falló queda sucia con su mensaje, y el resumen dice "2 de 3".
- El precio se manda tal como se tipeó (**es el precio final con IVA incluido**; la pantalla
  no lo divide ni le suma nada).
- La alícuota fuera de {0, 10.5, 21, 27} no se puede elegir.
- La pestaña Servicios usa `PUT /servicios/:id` y manda `precio` y `alicuotaIva`.
- Ningún request contiene `tenantId`.

## 3. Prohibido en esta tanda

```
- Calcular, derivar o sugerir un precio a partir del costo, del margen objetivo o de nada.
  El precio lo pone una persona. Si la pantalla lo sugiere, alguien lo acepta.
- Sembrar precios de ejemplo fuera del seed de desarrollo.
- Guardar automáticamente al tipear (autosave). El guardado es explícito.
- Promise.all sobre los PUT.
- Tocar supabase/, ni buscar un rodeo para escribir precios por PostgREST: `productos` y
  `servicios` solo tienen policy de SELECT para el usuario; la escritura va por la API
  porque es auditable.
```

## 4. Definición de terminado

1. `npm run typecheck` en verde.
2. `cd web && npm run test:run` en verde.
3. `npm test` sin cambios.
4. Con el tenant de prueba: cargar precio a diez productos y dos servicios, recargar la
   página, y verificar que quedaron.
5. Un commit: `feat(comercial-fe): carga asistida de precios de productos y servicios [0b]`
