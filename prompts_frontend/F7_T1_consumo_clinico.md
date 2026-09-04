# F7 · TANDA 1 — Widget de consumo clínico en la historia
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.
> **Es la tanda que toca la frontera con el módulo clínico.** La dependencia va en una sola
> dirección: el movimiento de stock apunta al evento clínico, nunca al revés (§10.3 de la
> spec comercial). Esta tanda **no modifica la lógica de historial ni de vacunación**: agrega
> un widget que llama a `/consumos`.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.7, §2.2, §2.4 | Superficie de consumo, FEFO, costo. |
| `supabase/functions/api/src/modules/consumo/consumo.schemas.ts` | `RegistrarConsumoSchema` y su forma de ítem. |
| `supabase/functions/api/src/modules/consumo/consumo.controller.ts` | Los tres endpoints y sus permisos. |
| `web/src/pages/HistorialClinicoPage.tsx` | Dónde se engancha el widget. **Leelo para saber qué NO tocar.** |
| `web/src/pages/MostradorPage.tsx` (F4·T2) | El selector de lote con FEFO: se reusa el mismo patrón. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
FRONTERA CLÍNICA — esta tanda NO cambia la lógica de web/src/pages/HistorialClinicoPage.tsx
  ni de los componentes de vacunación. Solo agrega el widget y su punto de montaje.
TENANT — el frontend NUNCA manda tenant_id. El schema del backend es strict y el tenantId
  del body se ignora igual: no lo mandes.
PERMISOS — registrar consumo exige consume_stock (SOLO admin y veterinario; la
  recepcionista NO lo tiene). Ver el consumo exige view_stock.
FEFO — §2.2: mismo comportamiento que el mostrador. Lote sugerido marcado; elegir otro exige
  motivo en el MISMO formulario.
COSTO — el widget NO muestra costo. Es una consulta clínica, con el tutor presente.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/components/historial/ConsumoInsumosWidget.tsx`, montado dentro del detalle de un
evento de `web/src/pages/HistorialClinicoPage.tsx`.

**Sin `consume_stock`, el widget no se renderiza** — pero **con `view_stock` sí se muestra en
modo lectura**: el veterinario que registró y la recepcionista que consulta necesitan ver qué
se usó, aunque solo el primero pueda registrarlo.

### 1.1 — Modo lectura

`GET /consumos/evento/:historialId`. Lista de lo ya consumido en ese evento: producto,
cantidad, lote, y si hubo `motivoFefo`, **mostralo**.

Si no hay consumos, estado vacío: *"No se registraron insumos en esta atención."* Con
`consume_stock`, un botón "Registrar insumos".

### 1.2 — Registrar insumos

`POST /consumos` con `{ historialId, items[], planVacunacionId?, recetaId?,
profesionalPrescriptorId? }`.

Formulario, en `Sheet` o inline expandible:

- **Buscador de producto**, acotado a los consumibles clínicos:
  `GET /productos?search=&activo=true`. Filtrá en el cliente por `esConsumibleClinico`
  (la API no tiene ese filtro; con la página traída alcanza y **no** hay que inventar el
  parámetro).
- Por ítem: `cantidad`, y el **selector de lote con FEFO**.
- **Disponibilidad:** `GET /consumos/disponibilidad?productoId=` antes de agregar, para
  mostrar cuánto hay. Si es 0, el producto se marca sin stock.

### 1.3 — FEFO en el widget (§2.2) — idéntico al mostrador

`GET /lotes/candidatos?productoId=&cantidad=`:

- El primer lote viene **preseleccionado y marcado "Sugerido (vence antes)"**, con
  vencimiento y existencia.
- Elegir otro hace aparecer **`motivoFefo` en el mismo ítem**, y lo vuelve **requerido**.
- Sin motivo, no se puede registrar.
- Cambiar la cantidad vuelve a pedir candidatos.

**Reusá el componente de selección de lote de F4·T2.** Si en F4·T2 quedó acoplado a la página,
extraelo a `web/src/components/comercial/SelectorLoteFefo.tsx` y usalo en los dos lados. Es la
única refactorización que esta tanda tiene permitido hacer sobre F4.

### 1.4 — Campos opcionales de contexto

- `profesionalPrescriptorId`: precargado con el profesional del evento si está disponible,
  editable.
- `planVacunacionId`: si el evento está ligado a una dosis del plan, precargalo.
- `recetaId`: si el sistema no lo tiene resuelto en esta pantalla, **no lo inventes**: mandalo
  como `null`. No agregues un buscador de recetas que la API no necesita.

### 1.5 — Confirmación

Registrar consumo **descuenta stock**, así que va con confirmación, aunque es menos grave que
las de §2.1 (no hay endpoint para revertirlo desde acá):

> *"Se descuentan {N} unidades de {M} lotes y quedan registradas en esta atención. El
> movimiento queda asentado en el libro de stock."*

Errores por `code`: `INSUFFICIENT_STOCK`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`. **El
formulario no se limpia ante un error.**

## 2. Tests obligatorios

`ConsumoInsumosWidget.test.tsx`:
- Sin `view_stock`, el widget no se renderiza.
- Con `view_stock` y sin `consume_stock`, se renderiza en modo lectura sin botón de registrar.
- Modo lectura muestra los consumos y el `motivoFefo` cuando lo hay.
- **`RN §2.2: el primer lote candidato viene preseleccionado y marcado como sugerido.`**
- **`RN §2.2: elegir otro lote muestra motivoFefo EN EL MISMO ÍTEM y lo vuelve requerido.`**
- **`RN §2.2: sin motivo, el botón de registrar queda deshabilitado.`**
- El buscador acota a `esConsumibleClinico` en el cliente, sin mandar un filtro inventado.
- La disponibilidad en 0 marca el producto sin stock.
- **El body NO lleva `tenantId`.**
- `§2.4: el widget no muestra costo en ninguna parte.`
- Cada `code` de error produce su mensaje y el formulario no se limpia.

## 3. Prohibido

```
- Modificar la lógica de HistorialClinicoPage, de los componentes de vacunación, o de
  cualquier archivo de modules/historial o modules/vacunacion.
- Inventar el query param esConsumibleClinico: la API no lo tiene. Se filtra en el cliente.
- Agregar un buscador de recetas.
- Mostrar costo.
- Pedir el motivo FEFO en un paso posterior.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: en una atención real, registrar dos insumos (uno con lote no sugerido + motivo)
   y verificar el descuento en el kardex de los lotes.
5. Un commit: `feat(comercial-fe): widget de consumo clínico en la historia [F7·T1]`
