# ETAPA C3 · TANDA 1/3 — Migración de caja y tests de base
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** C2 completa, aprobada por `C2_AUDITORIA.md`, y los cuatro guardrails en
> verde.
> **Reglas siempre activas:** `.agents/rules/modulo-comercial.md`.

## 0. Leé estos archivos antes de escribir código

| Archivo | Qué buscar |
|---|---|
| `docs/ESPEC_MODULO_COMERCIAL.md` §4.8 | `cajas`, `sesiones_caja`, `movimientos_caja` y el índice parcial único. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §2 D-07 y D-08 | El cierre irreversible y por qué solo el efectivo afecta el arqueo. |
| `docs/ESPEC_MODULO_COMERCIAL.md` §6.7 | RN-CJ1…CJ9. |
| `supabase/migrations/20260908000001_comercial_libro_mayor.sql` | Tu propia migración de C2·T1: el trigger de inmutabilidad que vas a replicar para `movimientos_caja`. |
| `supabase/migrations/20260614000002_tables.sql` | El índice `uq_servicios_tenant_nombre` — es el precedente de índice parcial único del repo. |
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

1. `supabase/migrations/20260915000001_comercial_caja.sql`
2. `tests/integration/caja.integration.test.ts`

**Archivos a MODIFICAR:**

| Archivo | Qué se le agrega |
|---|---|
| `tests/integration/rls.test.ts` | Aislamiento de las tres tablas de caja (RN-SC4). |
| `MATRIZ_RN_TESTS_COMERCIAL.md` | La parte de RN-CJ4 que la base hace cumplir. |

## 2. Especificación exacta

### 2.1. `cajas`

```
id, tenant_id, nombre TEXT NOT NULL, activa BOOLEAN NOT NULL DEFAULT true, created_at
```
- `CREATE UNIQUE INDEX uq_cajas_tenant_nombre ON cajas (tenant_id, lower(nombre));`
- `ALTER TABLE cajas ADD CONSTRAINT cajas_id_tenant_key UNIQUE (id, tenant_id);`

Una clínica chica tiene una fila. La tabla existe para no tener que inventarla cuando abran el
segundo mostrador.

**Seed:** `on_tenant_created()` **no se toca**. La caja principal la crea el Service la primera
vez que se abre una sesión y no hay ninguna (ver C3·T3). Motivo: agregar un `INSERT` a
`on_tenant_created()` obligaría a un backfill de todos los tenants existentes, y una caja sin
sesiones no le sirve a nadie.

### 2.2. `sesiones_caja`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `tenant_id` | | |
| `caja_id` | `UUID NOT NULL` | FK compuesta → `cajas`, `ON DELETE RESTRICT`. |
| `estado` | `estado_sesion_caja NOT NULL DEFAULT 'abierta'` | |
| `apertura_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `apertura_usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `saldo_inicial` | `NUMERIC(14,2) NOT NULL CHECK (saldo_inicial >= 0)` | |
| `cierre_at` | `TIMESTAMPTZ NULL` | |
| `cierre_usuario_id` | `UUID NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `saldo_teorico_efectivo` | `NUMERIC(14,2) NULL` | Calculado y **congelado** al cerrar. |
| `efectivo_contado` | `NUMERIC(14,2) NULL` | Lo declarado por el usuario. |
| `diferencia` | `NUMERIC(14,2) NULL` | `efectivo_contado − saldo_teorico_efectivo`. **Se guarda siempre, incluso en cero.** |
| `motivo_diferencia`, `observaciones` | `TEXT NULL` | |
| `created_at` | | |

```sql
ALTER TABLE sesiones_caja ADD CONSTRAINT sesiones_caja_id_tenant_key UNIQUE (id, tenant_id);

-- RN-CJ4: una sola sesión abierta por caja, garantizado EN LA BASE y no en el
-- Service. Un chequeo previo en TypeScript deja una ventana entre el SELECT y el
-- INSERT: dos aperturas simultáneas ven "no hay ninguna abierta" y las dos
-- insertan. Este índice parcial único cierra esa ventana. Mismo recurso que
-- uq_servicios_tenant_nombre.
CREATE UNIQUE INDEX uq_sesion_caja_abierta
  ON sesiones_caja (tenant_id, caja_id) WHERE estado = 'abierta';

