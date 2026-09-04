# F6 · TANDA 1 — Fraccionamiento
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.
> **Acá vive la regla §2.3, que es la razón de ser de esta pantalla:** la cantidad obtenida
> la TIPEA el usuario. Si la precargás con el teórico, la gente la acepta y se pierde la
> merma real, que es el único dato que esta pantalla existe para capturar.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §1.7, §2.1, §2.3 | Superficie, conversiones, irreversibles, la regla de la cantidad tipeada. |
| `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.schemas.ts` | `FraccionarLoteSchema`: los siete campos. |
| `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.calculo.ts` | Cómo se calcula el teórico y la merma. **Leelo para mostrar los mismos números, no para reimplementarlo.** |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` `CrearDerivadoSchema` | El alta de producto derivado desde plantilla. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISOS — POST /fraccionamiento exige split_stock (lo tienen admin, veterinario y
  recepcionista). Las dos lecturas (sugerir-vencimiento e historial) exigen view_stock.
  Crear un producto derivado exige manage_products, que SOLO tiene el admin.
IRREVERSIBLE — fraccionar consume el lote origen y crea uno nuevo. AlertDialog con el
  efecto nombrado (§2.1).
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/FraccionamientoPage.tsx` en `/stock/fraccionamiento` (`split_stock`).

### 1.1 — Elegir origen y destino

1. **Producto origen** → buscador. Luego **lote origen**:
   `GET /lotes?productoId=&conExistencia=true` (trampa §4.3: no uses `meta.total`).
   Mostrá existencia y vencimiento de cada lote.
2. **Producto destino**: `GET /producto-conversiones?productoOrigenId=&activo=true` da las
   conversiones definidas, cada una con su `factorTeorico` y su `mermaEsperadaPorcentaje`.
   Si no hay ninguna, mostrá el estado vacío con un link a crear una (F1·T2 / catálogo), o
   —si la sesión tiene `manage_products`— el atajo de `POST /productos/:id/derivado`, que crea
   el producto derivado y su conversión de una vez.

### 1.2 — El formulario (§2.3 — el corazón de la tanda)

Cuatro campos:

- **`cantidadOrigen`** — cuánto se toma del lote. Número positivo, acotado a la existencia.
- **`cantidadObtenida`** — **EL CAMPO QUE EL USUARIO TIPEA. ARRANCA VACÍO.**
- **`codigoLoteDestino`** — requerido, 1–50 caracteres. Podés sugerir un patrón
  (`{loteOrigen}-F1`) **en el placeholder**, no como valor.
- **`fechaVencimientoDestino`** — precargado con lo que devuelve
  `GET /fraccionamiento/sugerir-vencimiento?loteOrigenId=&productoDestinoId=` **y editable**.
  Este sí se precarga: es un cálculo del backend sobre la vida útil post-apertura, no una
  observación de la realidad.
- **`motivo`** — opcional.

**Al lado del campo de cantidad obtenida, y no dentro de él**, mostrá permanentemente:

```
Teórico: {cantidadOrigen × factorTeorico} {unidad destino}
Merma esperada: {mermaEsperadaPorcentaje}%
```

Y apenas el usuario tipea algo, debajo:

```
Merma real: {teórico − obtenido} {unidad} ({porcentaje}%)
```

Con color: verde/neutro si está dentro de la merma esperada, ámbar si la supera, rojo si el
obtenido supera al teórico (que es posible y hay que poder registrarlo, pero merece que se vea).

**Nunca escribas el teórico dentro del input.** Ni al cargar, ni al cambiar el producto
destino, ni con un botón "usar el teórico". El número tiene que salir de mirar la balanza.

### 1.3 — Confirmar (§2.1)

`POST /fraccionamiento`. `AlertDialog`:

> **"Fraccionar el lote"**
> *"Se descuentan {cantidadOrigen} {unidad origen} del lote {código origen} y se crea el lote
> {código destino} con {cantidadObtenida} {unidad destino}. La merma de {X} queda registrada
> como tal. Los movimientos quedan asentados en el libro de stock y **no se pueden deshacer**."*

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

Después del éxito: panel con el lote nuevo creado y link a `/stock/lotes/:id`, donde la
trazabilidad (F2·T1) ya muestra la cadena padre → hijo.

### 1.4 — Historial

`GET /fraccionamiento/historial` (`productoOrigenId`, `productoDestinoId`, `page`, `limit`) en
una tabla debajo o en una pestaña: fecha, lote origen, lote destino, cantidad origen,
cantidad obtenida, **merma**, quién lo hizo.

## 2. Tests obligatorios

`FraccionamientoPage.test.tsx`:
- **`RN §2.3: el campo cantidadObtenida arranca VACÍO.`**
- **`RN §2.3: cambiar el producto destino o la cantidad origen NO escribe el teórico dentro
  del input.`**
- `RN §2.3: el teórico y la merma esperada se muestran al lado del campo, siempre.`
- `RN §2.3: al tipear, la merma real se calcula y se colorea` (dentro de lo esperado, por
  encima, y obtenido > teórico).
- `fechaVencimientoDestino` se precarga desde `sugerir-vencimiento` **y es editable**.
- `codigoLoteDestino` vacío no habilita el botón; el patrón sugerido está en el placeholder,
  no en el valor.
- `cantidadOrigen` mayor a la existencia del lote se rechaza en el cliente.
- `RN §2.1: el AlertDialog nombra las dos cantidades, los dos lotes, la merma, y dice que no
  se puede deshacer.`
- `RN §2.1: el error del backend queda DENTRO del diálogo.`
- Sin conversiones para el producto origen, estado vacío con la salida correcta.
- Sin `manage_products`, el atajo de crear derivado no se renderiza.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Precargar cantidadObtenida con el teórico. Ni al inicio, ni al cambiar de destino, ni con
  un botón. Es LA regla de esta pantalla.
- Reimplementar el cálculo de merma del backend como regla propia: mostrás el mismo número,
  el que manda es el servidor.
- Ofrecer "deshacer" un fraccionamiento.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: fraccionar una bolsa en unidades sueltas con una cantidad obtenida MENOR al
   teórico, y verificar la merma en el historial y la cadena en la trazabilidad del lote.
5. Un commit: `feat(comercial-fe): fraccionamiento de lotes [F6·T1]`
