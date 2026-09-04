# F3 · TANDA 2 — Arqueo y cierre de caja
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F3·T1 en verde.
> **Cerrar caja es irreversible.** No hay endpoint que reabra una sesión. Esta pantalla es
> el ejemplo canónico de la regla §2.1: la confirmación dice qué queda registrado y que no
> hay vuelta atrás.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.4, §2.1 | La forma de `ResumenSesion` y la regla de irreversibles. |
| `supabase/functions/api/src/modules/caja/caja.service.ts` `resumenSesion` | Los cinco campos del arqueo y `totalesPorMedioPago`. |
| `supabase/functions/api/src/modules/caja/caja.schemas.ts` `CerrarSesionSchema` | `{ efectivoContado, motivo?, observaciones? }`. |
| `web/src/components/catalogos/DesactivarCatalogoDialog.tsx` | Error dentro del diálogo. |
| `web/src/pages/CajaPage.tsx` (F3·T1) | El resumen que se reusa. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No existe endpoint para reabrir una sesión y no
  se inventa uno. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — manage_cash.
IRREVERSIBLE — §2.1: AlertDialog cuyo texto nombra el efecto concreto y dice que no se
  deshace. Un "¿Estás seguro?" genérico NO cumple.
ESTILO — docs/GUIA_ESTILO.md. Verde = sin diferencia. Ámbar/rojo = diferencia.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/ArqueoCajaPage.tsx` en `/ventas/caja/:sesionId` (`manage_cash`).

### 1.1 — Lo que se muestra antes de contar

`GET /caja/sesiones/:id/resumen` da todo lo necesario:

- `saldoInicial`
- `saldoTeoricoEfectivo` — lo que **debería** haber en el cajón
- `totalesPorMedioPago[]` con `{ medioPagoId, codigo, nombre, afectaArqueo, ingresos, egresos, neto }`

Presentación: una tarjeta grande con el **saldo teórico en efectivo**, y una tabla con los
totales por medio de pago **separando los que afectan el arqueo de los que no**. Solo el
efectivo afecta el arqueo (`afecta_arqueo: true` únicamente en `efectivo`); los demás se
listan como informativos, porque el cajero igual necesita verlos para cuadrar con el
liquidador de tarjetas.

### 1.2 — El conteo

Un solo campo obligatorio: **`efectivoContado`** (número ≥ 0).

**El campo arranca vacío.** No lo precargues con el saldo teórico: si lo hacés, la gente lo
acepta y el arqueo deja de existir. Es el mismo razonamiento que la regla §2.3 del
fraccionamiento.

Opcional: una **ayuda de conteo por denominación** (billetes × cantidad) que suma al campo.
Si la implementás, el campo sigue siendo editable a mano y el total de la ayuda solo lo
sugiere al presionar "Usar este total".

### 1.3 — La diferencia, en vivo

Apenas hay un valor tipeado, mostrar **`efectivoContado − saldoTeoricoEfectivo`**:

- **0** → verde, "Sin diferencia".
- **Negativo** → rojo, "Faltan $X".
- **Positivo** → ámbar, "Sobran $X".

Cuando hay diferencia (distinta de 0), el campo **`motivo` pasa a ser requerido en la UI**,
con mínimo 10 caracteres y contador a la vista. El backend acepta `motivo` nulo; **la pantalla
lo exige igual**, porque una diferencia sin explicación es exactamente el dato que después
nadie puede reconstruir.

`observaciones` queda siempre opcional (máx. 500).

### 1.4 — La confirmación (§2.1)

`AlertDialog` con el texto armado con los números reales:

> **"Cerrar la caja"**
> *"Se registra el arqueo con un efectivo contado de $X sobre un saldo teórico de $Y, con una
> diferencia de $Z. La diferencia y su motivo quedan asentados en la sesión y en la auditoría.
> La sesión queda cerrada y **no se puede volver a abrir**: las ventas siguientes van a
> necesitar una sesión nueva."*

Cuando la diferencia es 0, la frase de la diferencia se ajusta a *"sin diferencia"*, pero
**las dos últimas oraciones no cambian**: el cierre es irreversible igual.

El error del backend se muestra **dentro del diálogo, sin cerrarlo**.

### 1.5 — Después de cerrar

La pantalla pasa a **solo lectura** mostrando el arqueo final (`efectivoContado`,
`diferencia`, motivo, observaciones) y un botón para volver a `/ventas/caja`, que ahora va a
ofrecer abrir una sesión nueva.

Una sesión ya cerrada abierta por URL muestra directamente esta vista de solo lectura, sin
formulario.

## 2. Tests obligatorios

`ArqueoCajaPage.test.tsx`:
- El resumen se renderiza con los cinco campos y la tabla por medio de pago, separando los
  que afectan el arqueo.
- **`§2.3/§1.2: el campo de efectivo contado arranca VACÍO, no precargado con el teórico.`**
- La diferencia se calcula y se colorea bien en los tres casos (0, faltante, sobrante).
- Con diferencia distinta de 0, `motivo` es requerido y con menos de 10 caracteres el botón
  de cerrar no se habilita.
- Con diferencia 0, `motivo` no es requerido.
- `RN §2.1: el AlertDialog nombra el efectivo contado, el teórico, la diferencia, y dice que
  la sesión no se puede volver a abrir.`
- `RN §2.1: el error del backend queda DENTRO del diálogo y el diálogo no se cierra.`
- Una sesión con estado `cerrada` se renderiza en solo lectura, sin formulario.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Precargar efectivoContado con el saldo teórico. Es el error que anula el arqueo entero.
- Cerrar sin AlertDialog, o con un texto que no nombre la diferencia y la irreversibilidad.
- Ofrecer "reabrir sesión". No existe el endpoint y no se inventa.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
2. Ciclo probado: abrir caja con $1000 → un ingreso de $500 → cerrar contando $1450 →
   la diferencia dice "Faltan $50", exige motivo, y la sesión queda cerrada.
5. Un commit: `feat(comercial-fe): arqueo y cierre de caja [F3·T2]`
