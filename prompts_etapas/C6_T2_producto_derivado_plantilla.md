# ETAPA C6 · TANDA 2/4 — Producto derivado desde plantilla
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C6·T1 en verde, con las dos verificaciones por mutación reportadas.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

> **El catálogo crece, y esta tanda es la mitigación.** Cada fraccionamiento necesita un
> producto destino; a los seis meses hay 400 fichas y nadie encuentra nada. Crear el derivado
> desde la plantilla del padre —copiando familia, alícuota, marca y condición de venta, y
> creando la conversión— en **un solo endpoint** es lo que evita que cada derivado se cargue a
> mano con un criterio distinto.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06.e | La explosión del catálogo y sus tres mitigaciones. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-06.c y §6.8 RN-FR9 | Por qué no existe des-fraccionar. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | Tu Service de C1·T4: `ProductoService.crear` y `ConversionService.crear`, que este endpoint compone. |
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

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `CrearDerivadoSchema`. |
| `supabase/functions/api/src/modules/productos/productos.service.ts` | `ProductoService.crearDerivado`. |
| `supabase/functions/api/src/modules/productos/productos.controller.ts` | `POST /productos/:id/derivado`. |
| `tests/unit/productos.service.test.ts` | Los casos de `crearDerivado` y RN-FR9. |
| `tests/unit/fraccionamiento.service.test.ts` | RN-FR9 como test estructural. |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | RN-FR9. |

**No se crea ninguna migración ni ningún módulo nuevo.** El derivado es un producto normal: lo
único distinto es de dónde salen sus valores por defecto.

## 2. Especificación exacta

### 2.1. `CrearDerivadoSchema`

```ts
/**
 * Alta de un producto derivado desde la plantilla del padre (D-06.e).
 *
 * Lo que se hereda del padre y NO se pide: familia, alícuota de IVA, marca,
 * condición de venta, `trazable`, `requiere_frio`, `es_consumible_clinico`.
 * Heredarlos es la mitigación: si cada derivado se carga a mano, a los seis
 * meses la mitad del catálogo tiene la alícuota mal.
 *
 * Lo que SÍ se pide, porque el derivado no lo comparte con el padre:
 */
export const CrearDerivadoSchema = z.object({
  codigo:                   z.string().trim().min(1).max(50),
  nombre:                   z.string().trim().min(3).max(150),
  unidadMedidaId:           z.string().uuid(),
  factorTeorico:            z.number().positive(),
  mermaEsperadaPorcentaje:  z.number().min(0).max(100).default(0),
  // El precio NO se deriva del factor: el kilo suelto no vale 1/15 de la bolsa
  // de 15 kg, casi siempre vale más. Un factor impondría una relación aritmética
  // entre precios que el negocio no respeta (D-06).
  precioVenta:              z.number().nonnegative().nullish(),
  vidaUtilPostAperturaDias: z.number().int().min(1).max(3650).nullish(),
  stockMinimo:              z.number().nonnegative().nullish(),
  descripcion:              z.string().max(500).nullish(),
});
```

**El precio del derivado no se calcula.** Si el DTO no lo trae, el producto queda con
`precio_venta = NULL` y no es vendible hasta que alguien le ponga precio (RN-PR9). Es
preferible a inventar un precio dividido por el factor, que es exactamente la relación que D-06
descarta.

### 2.2. `ProductoService.crearDerivado(padreId, dto, ctx)`

```
1. Resolver el padre filtrando por tenant. Si no está o está inactivo:
     PRODUCT_NOT_FOUND / PRODUCT_INACTIVE
2. Verificar que la unidad del derivado EXISTE y es distinta de la del padre.
     Si es la misma → VALIDATION_ERROR: "El derivado tiene que tener una unidad
     distinta de la del producto de origen". Un derivado en la misma unidad no
     es una conversión, es un duplicado.
3. Crear el producto, heredando del padre:
     familia_id, alicuota_iva, marca, condicion_venta,
     controla_lote, controla_vencimiento, trazable, requiere_frio,
     es_consumible_clinico
   y tomando del DTO:
     codigo, nombre, descripcion, unidad_medida_id, precio_venta,
     vida_util_post_apertura_dias, stock_minimo
   con es_vendible = true y activo = true.
4. Crear la conversión padre → derivado con factor_teorico y
   merma_esperada_porcentaje del DTO.
5. Auditar UNA VEZ, con module 'products', action 'CREATE', y en new_values
   tanto el producto como la conversión.
```

**Los pasos 3 y 4 tienen que ser atómicos.** Si el `INSERT` de la conversión falla —por ejemplo
por el trigger anti-ciclo—, el producto **no puede quedar creado**: sería una ficha huérfana que
nadie sabe de dónde salió.

Como los dos `INSERT` van por PostgREST y **no hay transacción entre dos llamadas de
supabase-js**, resolvelo así:

```ts
// El producto se crea primero y la conversión después; si la conversión falla,
// el producto recién creado se da de baja lógica y se relanza el error. NO se
// borra: RN-PR2 dice que un producto no se elimina, y además el DELETE podría
// fallar por una FK y dejar el estado peor.
//
// Es el mismo criterio del "rollback a mano" que usa el alta de usuarios cuando
// falla el INSERT en `usuarios` después de crear la cuenta de Auth.
```

Si al escribirlo te parece que esto pide un RPC, tenés razón — pero **no lo escribas en esta
tanda**: cambiar el alta de productos a un RPC afecta a C1·T4 y sale del alcance. Anotalo en el
reporte como mejora propuesta.

### 2.3. Endpoint

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/v1/productos/:id/derivado` | `manage_products` — 201 |

Errores: `404 PRODUCT_NOT_FOUND`, `422 PRODUCT_INACTIVE`, `409 PRODUCT_CODE_DUPLICATE`,
`409 PRODUCT_NAME_DUPLICATE`, `409 CONVERSION_CYCLE`, `422 VALIDATION_ERROR`.

### 2.4. RN-FR9 — que no exista la conversión inversa

**No es una funcionalidad: es la ausencia de una.** Se prueba de tres formas, y las tres van:

| `it()` | Caso |
|---|---|
| `RN-FR9: no existe ningún RPC de des-fraccionamiento` | En `fraccionamiento.service.test.ts`, un test que consulta las funciones de la base (o, si el test es unit, que revisa las migraciones): ninguna se llama `desfraccionar`, `reagrupar`, `unir_lote` ni similar. |
| `RN-FR9: no existe ninguna ruta que genere una conversión inversa` | Recorré los routers registrados y verificá que no hay ningún endpoint cuyo handler llame a `fraccionar_lote` con origen y destino invertidos, ni ningún `POST` con "desfraccionar" en la ruta. Un `grep` sobre `src/modules/` alcanza y se escribe como test. |
| `RN-FR9: registrar la relación inversa falla por el anti-ciclo` | Con la conversión A→B creada por `crearDerivado`, intentar crear B→A → falla con `CONVERSION_CYCLE`. **Este es el que importa**: aunque alguien escribiera el endpoint, la base no lo dejaría cargar la relación que lo haría posible. |

El tercer caso es la razón por la que el trigger anti-ciclo de C1·T3 vale la pena: RN-FR9 no
depende de que nadie escriba el endpoint, depende de que la base no admita el grafo que lo
habilitaría.

### 2.5. Otros tests

| `it()` | Caso |
|---|---|
| `el derivado hereda familia, alícuota, marca y condición de venta` | Padre con `familia_id = F`, `alicuota_iva = 10.5`, `marca = "X"`, `condicion_venta = 'bajo_receta'` → el derivado sale con los cuatro valores, aunque el DTO no los mande. |
| `el derivado NO hereda el precio` | Padre con `precio_venta = 45000` y DTO sin precio → el derivado queda con `precio_venta = NULL`. El kilo suelto no vale 1/15 de la bolsa. |
| `la conversión se crea con el factor del DTO` | `factorTeorico: 15` → la fila de `producto_conversiones` queda con `15.0000`. |
| `si la conversión falla, el producto queda inactivo` | Mock donde el `INSERT` de la conversión devuelve el error del anti-ciclo → el producto se dio de baja lógica y el error que sale es `CONVERSION_CYCLE`, no `INTERNAL_ERROR`. |
| `un derivado con la misma unidad que el padre se rechaza` | `unidadMedidaId` igual al del padre → `VALIDATION_ERROR`. |
| `RN-SC5: el alta del derivado deja un solo asiento` | `recordAudit` se llamó **una** vez, con `module: "products"`. |

## 3. RN que cubre esta tanda

| RN | Enunciado | `it()` |
|---|---|---|
| RN-FR9 | No existe la conversión inversa: ni RPC, ni endpoint, ni permiso, y la relación inversa falla por el anti-ciclo. → `422 CONVERSION_REVERSE_NOT_ALLOWED` | Los tres `it('RN-FR9: …')` de 2.4 |

## 4. Orden de trabajo

1. Tests primero, en rojo.
2. `CrearDerivadoSchema` → `crearDerivado` → el endpoint.
3. Los tres tests de RN-FR9.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. No existe nada que des-fraccione
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc
  WHERE proname ILIKE '%desfraccion%' OR proname ILIKE '%reagrupar%' OR proname ILIKE '%unir_lote%';"
# → cero filas
grep -rniE "desfraccion|reagrupar|des-fraccion" supabase/functions/api/src/modules/
# → sin resultados, salvo comentarios que expliquen por qué no existe

# 2. El derivado no hereda el precio
grep -n -A20 "crearDerivado" supabase/functions/api/src/modules/productos/productos.service.ts | grep -n "precio_venta"
# → precio_venta sale del DTO, NUNCA del padre ni de una división por el factor

# 3. Tests
npx vitest run tests/unit/productos.service.test.ts tests/unit/fraccionamiento.service.test.ts
npm test && npm run typecheck
# → todo passed, 0 skipped
```
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
