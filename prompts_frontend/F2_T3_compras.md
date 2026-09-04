# F2 · TANDA 3 — Compras: borrador, ítems y recepción
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T3 en verde (necesita proveedores) y F2·T1 (para ver el resultado).

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.3, §2.1, §2.5 | Superficie y la regla de irreversibles. |
| `supabase/functions/api/src/modules/compras/compras.schemas.ts` | Los cinco schemas exactos. |
| `supabase/migrations/20260908000004_comercial_confirmar_compra_rpc.sql` | Qué hace confirmar: crea los lotes y los movimientos de entrada. |
| `web/src/pages/ProveedoresPage.tsx` (F1·T3) | El buscador de proveedor. |
| `web/src/components/catalogos/DesactivarCatalogoDialog.tsx` | Confirmación con el error dentro del diálogo. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
PERMISO — todo /compras exige manage_suppliers (módulo stock). El veterinario no entra.
COSTO — esta pantalla trabaja con costos: es su razón de ser. No hay margen acá.
IVA — en compras el costo se carga NETO (costoUnitarioNeto) + alicuotaIva por separado.
  OJO: es al revés que en ventas, donde el precio es final con IVA incluido. No los mezcles.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

### 1.1 — `web/src/pages/ComprasPage.tsx` en `/stock/compras`

Listado con `GET /compras` (`proveedorId`, `estado`, `desde`, `hasta`, `page`, `limit`).
Columnas: fecha, proveedor, comprobante del proveedor (tipo + número), estado (badge:
gris `borrador`, verde `confirmada`, rojo `anulada`), total, acciones.

> **Nota de copy:** `comprobanteProveedorTipo` / `comprobanteProveedorNumero` **sí** son un
> comprobante — el que emitió el proveedor. Ahí la palabra "Comprobante" es correcta. La
> prohibición de §2.6 es sobre `numero_operacion`, que es otra cosa.

Botón "Nueva compra" → `POST /compras` (borrador) y navegación al detalle.

### 1.2 — `web/src/pages/CompraDetallePage.tsx` en `/stock/compras/:id`

**Estado `borrador` — todo editable:**

- Cabecera (`PUT /compras/:id`): proveedor, fecha, tipo y número de comprobante del proveedor,
  observaciones, y el switch **`generaEgresoCaja`** con texto de ayuda: *"Al confirmar, registra
  el egreso en la caja abierta."*
- Ítems (`POST/PUT/DELETE /compras/:id/items`): tabla editable con producto (buscador),
  cantidad, **costo unitario neto**, alícuota (Select 0 / 10,5 / 21 / 27), **código de lote**
  y **fecha de vencimiento**.
- **Los dos campos de lote son el corazón de la recepción.** `codigoLote` y `fechaVencimiento`
  son los que van a crear el lote al confirmar. Si el producto tiene `controlaLote` o
  `controlaVencimiento` en `true`, marcá el campo como requerido en la UI y explicá por qué.
- Totales calculados en el cliente y mostrados con el desglose neto / IVA / total. Acá **sí**
  el desglose es primario: es una compra, no una venta de mostrador.

**Estados `confirmada` y `anulada` — solo lectura.** Ningún control de edición se renderiza
(no deshabilitado: no se renderiza).

### 1.3 — Confirmar es irreversible (§2.1)

`POST /compras/:id/confirmar` con `AlertDialog`, y el texto **dice qué queda registrado**:

> *"Se van a crear N lotes con las cantidades y vencimientos cargados, y sus movimientos de
> entrada en el libro de stock. La compra queda confirmada y sus ítems no se pueden volver a
> editar. No se puede deshacer."*

Si `generaEgresoCaja` está activo, sumá: *"Además se registra el egreso de $X en la caja
abierta."*

El error del backend se muestra **dentro del diálogo, sin cerrarlo**. Los casos que hay que
poder leer sin adivinar: sin sesión de caja abierta con `generaEgresoCaja`, compra sin ítems,
producto inactivo.

### 1.4 — Anular

`POST /compras/:id/anular` con `{ motivo }`, **mínimo 10 caracteres** (lo valida el backend;
validalo también en el cliente con el contador de caracteres a la vista).
`AlertDialog`: *"Se revierten los movimientos de stock de esta compra. Los lotes creados
quedan sin existencia. No se puede deshacer."*

## 2. Tests obligatorios

`ComprasPage.test.tsx`: estados vacío/cargando/error, filtros, badges por estado.

`CompraDetallePage.test.tsx`:
- En `borrador` los controles de edición están; en `confirmada` **no se renderizan**.
- Agregar un ítem manda exactamente los campos de `agregarItemCompraSchema`.
- Los totales se calculan bien: neto × cantidad, IVA por alícuota, total.
- `RN §2.1: confirmar pide confirmación explícita, el texto nombra los lotes que se crean y
  dice que no se puede deshacer.`
- `RN §2.1: el error de confirmar queda DENTRO del diálogo y el diálogo no se cierra.`
- Anular con motivo de menos de 10 caracteres no habilita el botón.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Editar ítems de una compra confirmada o anulada.
- Cargar el costo con IVA incluido. En compras el costo es NETO (al revés que en ventas).
- Confirmar sin AlertDialog, o con un texto genérico tipo "¿Estás seguro?".
- Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Ciclo completo probado: crear borrador → agregar 2 ítems con lote y vencimiento →
   confirmar → verificar en `/stock/existencias` que las cantidades entraron.
5. Un commit: `feat(comercial-fe): compras y recepción de mercadería [F2·T3]`
