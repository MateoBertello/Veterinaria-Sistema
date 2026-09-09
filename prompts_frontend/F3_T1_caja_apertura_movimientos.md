# F3 · TANDA 1 — Caja: apertura y movimientos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde.
> **Es prerrequisito del mostrador:** `RegistrarVentaSchema` exige `sesionCajaId`. Sin una
> sesión abierta, F4 no puede vender.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.4, §1.9, §1.10 | Superficie, medios de pago por PostgREST, permisos. |
| `supabase/functions/api/src/modules/caja/caja.schemas.ts` | Los cuatro schemas exactos. |
| `supabase/functions/api/src/modules/caja/caja.service.ts` | La forma de `SesionCaja` y `MovimientoCaja`. |
| `web/src/api/catalogos-comercial.ts` (F1·T1) | `listarMediosPago()`. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — todo /caja exige manage_cash (módulo ventas). El veterinario NO lo tiene.
MEDIOS DE PAGO — no hay endpoint. Se leen por PostgREST con listarMediosPago(). Es un
  catálogo GLOBAL con policy auth.uid() IS NOT NULL. Sin esa lista no se puede registrar
  un movimiento: medioPagoId es obligatorio y es un UUID.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/CajaPage.tsx` en `/ventas/caja` (`manage_cash`)

**Lo primero que hace es preguntar si hay sesión abierta:** `GET /caja/sesiones/actual`.
De ahí salen dos estados de pantalla completamente distintos.

**Estado A — sin sesión abierta.** Panel centrado con el formulario de apertura:
- Select de caja (`GET /caja/cajas`; si hay una sola, preseleccionada y sin Select).
- `saldoInicial` (número ≥ 0, requerido).
- Botón "Abrir caja" → `POST /caja/sesiones`.
- Texto de ayuda: *"El saldo inicial es el efectivo con el que arranca el turno. Se usa para
  calcular el arqueo al cerrar."*

Abrir **no** es irreversible, así que **no lleva `AlertDialog`**. Cerrar sí (F3·T2).

**Estado B — con sesión abierta.** Tres bloques:

1. **Cabecera de la sesión:** caja, quién la abrió, desde cuándo, saldo inicial, y un botón
   destacado **"Cerrar caja"** que navega a `/ventas/caja/:sesionId` (F3·T2).
2. **Resumen en vivo:** `GET /caja/sesiones/:id/resumen` — tarjetas con `saldoInicial`,
   `saldoTeoricoEfectivo` y una tabla de `totalesPorMedioPago` (medio, ingresos, egresos,
   neto), marcando cuáles **afectan el arqueo** (`afectaArqueo`).
3. **Movimientos:** la lista de la sesión, con el formulario de alta.

### 1.2 — Registrar un movimiento

`POST /caja/sesiones/:id/movimientos` con `{ tipo, medioPagoId, importe, motivo?, referencia? }`.

Formulario en `Dialog`:
- `tipo`: Select con los siete valores del ENUM, **agrupados en dos grupos visuales**
  (Ingresos: `ingreso_venta`, `ingreso_cobro_cuenta_corriente`, `ingreso_manual`; Egresos:
  `egreso_pago_proveedor`, `egreso_devolucion`, `egreso_manual`, `egreso_retiro`).
- `medioPagoId`: Select desde `listarMediosPago()`.
- `importe`: número **positivo** (el schema exige `> 0`; el signo lo da el `tipo`, no el importe).
- `motivo`: si se completa, **mínimo 10 caracteres** (el schema lo exige cuando no es null).
  Contador de caracteres a la vista.
- `referencia`: mostrala como **requerida** cuando el medio de pago elegido tiene
  `requiere_referencia: true`. El backend no lo obliga; la UI sí lo pide, porque una
  transferencia sin referencia no se concilia después.

> **Ojo con `ingreso_venta`:** los movimientos de venta los crea la RPC de `POST /ventas`
> automáticamente. Ofrecer `ingreso_venta` a mano permite duplicar el ingreso. Dejalo en el
> Select (el backend lo acepta) pero **con un texto de advertencia**: *"Las ventas registran
> su ingreso automáticamente. Usá esta opción solo para corregir."*

### 1.3 — Lista de movimientos

Columnas: hora, tipo (badge verde ingreso / rojo egreso), medio de pago, importe, motivo,
referencia. Sin paginación propia: los movimientos vienen embebidos en `GET /caja/sesiones/:id`.

### 1.4 — Historial de sesiones

`GET /caja/sesiones` (`estado`, `desde`, `hasta`, `page`, `limit`) en una tabla debajo, o en
una segunda pestaña. Columnas: caja, apertura, cierre, saldo inicial, efectivo contado,
**diferencia** (verde si 0, ámbar si menor, rojo si mayor a un umbral visual), estado.

## 2. Tests obligatorios

`CajaPage.test.tsx`:
- Sin sesión abierta se muestra el formulario de apertura; con sesión abierta, los tres bloques.
- Abrir manda `{ cajaId, saldoInicial }` y **no** lleva `AlertDialog`.
- El Select de medios de pago se llena desde `listarMediosPago()` (PostgREST), no desde la API.
- Un motivo de 5 caracteres no habilita el botón; uno de 10, sí.
- Elegir un medio con `requiere_referencia: true` marca `referencia` como requerida.
- El importe negativo se rechaza en el cliente.
- `ingreso_venta` muestra la advertencia.
- El resumen marca cuáles medios afectan el arqueo.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Poner el cierre de caja acá. Es F3·T2, y es irreversible: tiene su propia pantalla.
- Inventar un endpoint de medios de pago. Se leen por PostgREST.
- Mandar el importe con signo. Es siempre positivo; el signo lo da el tipo.
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Abrir una caja, registrar un ingreso manual y un egreso, y ver los dos en el resumen
   por medio de pago.
5. Un commit: `feat(comercial-fe): apertura de caja y movimientos [F3·T1]`
