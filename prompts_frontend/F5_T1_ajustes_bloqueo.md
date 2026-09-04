# F5 · TANDA 1 — Ajustes de existencia y bloqueo de lotes
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.6, §1.10, §2.1 | Superficie, permisos, irreversibles. |
| `supabase/functions/api/src/modules/ajustes/ajustes.schemas.ts` | `AjustarExistenciaSchema`, `BloquearLoteSchema`, `DesbloquearLoteSchema`. |
| `web/src/pages/LotesPage.tsx` (F2·T1) | El listado de lotes que se reusa para elegir el lote. |
| `web/src/pages/VencimientosPage.tsx` (F2·T2) | De ahí llegan los links de lotes vencidos. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_stock (módulo stock). Ni la recepcionista ni el veterinario lo tienen:
  esta pantalla es de admin. El gating ya está en la ruta (F1·T1).
IRREVERSIBLE — un ajuste escribe en el libro mayor y NO se borra. AlertDialog con el
  efecto nombrado (§2.1).
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/AjustesPage.tsx` en `/stock/ajustes` (`manage_stock`).

### 1.1 — Elegir el lote

Buscador de producto → lista de sus lotes (`GET /lotes?productoId=&conExistencia=true`), con
código de lote, vencimiento, existencia actual y estado. Si se llega con un `loteId` en la
query (desde `/stock/vencimientos`), viene preseleccionado.

**Trampa de `conExistencia` (§4.3):** el filtro se aplica después de paginar. No uses
`meta.total`. Para un solo producto, con `limit=100` alcanza en la práctica.

### 1.2 — Registrar el ajuste

`POST /ajustes` con `{ loteId, tipo, cantidad, motivo }`.

- `tipo`: Select con los cuatro valores del ENUM, **con su explicación al lado, porque la
  diferencia importa y no es obvia**:
  - `entrada_ajuste` — "Aparece stock que el sistema no tenía."
  - `salida_ajuste` — "Falta stock que el sistema tenía."
  - `merma_rotura` — "Se rompió o se perdió."
  - `merma_vencimiento` — "Se descarta por vencido."
- `cantidad`: número **positivo** (el signo lo da el tipo, no el importe).
- `motivo`: **mínimo 10 caracteres**, contador a la vista. Es lo único que va a quedar para
  explicar el desvío dentro de seis meses.

Mostrá en vivo **la existencia resultante** (`existencia actual ± cantidad`) antes de
confirmar. Si diera negativa, avisá: la RPC lo va a rechazar (RN-MV5) y es mejor saberlo antes.

`AlertDialog`:

> **"Registrar el ajuste"**
> *"Se registra un movimiento de {tipo} por {cantidad} sobre el lote {código}. La existencia
> pasa de {X} a {Y}. El movimiento queda asentado en el libro de stock y en la auditoría, y
> **no se puede borrar**: para corregirlo hay que registrar otro ajuste en sentido contrario."*

Esa última frase es importante y va tal cual: explica **cómo** se corrige un error, que es lo
que el usuario va a necesitar saber justo después de equivocarse.

### 1.3 — Bloquear y desbloquear lotes

`POST /lotes/:id/bloquear` y `/desbloquear`, los dos con `{ motivo }` de mínimo 10 caracteres.

Van como acciones en la fila del lote y en `/stock/lotes/:id`.

`AlertDialog` de bloqueo:
> *"El lote {código} deja de estar disponible para ventas y para consumo clínico. Su
> existencia no cambia. Se puede desbloquear después."*

El bloqueo **sí** es reversible, y el texto lo dice — no lo pintes de irreversible, porque
entonces nadie lo usa. El de desbloqueo es el simétrico.

Badge rojo "Bloqueado" en todas las vistas de lote (ya está en F2·T1; verificá que se vea).

## 2. Tests obligatorios

`AjustesPage.test.tsx`:
- Los cuatro tipos aparecen con su explicación.
- La cantidad negativa se rechaza en el cliente.
- La existencia resultante se calcula y se muestra antes de confirmar.
- Una existencia resultante negativa muestra la advertencia.
- El motivo de menos de 10 caracteres no habilita el botón.
- `RN §2.1: el AlertDialog nombra el tipo, la cantidad, el lote, la existencia antes y
  después, y dice que no se puede borrar sino corregir con otro ajuste.`
- `RN §2.1: el error del backend queda DENTRO del diálogo.`
- Bloquear/desbloquear mandan `{ motivo }` y su diálogo dice que **sí** es reversible.
- `§4.3: no se usa meta.total con conExistencia activo.`
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Mandar la cantidad con signo. Es positiva; el signo lo da el tipo.
- Ofrecer "borrar" o "revertir" un ajuste: no existe el endpoint. Se corrige con otro ajuste.
- Pintar el bloqueo como irreversible.
- Poner recuentos acá. Son F5·T2.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Probado: una merma por vencimiento sobre un lote real, verificando en el kardex del lote
   (F2·T1) que el movimiento quedó.
5. Un commit: `feat(comercial-fe): ajustes de existencia y bloqueo de lotes [F5·T1]`
