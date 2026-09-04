# B0 — Precio y alícuota de servicio en la API (+ fix de `codigoBarras`)
> **Capa:** BACKEND · **Modelo:** Gemini Flash · **Rol:** ejecución
> **NO SE EJECUTA TODAVÍA.** Bloqueada hasta que `feat/modulo-comercial` esté mergeada y
> re-auditada (Gemini está corrigiendo los bloques 2 y 3 sobre esa rama).
> **Es prerrequisito duro de F1.** Sin B0, la tanda 0b no puede cargar precios de servicios
> y el mostrador no puede venderlos sin romper D-03.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/servicios/servicios.schemas.ts` | Los dos schemas a extender. |
| `supabase/functions/api/src/modules/servicios/servicios.service.ts` | `ServicioPublico`, el mapper de fila y los `insert`/`update`. |
| `supabase/migrations/20260922000001_comercial_ventas.sql` líneas 13–16 | El DDL real de las dos columnas. **No lo modifiques**: ya está aplicado. |
| `supabase/migrations/20260922000002_comercial_registrar_venta_rpc.sql` líneas 198–222 | Cómo la RPC lee `precio` y `alicuota_iva`, y cuándo lanza `PRODUCT_WITHOUT_PRICE`. |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `ALICUOTAS_IVA`: la lista y el mensaje de error a replicar tal cual. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | El `ListarProductosQuerySchema.safeParse({...})` del GET `/` — ahí falta una línea. |
| `ADENDA_SPEC_COMERCIAL.md`, sección *"Nueva — Un controller test que mockea el Service no prueba el endpoint"* | Por qué el test de esta tanda va contra base real. |
| `tests/integration/aislamiento-api.integration.test.ts` líneas 682–690 | El caso `editar servicio` que hay que extender. |

## R. Reglas transversales de backend

```
- tenant_id SIEMPRE de ctx.tenantId (JWT vía tenantContext). Nunca del body/query/params.
- Los Services escriben con getServiceDb() y filtran .eq('tenant_id', tenantId) en TODA
  consulta. service_role bypasea RLS: el filtro es el único aislamiento.
- Envelope estándar: ok(data, meta?) / fail(code, message, statusCode, details).
- Los ErrorCode salen del enum central de shared/errors.ts. No inventar códigos.
- NUMERIC con precisión explícita. Nunca float.
- Esta tanda NO crea migraciones. Las dos columnas YA EXISTEN.
- Esta tanda NO toca RPCs, ni RLS, ni políticas, ni grants.
```

## 1. Qué hacer — cuatro cambios, ninguno con margen de interpretación

### 1.1 — `servicios.schemas.ts`

Agregar a `CrearServicioSchema` (y por lo tanto a `ActualizarServicioSchema`, que es
`.partial()` del anterior — no lo dupliques):

```ts
precio:      z.number().nonnegative().nullish(),
alicuotaIva: z
  .number()
  .refine(
    (v) => (ALICUOTAS_IVA as readonly number[]).includes(v),
    "La alícuota debe ser 0, 10.50, 21 o 27",
  )
  .default(21),
