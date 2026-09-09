# ETAPA C6 · TANDA 4/4 — Service, Controller y cierre de la matriz
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T3 en verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **Última tanda del alcance planificado (C1–C6).** Al terminarla, corré el prompt de auditoría
> `C6_AUDITORIA.md`. Las 85 RN del alcance tienen que quedar en ✅; las 5 de consumo clínico
> (RN-CC1…CC5) siguen en `N/A` hasta que se planifique C7.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `supabase/functions/api/src/modules/ajustes/ajustes.service.ts` | Tu Service de C5·T4: el mapper de errores de RPC y la forma de componer. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | El patrón de permisos por método. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §8.1, §8.2 | `split_stock` es un permiso **propio**: no se deduce de `manage_stock`. |
## O. Seis correcciones a `ESPEC_MODULO_COMERCIAL.md` v1.0

La spec v1.0 tiene seis puntos que se corrigieron en la sesión de planificación. **Estas
correcciones ganan sobre la spec.** Están completas en `PLAN_ETAPAS_COMERCIAL.md` §0; lo que
sigue es lo que necesitás para esta tanda.

```
O-1  NOMBRES EN PLURAL. D-02 de la spec escribe `movimiento_stock` y `existencia_lote`.
     Los nombres correctos son PLURALES, como todo el repo:
       movimientos_stock  existencias_lote  lotes  productos  proveedores
       familias_producto  producto_conversiones  compras  compras_items
       ventas  ventas_items  ventas_pagos  cajas  sesiones_caja
       movimientos_caja   recuentos  recuentos_detalle  contadores_tenant

O-2  LA COLUMNA "Etapa" DE §5 ESTÁ MAL. Usá el corte de §11 y de
     PLAN_ETAPAS_COMERCIAL.md, no la tabla de §5.

O-3  UNIQUE (id, tenant_id) FALTA EN CINCO TABLAS DE PRODUCCIÓN. Las FKs compuestas lo
     necesitan del lado referenciado. Hoy solo lo tienen roles, especies, razas y
     tipos_vacuna. Se agregan: clientes (C1·T3), mascotas / historial_clinico /
     plan_vacunacion (C2·T1), servicios (C4·T1).

O-4  NUEVE ErrorCode QUE §7 NO TIENE. Se suman al enum de shared/errors.ts:
       PRODUCT_NOT_FOUND  PRODUCT_NAME_DUPLICATE  FAMILY_NOT_FOUND  SUPPLIER_NOT_FOUND
       CONVERSION_NOT_FOUND  PURCHASE_NOT_FOUND  SALE_NOT_FOUND  CASH_SESSION_NOT_FOUND
       COUNT_NOT_FOUND
     Y RN-PR12 (nombre duplicado) devuelve PRODUCT_NAME_DUPLICATE, no PRODUCT_CODE_DUPLICATE.

O-5  AGREGAR UN VALOR A modulo_vendible TOCA SEIS ARCHIVOS DE CÓDIGO, no solo
     on_tenant_created(). La lista exacta está en la tanda C1·T2.

O-6  `npm test` NO CORRE INTEGRACIÓN. Es `vitest run tests/unit`. Los tests de integración
     van con `npm run test:integration` y necesitan TEST_SUPABASE_URL,
     TEST_SUPABASE_ANON_KEY y TEST_SUPABASE_SERVICE_ROLE_KEY en `.env`. Sin ellas,
     describeIntegration marca las suites SKIPPED — que no es un rojo, pero tampoco es una
     prueba. Cuando esta tanda tenga tests de integración, la definición de hecho exige
     contar los `passed`, no que la suite termine sin rojo.
```
## R. Reglas transversales — se aplican en TODA tanda, sin excepción

