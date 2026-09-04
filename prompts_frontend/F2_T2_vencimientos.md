# F2 · TANDA 2 — Vencimientos próximos
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F2·T1 en verde.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.2, §4.3, §4.5 | Superficie, el bug de `conExistencia` y por qué el umbral lo elige la pantalla. |
| `web/src/pages/LotesPage.tsx` (F2·T1) | Piezas reutilizables: badges de estado, tabla de lotes. |
| `web/src/lib/fechas.ts` | Helpers de fecha del repo. **Usá estos, no escribas otros.** |
| `supabase/functions/api/src/modules/stock/stock.service.ts` `notificarLotesPorVencer` | De dónde sale el default de 60 días. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. No existe GET /lotes-por-vencer: la vista
  v_lotes_por_vencer está REVOCADA para `authenticated` y no tiene endpoint. Esta pantalla
  se arma con GET /lotes?venceAntesDe=... Si hace falta algo más: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
ESTILO — docs/GUIA_ESTILO.md. Ámbar = próximo a vencer. Rojo = vencido.
TESTS — cd web && npm run test:run
```

## 1. Qué construir

`web/src/pages/VencimientosPage.tsx` en `/stock/vencimientos` (`view_stock`).

### 1.1 — El umbral lo elige la pantalla, y hay que dejarlo escrito

`configuracion_tenant.dias_alerta_vencimiento` **es la fuente correcta del umbral**, y el
Service la usa para las notificaciones. Pero la API de configuración **no la expone**
(`ConfiguracionPublica` solo tiene `cupoMaximoDiario`, `diasAvisoVacuna` y `parametrosExtra`).

Entonces: un `Select` de rango con **30 / 60 / 90 días**, por defecto **60**, que es el
default del Service (`config?.dias_alerta_vencimiento ?? 60`).

**Comentario obligatorio** en el componente: *la config del tenant es la fuente correcta de
este umbral; la pantalla la está sustituyendo porque la API no la expone. Ver
`PLAN_FRONTEND_COMERCIAL.md` §4.5.*

### 1.2 — Los datos

`GET /lotes?venceAntesDe=<hoy + N días>&conExistencia=true&limit=100`, recorriendo páginas.

**Trampa (§4.3):** `conExistencia` filtra **después** de paginar. No uses `meta.total`;
recorré las páginas hasta que la respuesta cruda venga con menos de `limit` ítems.

Los lotes **ya vencidos** también entran: `venceAntesDe` es un `lte`, así que vuelven solos.
Hay que separarlos visualmente, no esconderlos — un lote vencido con existencia es el caso
más urgente de todos.

### 1.3 — Presentación

Tres grupos, en este orden, cada uno con su contador en el encabezado:

1. **Vencidos** (rojo) — `fechaVencimiento < hoy`.
2. **Vencen esta semana** (ámbar) — dentro de 7 días.
3. **Vencen en el rango elegido** (gris/ámbar suave) — el resto hasta N días.

Columnas: producto, código de lote, **vencimiento**, **días restantes** (negativos si venció),
cantidad, proveedor, acciones (→ `/stock/lotes/:id`).

Filtro adicional por producto (Select alimentado por los lotes ya traídos, sin fetch extra).

Estado vacío con copy propio: *"No hay lotes que venzan en los próximos N días."* — no el
genérico "No hay resultados".

### 1.4 — Nada de acciones destructivas acá

Esta pantalla **informa**. Dar de baja un lote vencido es un ajuste
(`merma_vencimiento`) y vive en F5·T1. Poné un link a `/stock/ajustes` en cada fila vencida,
no el formulario.

## 2. Tests obligatorios

`VencimientosPage.test.tsx`:
- Los tres grupos se arman bien: un lote con vencimiento de ayer va a "Vencidos", uno de
  dentro de 3 días a "Esta semana", uno de dentro de 45 al tercer grupo.
- Los días restantes de un lote vencido son negativos y se muestran como tales.
- Cambiar el rango a 30 dispara un fetch nuevo con el `venceAntesDe` recalculado.
- `§4.3: la paginación no usa meta.total` — con `meta.total: 100` y una respuesta de 3 ítems
  (post-filtro), no intenta pedir más páginas.
- `§4.5: el selector de rango existe y arranca en 60.`
- Estado vacío con el copy propio.
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Pedir la vista v_lotes_por_vencer por PostgREST: está REVOCADA para `authenticated`
  (migración 20261027000001) y devolvería 401/403. No es un descuido: es hardening.
- Poner el formulario de ajuste acá. Es F5·T1.
- Usar meta.total con conExistencia activo.
- Escribir helpers de fecha propios: usá web/src/lib/fechas.ts.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Con un lote vencido y uno por vencer en el tenant de prueba, los dos aparecen en su grupo.
5. Un commit: `feat(comercial-fe): panel de vencimientos próximos [F2·T2]`