```

`ALICUOTAS_IVA` ya está exportado desde `productos.schemas.ts`. **Importalo de ahí, no lo
redeclares.** El CHECK de la base (`alicuota_iva IN (0, 10.50, 21, 27)`) es la defensa real;
esto devuelve un 422 legible en vez de un 500 con el mensaje de Postgres.

`precio` es `nullish` a propósito: un servicio sin precio cargado es un estado válido — la
RPC lo rechaza recién al vender.

### 1.2 — `servicios.service.ts`

Tres puntos, y solo tres:

1. `ServicioPublico`: agregar `precio: number | null` y `alicuotaIva: number`.
2. El mapper de fila: `precio: row["precio"] != null ? Number(row["precio"]) : null` y
   `alicuotaIva: Number(row["alicuota_iva"])`. **Con `Number()`**: PostgREST devuelve NUMERIC
   como string y sin el cast el precio llega al frontend como `"1500.00"`.
3. Crear y actualizar: mapear `precio` → `precio` y `alicuotaIva` → `alicuota_iva`. En
   actualizar, el patrón del archivo es `if (dto.campo !== undefined) payload["col"] = ...` —
   seguilo, para que `null` explícito borre el precio y `undefined` lo deje como está.

**No cambies nada más de este archivo.** Ni `assertDuracion`, ni la pre-query de RN-SV2, ni el
`select("*")`.

### 1.3 — Fix del filtro `codigoBarras` muerto (`productos.controller.ts`)

`ListarProductosQuerySchema` declara `codigoBarras` y `ProductoService.buscarPaginado` lo
aplica (`q.eq("codigo_barras", query.codigoBarras)`), pero el controller **nunca lo lee**. En
el `safeParse` del `GET /` falta:

```ts
codigoBarras: c.req.query("codigoBarras"),
```

Es una línea. Es un bug, no una limitación de diseño: hoy el escaneo cae en el `search`, que
hace `ilike` sobre `codigo_barras` y con códigos que comparten prefijo devuelve el producto
equivocado.

**Cuidado con el fallback:** el objeto literal del `else` (cuando el parseo falla) también
tiene que incluir `codigoBarras: undefined`, o TypeScript se queja del tipo.

### 1.4 — Tests

**a) Unit del Service** (`tests/unit/servicios.service.test.ts`, extendiendo el que ya está):
- `RN-SV: crea un servicio con precio y alícuota y los devuelve como number`
- `RN-SV: rechaza una alícuota fuera de {0, 10.50, 21, 27} → VALIDATION_ERROR`
- `RN-SV: actualizar sin tocar precio no lo pisa` (el `undefined` no entra al payload)
- `RN-SV: actualizar con precio null lo borra`

**b) Smoke de camino feliz CONTRA BASE REAL** (`tests/integration/servicios.integration.test.ts`).
**No** un controller test con el Service mockeado: eso no prueba el endpoint (ver la adenda).
El smoke hace, con `callApp` y un JWT real, el ciclo completo:

```
POST /servicios  { nombre, tipo, duracionMinutos, requiereProfesional, precio: 1500, alicuotaIva: 21 }
  → 201, y data.precio === 1500 (number, no "1500.00")
GET  /servicios/:id
  → 200, precio 1500, alicuotaIva 21
PUT  /servicios/:id  { precio: 1800 }
  → 200, precio 1800, y duracionMinutos SIN cambiar
GET  /servicios?limit=100
  → el servicio aparece con su precio en el listado
```

Y un caso que cierra el círculo con la razón de ser de B0:

```
POST /ventas con un ítem { tipoItem: "servicio", servicioId } SIN precioUnitario
  → 201 (antes de B0 esto era imposible: precio era NULL y la RPC tiraba
     PRODUCT_WITHOUT_PRICE). Verificar que la línea guardada tiene la alícuota
     del servicio, que es lo que D-03 exige.
```

**c) Matriz de aislamiento** (`tests/integration/aislamiento-api.integration.test.ts`):
el caso `{ nombre: "editar servicio", method: "PUT", path: /servicios/${A.servicioId} }` ya
existe. Extendé su body para que lleve `precio` y `alicuotaIva`, y confirmá que sigue dando
**404** cuando el JWT es del tenant B. Un precio no puede ser el vector que abra la escritura
cross-tenant.

## 2. Prohibido en esta tanda

```
- Crear migraciones. Las columnas ya existen y ya están aplicadas.
- Tocar registrar_venta ni ningún otro RPC.
- Tocar RLS, políticas o grants de `servicios`.
- Cambiar la forma del envelope o los ErrorCode.
- Tocar cualquier archivo de web/.
- "Aprovechar el viaje" para arreglar otra cosa del módulo servicios.
```

## 3. Definición de terminado

1. `npm run typecheck` en verde.
2. `npm test` en verde (los unit nuevos incluidos).
3. `npm run test:integration` en verde, con **0 skipped** en `servicios.integration.test.ts`
   y en `aislamiento-api.integration.test.ts`. Contá los `passed`: una suite SKIPPED no es
   un rojo pero tampoco es una prueba (faltan `TEST_SUPABASE_*` en `.env`).
4. Un commit: `fix(servicios): precio y alícuota por API + filtro codigoBarras [B0]`