```
- tenant_id SIEMPRE de ctx.tenantId (que viene del JWT vía tenantContext). Ningún handler
  lo lee del body, query o params.
- Los Services escriben con getServiceDb() y filtran .eq('tenant_id', tenantId) en TODA
  consulta, sin excepción. service_role bypasea RLS: el filtro es el aislamiento.
- Los RPC son SECURITY DEFINER, reciben p_tenant_id como primer parámetro y filtran por él
  en cada lectura y escritura. Cierran con REVOKE ALL ... FROM PUBLIC + GRANT EXECUTE ...
  TO service_role.
- Toda migración que cree o cambie un RPC termina con NOTIFY pgrst, 'reload schema';
- Envelope estándar: ok(data, meta?) / fail(code, message, statusCode, details).
- Los ErrorCode salen del enum central de shared/errors.ts. No inventar códigos.
- Errores de negocio en RPC: RAISE EXCEPTION '<ERROR_CODE>'; el Service los mapea a
  DomainError.
- Auditoría: recordAudit() desde el Service; INSERT INTO registros_auditoria DENTRO del RPC
  para operaciones transaccionales (patrón registrar_eutanasia).
- Toda escritura de existencia va por RPC con SELECT ... FOR UPDATE ordenado por lote_id.
  El Service NUNCA lee existencias para decidir.
- RLS de las tablas nuevas: ENABLE (sin FORCE), política FOR SELECT con usuario_activo() y
  tiene_permiso('<permiso>'). Sin políticas de escritura. Sin GRANT propio.
- NUMERIC con precisión explícita. Nunca float.
- Nada se borra ni se edita: se compensa con un asiento nuevo y motivo.
- Nombres del glosario (§1 de la spec) iguales en base, código, ErrorCode y UI.
```
## M. Marca de migración del módulo — obligatoria en TODA migración comercial

Cada archivo `.sql` que escribas para este módulo **arranca con esta línea exacta**, antes de
cualquier comentario de encabezado:

```sql
-- @modulo: comercial
```

No es decoración. El guardrail **G3** (`tests/integration/grants.integration.test.ts`)
enumera las funciones del módulo **parseando las migraciones que llevan esta marca**, y
verifica que ninguna sea ejecutable por `anon` ni por `authenticated`. Una migración sin la
marca deja sus funciones fuera del alcance del guardrail: el `REVOKE` faltante no se detecta
y el RPC queda invocable desde PostgREST con el token de cualquier usuario, que es
exactamente lo que el aislamiento por `p_tenant_id` no puede frenar por sí solo.

Es el mismo criterio con el que el guardrail de `tenant_id` deriva las tablas del DDL en vez
de una lista escrita a mano: lo que se sostiene solo es lo que sigue funcionando en la tanda
número doce.
## 1. Qué construir

**Archivos a CREAR:**

1. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.schemas.ts`
2. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.service.ts`
3. `supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts`
4. `tests/unit/fraccionamiento.controller.test.ts`

`fraccionamiento.calculo.ts` ya existe desde C6·T1. **No lo reescribas**: importalo.

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/main.ts` | `app.route("/fraccionamientos", fraccionamientoRouter);` |
| `tests/unit/tenant-filter-guardrail.test.ts` | `"fraccionamiento"` a `MODULOS_COMERCIALES`. |
| `tests/unit/fraccionamiento.service.test.ts` | Los casos del Service. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | **El cierre de C1–C6.** |

## 2. Especificación exacta

### 2.1. `fraccionamiento.schemas.ts`

```ts
export const FraccionarSchema = z.object({
  loteOrigenId:              z.string().uuid(),
  productoDestinoId:         z.string().uuid(),
  cantidadOrigen:            z.number().positive(),
  // La cantidad REALMENTE obtenida, no la teórica. Es entrada del usuario y es
  // el dato que hace que el inventario signifique algo: si el sistema obligara
  // a que rendimiento = factor, la gente falsearía los recuentos para cuadrar
  // (D-06.a).
  cantidadObtenida:          z.number().positive(),
  fechaVencimientoDestino:   z.string().date().nullish(),
  codigoLoteDestino:         z.string().trim().max(80).nullish(),
  // Obligatorio solo si el desvío supera la tolerancia del tenant; eso lo decide
  // el RPC, que es quien conoce la tolerancia. Acá se acepta opcional y se valida
  // la longitud SI viene.
  motivo:                    z.string().trim().min(10).max(500).nullish(),
});

export const ListarFraccionamientosQuerySchema = z.object({
  productoOrigenId:  z.string().uuid().optional(),
  productoDestinoId: z.string().uuid().optional(),
  desde:  z.string().date().optional(),
  hasta:  z.string().date().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});