CREATE INDEX idx_sesiones_caja_tenant ON sesiones_caja (tenant_id, apertura_at DESC);

-- El cierre completa cuatro columnas de una: o están las cuatro o no está ninguna.
-- Una sesión cerrada sin `diferencia` es exactamente el caso que RN-CJ6 prohíbe.
ALTER TABLE sesiones_caja ADD CONSTRAINT chk_sesion_cierre_completo CHECK (
  (estado = 'abierta' AND cierre_at IS NULL AND saldo_teorico_efectivo IS NULL
                      AND efectivo_contado IS NULL AND diferencia IS NULL)
  OR
  (estado = 'cerrada' AND cierre_at IS NOT NULL AND saldo_teorico_efectivo IS NOT NULL
                      AND efectivo_contado IS NOT NULL AND diferencia IS NOT NULL)
);
```

**El `CHECK` de cierre completo es RN-CJ6 escrita en la base.** Registrar el cero distingue
*"se arqueó y dio bien"* de *"no se arqueó"*, y un `NULL` no distingue nada.

### 2.3. `movimientos_caja` — libro mayor del efectivo

```
id, tenant_id,
sesion_caja_id  UUID NOT NULL,   -- FK compuesta → sesiones_caja, ON DELETE RESTRICT
tipo            tipo_movimiento_caja NOT NULL,
medio_pago_id   UUID NOT NULL REFERENCES medios_pago(id) ON DELETE RESTRICT,
importe         NUMERIC(14,2) NOT NULL CHECK (importe > 0),
venta_id        UUID NULL,       -- sin FK: `ventas` llega en C4·T1
compra_id       UUID NULL,       -- FK compuesta → compras, ON DELETE RESTRICT
motivo          TEXT NULL,
usuario_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
created_at
```

- `ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_id_tenant_key UNIQUE (id, tenant_id);`
- `CREATE INDEX idx_mov_caja_sesion ON movimientos_caja (tenant_id, sesion_caja_id, created_at);`
- **Sin `updated_at`**: append-only, igual que `movimientos_stock`.

**`signo_movimiento_caja()`**, mismo criterio que la de stock:

```sql
CREATE OR REPLACE FUNCTION public.signo_movimiento_caja(p_tipo tipo_movimiento_caja)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_tipo IN ('ingreso_venta','ingreso_cobro_cuenta_corriente','ingreso_manual')
              THEN 1 ELSE -1 END;
$$;

REVOKE ALL ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signo_movimiento_caja(tipo_movimiento_caja) TO service_role;
```

Tres tipos son ingreso; cuatro son egreso. Contá los siete del ENUM.

**Trigger de inmutabilidad**, calcado del de `movimientos_stock`:

```sql
CREATE OR REPLACE FUNCTION public.movimientos_caja_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Mismo criterio que movimientos_stock: los Services escriben con service_role,
  -- que sí podría actualizar. Este trigger es la única capa que frena al camino
  -- real de escritura.
  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_movimientos_caja_inmutable
  BEFORE UPDATE OR DELETE ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_inmutable();