```

### 2.2. `fraccionamiento.service.ts`

| Método | Qué hace |
|---|---|
| `fraccionar(dto, ctx)` | Llama a `fraccionar_lote`. **No calcula nada**: el rendimiento, el costo y la merma los resuelve el RPC bajo bloqueo. |
| `simular(dto, ctx)` | **Solo lectura, sin escribir nada.** Dado el lote origen, el producto destino y la cantidad de origen, devuelve la cantidad teórica, el vencimiento sugerido y el costo unitario que tendría el hijo con la cantidad obtenida propuesta. Usa `fraccionamiento.calculo.ts`, no el RPC. Es lo que alimenta la pantalla antes de confirmar. |
| `listar(opts, ctx)` | Desde `v_costo_fraccionamiento`, paginado. |
| `costoPorProducto(opts, ctx)` | Merma acumulada y sobrecosto por producto origen, desde `v_costo_fraccionamiento`. |

**`simular` no escribe y no reserva.** Entre la simulación y la confirmación la existencia puede
cambiar, y quien decide es el RPC bajo `FOR UPDATE`. Dejá este comentario:

```ts
// `simular` es informativa: NO reserva existencia y NO garantiza que el
// fraccionamiento vaya a proceder. Entre la simulación y la confirmación puede
// entrar una venta que consuma el lote. La decisión la toma fraccionar_lote,
// bajo bloqueo. Si esta función validara existencia y el RPC confiara en eso,
// sería exactamente el patrón leer-validar-escribir que R-01 describe.
```

`mapFraccionamientoRpcError` cubriendo `CONVERSION_NOT_DEFINED`, `CONVERSION_CYCLE`,
`INVALID_YIELD`, `EXPIRY_AFTER_PARENT`, `REASON_REQUIRED`, `UNIT_NO_DECIMALS`,
`INSUFFICIENT_STOCK`, `BATCH_EXPIRED`, `BATCH_BLOCKED`, `BATCH_NOT_FOUND`,
`PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`. `INTERNAL_ERROR` genérico al final.

**No hay ningún método que revierta un fraccionamiento.** Si te sale escribir `desfraccionar`,
`revertirFraccionamiento` o `deshacerConversion`, pará: RN-FR9. La corrección es un ajuste
motivado, que ya existe desde C5.

### 2.3. Controller y rutas

```ts
// split_stock es un permiso PROPIO: no se deduce de manage_stock. Es una
// operación irreversible con implicancias distintas (§8.1). Lo tienen el admin,
// el veterinario y la recepcionista (§8.2): abrir una caja de comprimidos ocurre
// al atender, no cuando el administrador está disponible. Si se restringe, se
// fracciona igual y se registra mal o no se registra, que es peor.
const sharedMiddleware = [
  tenantContext, requireActiveTenant,
  requireModule("stock"), requirePermission("view_stock"),
];
const splitStock = requirePermission("split_stock");
```

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/fraccionamientos` | `view_stock` |
| GET | `/api/v1/fraccionamientos/costo-por-producto` | `view_stock` |
| POST | `/api/v1/fraccionamientos/simular` | `view_stock` — no escribe nada |
| POST | `/api/v1/fraccionamientos` | **`split_stock`** — 201 |

**No hay `PUT`, `PATCH`, `DELETE` ni ninguna ruta inversa.**

### 2.4. Tests

**`tests/unit/fraccionamiento.service.test.ts`** (agregá a los que ya tenés):

| `it()` | Caso |
|---|---|
| `el Service no calcula el rendimiento ni el costo al fraccionar` | `fraccionar` pasa `p_cantidad_obtenida` tal cual vino del DTO y **no** lo compara contra el factor antes de llamar. Verificalo sobre los argumentos del mock. |
| `simular no escribe nada` | `simular` no llama a `.rpc()`, ni a `.insert()`, ni a `.update()`. |
| `RN-FR9: no existe ningún método de reversión` | `expect(FraccionamientoService.desfraccionar).toBeUndefined()`, ídem `revertir`, `deshacer`. |
| `los errores del RPC se traducen` | `CONVERSION_NOT_DEFINED` → 422 con ese código, no 500. |
| `un error desconocido no filtra el mensaje interno` | Mensaje con nombre de constraint → `INTERNAL_ERROR` 500 sin ese texto. |

**`tests/unit/fraccionamiento.controller.test.ts`** — matriz rol × endpoint:

| Endpoint | admin | veterinario | recepcionista | sin módulo `stock` |
|---|:--:|:--:|:--:|:--:|
| `GET /fraccionamientos` | 200 | 200 | 200 | 403 `MODULE_NOT_LICENSED` |
| `POST /fraccionamientos/simular` | 200 | 200 | 200 | 403 |
| `POST /fraccionamientos` | 201 | **201** | **201** | 403 |
| `GET /fraccionamientos/costo-por-producto` | 200 | 200 | 200 | 403 |

**Acá las celdas interesantes son los 201 del veterinario y de la recepcionista**, no un 403:
`split_stock` lo tienen los tres roles, y el test lo confirma. Agregá además un caso con un rol
al que se le quitó `split_stock` → **403**, para probar que el permiso se está exigiendo de
verdad y no es que el endpoint no valida nada.

Más `RN-SC1` (el `tenantId` del body se ignora) y el test estructural de que no hay rutas
inversas.

## 3. RN que cubre esta tanda

Ninguna RN nueva: C6·T1, T2 y T3 cerraron las trece RN-FR contra la base. Esta tanda completa la
cobertura de aplicación y **cierra el alcance C1–C6**.

| RN | Qué agrega |
|---|---|
| RN-FR9 | El test estructural del lado del Service y del Controller. |
| RN-SC1, SC5, SC7 | El `tenantId` del JWT, la auditoría y la matriz rol × endpoint, con el caso del permiso quitado. |

## 4. Orden de trabajo

1. Tests unitarios primero, en rojo.
2. `fraccionamiento.schemas.ts` → `.service.ts` → `.controller.ts`.
3. Ruta en `main.ts`.
4. `"fraccionamiento"` a `MODULOS_COMERCIALES` en G1.
5. `npm test && npm run typecheck && npm run test:integration` — **todo, no solo lo de esta
   tanda**.
6. **Cerrá `MATRIZ_RN_TESTS_COMERCIAL.md`.** Recorré las 90 filas:
   - 85 tienen que estar en ✅.
   - 5 (RN-CC1…CC5) en `N/A`.
   - **Si alguna quedó en `PENDIENTE`, decilo en el reporte. No la marques ✅.** Un pendiente
     aprobado es deuda invisible, y el prompt de auditoría lo va a encontrar igual.

## 5. Definición de hecho

```bash
# 1. No existe nada inverso, en ninguna capa
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%';"
grep -rniE "desfraccion|reagrupar|revertirFraccion" supabase/functions/api/src/modules/
# → cero filas y sin resultados

# 2. split_stock se exige en la ruta de escritura
grep -n "split_stock" supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts
# → en el POST /fraccionamientos, y NO en los GET

# 3. Los cuatro guardrails, juntos
npx vitest run tests/unit/tenant-filter-guardrail.test.ts tests/unit/audit-modulo-enum.test.ts \
  tests/unit/stock-ledger-guardrail.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → todo passed, 0 skipped. El it.each de cobertura de G1 corre con 8 módulos:
#   productos, proveedores, stock, compras, caja, ventas, ajustes, fraccionamiento

# 4. TODA la suite del módulo
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts
# → "N passed", "0 skipped". Un solo skipped significa que faltan credenciales y
#   que el alcance C1–C6 NO está verificado.

# 5. Recuento de la matriz
grep -c "PENDIENTE" MATRIZ_RN_TESTS_COMERCIAL.md
# → 0 (fuera del encabezado que explica el formato)
grep -c "N/A" MATRIZ_RN_TESTS_COMERCIAL.md
# → 5 filas de RN-CC más las menciones del encabezado
```

**Al terminar esta tanda, corré `prompts_etapas/C6_AUDITORIA.md`.**
## 6. Qué NO hacer

- **No toques ningún archivo fuera de las listas de la sección 1.**
- No refactorices código existente. Si ves algo mejorable, anotalo en el reporte.
- No agregues dependencias.
- No modifiques migraciones ya aplicadas: creá una nueva.
- No modifiques `docs/ESPEC_MODULO_COMERCIAL.md` ni `PLAN_ETAPAS_COMERCIAL.md`.
- No escribas tests E2E de Playwright: están fuera del alcance de este plan.
- Si algo de la spec no se puede implementar como está escrito, **frená y reportá**. No
  improvises una alternativa.

## 7. Reporte final (obligatorio, va al chat)

- Archivos creados y archivos modificados, con ruta completa.
- RN cubiertas, con el resultado exacto de los tests (`N passed`, `M skipped`).
- Qué quedó pendiente.
- Qué contradicción o duda apareció.