REVOKE ALL ON FUNCTION public.movimientos_caja_inmutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.movimientos_caja_inmutable() TO service_role;
```

**No hay trigger de caché en caja.** El saldo teórico se calcula sumando bajo el `FOR UPDATE`
de la sesión al cerrar (C3·T2): una sesión tiene decenas de movimientos, no miles, y no
justifica una tabla derivada más.

### 2.4. RLS

Las tres tablas, `FOR SELECT` con `tiene_permiso('manage_cash')`. Sin `FORCE`, sin políticas de
escritura, sin `GRANT`.

### 2.5. `tests/integration/caja.integration.test.ts`

| `it()` | Caso |
|---|---|
| `RN-CJ4: el índice parcial rechaza la segunda sesión abierta` | Insertar una sesión `abierta` en la caja X, insertar otra `abierta` en la misma caja → falla (`23505`). Cerrar la primera e insertar la segunda → funciona. **Y con otra caja del mismo tenant** → funciona: el índice es por `(tenant_id, caja_id)`, no por tenant. |
| `RN-CJ6: una sesión cerrada sin diferencia no es válida` | `UPDATE` de una sesión a `estado='cerrada'` con `diferencia = NULL` → viola `chk_sesion_cierre_completo`. |
| `un movimiento de caja no se puede actualizar ni borrar` | `serviceDb.from("movimientos_caja").update(…)` → `MOVEMENT_IMMUTABLE`. Ídem `.delete()`. Los dos casos. |
| `el signo lo determina el tipo` | `signo_movimiento_caja('ingreso_venta')` → 1. `signo_movimiento_caja('egreso_retiro')` → −1. |
| `RN-SC2: una sesión de A no puede colgar de una caja de B` | FK compuesta: falla con `23503`. |

**RN-CJ4 se cierra en dos tandas.** Acá se prueba que **la base** rechaza la segunda fila; en
C3·T2 se prueba que **dos aperturas simultáneas** producen exactamente una ganadora. Son cosas
distintas: la primera puede pasar y la segunda fallar si el RPC atrapa el `23505` y reintenta.
En la matriz, RN-CJ4 queda `PENDIENTE` hasta T2.

## 3. RN que cubre esta tanda

| RN | Enunciado en una línea | `it()` a escribir |
|---|---|---|
| RN-CJ4 (parcial) | Una sola sesión abierta por caja, garantizado por índice único parcial. → `409 CASH_SESSION_ALREADY_OPEN` | `it('RN-CJ4: el índice parcial rechaza la segunda sesión abierta', …)` |
| RN-CJ6 (parcial) | La diferencia se registra siempre, incluso en cero. | `it('RN-CJ6: una sesión cerrada sin diferencia no es válida', …)` |
| RN-SC4 | Aislamiento por RLS de las tres tablas nuevas. **Bloqueante.** | Tres `it('RN-SC4: …')` en `rls.test.ts` |

## 4. Orden de trabajo

1. Migración con marca, aplicada.
2. Tests. Verificá por mutación el índice parcial único: sacalo, confirmá que el test se pone
   rojo, volvé a ponerlo. Reportá el mensaje.
3. `rls.test.ts` extendido.
4. `npm test && npm run typecheck && npm run test:integration`.
5. Matriz.

## 5. Definición de hecho

```bash
# 1. El índice parcial único existe y es PARCIAL
psql "$DATABASE_URL" -c "SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='sesiones_caja' AND indexname='uq_sesion_caja_abierta';"
# → el indexdef tiene que terminar en: WHERE (estado = 'abierta'::estado_sesion_caja)
#   Si NO tiene el WHERE, el índice impide una segunda sesión CERRADA en la misma
#   caja, que es un bug que aparece el segundo día de uso.

# 2. signo_movimiento_caja es IMMUTABLE
psql "$DATABASE_URL" -c "SELECT provolatile FROM pg_proc WHERE proname='signo_movimiento_caja';"
# → i

# 3. El trigger de inmutabilidad cubre UPDATE y DELETE
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger
  WHERE tgrelid='movimientos_caja'::regclass AND NOT tgisinternal;"
# → trg_movimientos_caja_inmutable

# 4. Solo políticas de SELECT
psql "$DATABASE_URL" -c "SELECT tablename, cmd FROM pg_policies
  WHERE tablename IN ('cajas','sesiones_caja','movimientos_caja');"
# → solo SELECT

# 5. Tests
npx vitest run --config vitest.integration.config.ts \
  tests/integration/caja.integration.test.ts tests/integration/rls.test.ts
# → "N passed", "0 skipped"

# 6. Suites completas y guardrails
npm test && npm run typecheck
npx vitest run --config vitest.integration.config.ts tests/integration/grants.integration.test.ts
# → el it.each de G3 incluye signo_movimiento_caja y movimientos_caja_inmutable
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
