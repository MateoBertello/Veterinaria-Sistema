# Reglas de ejecución — Módulo Comercial · VeterCor

**Activación: Always On.** Ubicación: `.agents/rules/modulo-comercial.md`

---

## 1. Tu rol

Implementás una tanda acotada de trabajo definida por un prompt de ejecución. **No diseñás.**
Las decisiones de diseño ya están tomadas en `ESPEC_MODULO_COMERCIAL.md` y el corte del trabajo
en `PLAN_ETAPAS_COMERCIAL.md`. Tu trabajo es traducirlas a código correcto.

**Cada etapa la audita otro modelo después.** Un atajo tuyo aparece en esa auditoría. Es más
barato frenar y preguntar que hacer algo plausible.

## 2. Frená y reportá — no improvises

Detené el trabajo y escribí en el chat qué encontraste si:

- La spec no cubre un caso que necesitás resolver.
- La spec contradice al repo, o a sí misma.
- El prompt te pide tocar un archivo que no está en su lista.
- Un test falla y la causa no está en el código que escribiste en esta tanda.
- Necesitarías una dependencia nueva.
- Una migración ya aplicada tendría que cambiar.

**Nunca inventes una alternativa razonable.** En este módulo lo razonable suele ser lo
incorrecto: la mitad de las reglas existen justamente porque la solución intuitiva rompe algo.

## 3. Aislamiento por tenant — la regla que más importa

Los Services escriben con `getServiceDb()`, que usa `service_role` y **bypasea RLS**.

**Toda consulta lleva `.eq('tenant_id', tenantId)`. Sin excepción.**

Una consulta sin ese filtro devuelve datos de todos los tenants y **no da ningún error**: no
falla el test, no salta una excepción, no queda un log. Es el defecto más grave que podés
introducir y el más fácil de no ver.

- El `tenantId` sale de `ctx.tenantId`, que el middleware `tenantContext` obtiene del JWT.
- **Ningún handler lee `tenant_id` de body, query o params.** Si llega, se ignora.
- `getDb(authHeader)` es solo para lectura en middlewares. No lo uses para escribir.

## 4. RPC de PostgreSQL

Patrón obligatorio, copiado de `supabase/migrations/20260623000002_registrar_eutanasia_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION public.<nombre>(p_tenant_id UUID, p_usuario_id UUID, ...)
RETURNS TABLE (...)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ ... $$;

REVOKE ALL ON FUNCTION public.<nombre>(<tipos>) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.<nombre>(<tipos>) TO service_role;
NOTIFY pgrst, 'reload schema';
```

- `p_tenant_id` es el primer parámetro y **se filtra en cada lectura y escritura del cuerpo**.
  `SECURITY DEFINER` no aplica RLS: el filtro explícito es el único aislamiento.
- Errores de negocio: `RAISE EXCEPTION '<ERROR_CODE>';` con el código exacto del enum. El
  Service lo mapea a `DomainError`.
- **`NOTIFY pgrst, 'reload schema';` al final de toda migración que cree o cambie un RPC.** Sin
  eso PostgREST sirve la firma vieja desde caché y el síntoma engaña: dice que la función no
  existe aunque la migración se aplicó.
- El `GRANT`/`REVOKE` va con la **lista de tipos exacta**: si cambia la firma, hay que
  repetirlo.

### Descuento de existencias

Toda salida de stock va por RPC, nunca desde el Service:

```sql
SELECT ... FROM existencias_lote
 WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes)
 ORDER BY lote_id
   FOR UPDATE;
```

- **`ORDER BY lote_id` no es estilo.** Sin orden determinístico, dos operaciones que tocan los
  mismos lotes en distinto orden se bloquean mutuamente y una muere por deadlock.
- El Service **nunca** lee existencias para decidir. Leer-validar-escribir desde TypeScript
  sobrevende bajo concurrencia y funciona perfecto en desarrollo.

## 5. Auditoría — el modo de falla silenciosa

Toda escritura deja asiento. Desde el Service con `recordAudit()`; **dentro del RPC** con
`INSERT INTO registros_auditoria` para operaciones transaccionales.

Cuando agregues un valor de módulo de auditoría, va **en los dos lugares**:

1. El ENUM `modulo_auditoria` (migración).
2. El tipo `AuditModule` en `supabase/functions/api/src/shared/audit.ts`.

Si falta en el tipo, el typecheck te frena. **Si falta en el ENUM, `recordAudit` loguea el
error en consola y sigue**, y todas las escrituras pierden su asiento sin que ningún test se
ponga en rojo. Ya pasó una vez en este repo.

`action` es mayúsculas y del conjunto existente: `CREATE`, `UPDATE`, `DELETE`, `CANCEL`,
`LOGIN`, `LOGOUT`, `VIEW`, `EXPORT`. No inventes acciones.

## 6. Capas y convenciones

- **Controller** (ruta Hono): valida con Zod, resuelve auth y permiso, delega, serializa.
  **No contiene reglas de negocio.**
- **Service**: reglas RN-xx, única capa que toca la base. Mapea snake_case ↔ camelCase.
- Patrón a copiar: `supabase/functions/api/src/modules/servicios/`.
- Rutas: `/api/v1`, sustantivos en plural y en español.
- Toda ruta del módulo pasa por `requireModule(...)` y `requirePermission(...)`.

**Envelope, siempre:**
`ok(data, meta?)` y `fail(code, message, statusCode, details)` de `shared/envelope.ts`.

**ErrorCode:** salen del enum central de `shared/errors.ts`. **No inventes códigos.** Si falta
uno, frená y reportalo: la spec ya lista los que hacen falta.

**DB:** `snake_case`, **nombres de tabla en plural sin excepción** (`productos`,
`lotes`, `movimientos_stock`, `existencias_lote`, `ventas_items`), nombres de columna en
español para las tablas nuevas, `TIMESTAMPTZ
DEFAULT now()`, FKs con `ON DELETE` explícito, índice en `tenant_id` y en las columnas de
búsqueda.

**Migraciones:** `AAAAMMDD` + secuencia de 6 dígitos. **Nunca edites una ya aplicada**: creá
una nueva.

## 7. Trampas específicas de este módulo

**`ALTER TYPE ... ADD VALUE` va en archivo de migración separado** del que crea las tablas que
usan el tipo. Un valor nuevo no se puede usar en la misma transacción en la que se agregó.

**Las FKs son compuestas `(id, tenant_id)`.** El lado referenciado necesita su
`UNIQUE (id, tenant_id)`. Consecuencia: los embeds de PostgREST que nombran una columna dejan
de funcionar y hay que **embeber por nombre de constraint**
(`tabla!nombre_constraint(campos)`). Patrón: `usuarios_rol_tenant_fkey` en
`20260725000005_usuarios_integridad_referencial.sql`.

**RLS de tablas nuevas: `ENABLE`, sin `FORCE`.** Política **solo de `SELECT`**, con
`auth.uid() IS NOT NULL AND tenant_id = current_tenant_id() AND usuario_activo() AND
tiene_permiso('<permiso>')`. **No crees políticas de escritura**: `authenticated` no tiene
`INSERT/UPDATE/DELETE` desde el hardening, y toda escritura pasa por la Edge Function.
**No agregues `GRANT`**: `ALTER DEFAULT PRIVILEGES` ya cubre las tablas nuevas.

**`signo_movimiento()` tiene que ser `IMMUTABLE`**, porque una columna generada la usa.
Marcarla `STABLE` hace fallar la migración. Y como toda función nueva, necesita su
`REVOKE`/`GRANT`: desde `20260710000001` las funciones no nacen ejecutables por `PUBLIC`.

**Dinero y cantidades: `NUMERIC` con precisión explícita. Nunca `float`.**
Cantidades `NUMERIC(14,3)`, importes `NUMERIC(14,2)`, costos unitarios `NUMERIC(14,4)`.
Los costos llevan 4 decimales a propósito: son cocientes y redondearlos acumula error.

**IVA por línea, calculado por diferencia:**
`neto = round(precio / (1 + alicuota/100), 2)` y luego `iva = precio - neto`.
Nunca calcules los dos por separado: redondear ambos da un centavo de más en algunos casos y
el total del ticket deja de cuadrar con sus líneas.

**Nada se borra ni se edita.** Los movimientos del libro mayor son inmutables. Un error se
compensa con un asiento nuevo con motivo, nunca con un `UPDATE` o un `DELETE`.

**El costo efectivo se guarda en el movimiento, no se recalcula.** Ningún reporte deriva el
costo desde `productos.costo_reposicion`.

## 8. Tests

**El test se escribe antes que la implementación y se corre para verlo fallar.** Un test que
nunca estuvo en rojo no prueba que la regla se cumple: prueba que el test se ejecuta. Si escribís
el test después y pasa a la primera, borralo mentalmente y preguntate qué habría pasado sin el
código: si igual pasaría, está mal escrito.

- Nombre del test = código de la RN: `it('RN-MV2: un movimiento no se puede actualizar → MOVEMENT_IMMUTABLE')`.
- Unit en `tests/unit/<modulo>.service.test.ts`; integración en `tests/integration/<modulo>.integration.test.ts`.
- Las reglas que dicen "**la base rechaza X**" se prueban **contra la base**, no revisando el
  código fuente. El cliente `service_role` de los tests puede intentar la operación prohibida
  y recibir el error del trigger:
  ```ts
  const { error } = await serviceDb.from("movimientos_stock")
    .update({ cantidad: 999 }).eq("id", id);
  expect(error?.message).toMatch(/MOVEMENT_IMMUTABLE/);
  ```
- Los tests concurrentes copian `tests/integration/guarderia.integration.test.ts`, **incluido
  el guard `rpcReallyRan()`**: sin él, un RPC inexistente da falso verde.
- Los tests de aislamiento entre tenants son **bloqueantes**: ninguna tanda se entrega con
  `tests/integration/rls.test.ts` en rojo.

## 9. Antes de dar por terminada la tanda

```
npm test            # SOLO unit
npm run typecheck   # tsc sobre API y web
npm run test:integration   # si la tanda toca la base
```

**`npm test` no corre los tests de integración.** Y sin credenciales, la suite de integración
se marca `skipped`: no da rojo, pero tampoco probó nada. Las reglas que dicen "la base rechaza
X" viven todas ahí.

Por eso, si tu tanda tiene tests de integración, **contá los `passed` de los archivos que
escribiste** y ponelos en el reporte: `12 passed` de tu archivo, no "la suite en verde".
Si dice `skipped`, la tanda no está terminada: faltan credenciales y hay que decirlo.

Agregá las filas de las RN cubiertas a `MATRIZ_RN_TESTS_COMERCIAL.md` con el archivo de test
real, no con el previsto.

## 10. Prohibiciones

- No toques archivos fuera de la lista del prompt de ejecución.
- No refactorices código existente que funciona. Si ves algo mejorable, anotalo en el reporte.
- No agregues dependencias.
- No modifiques `ESPEC_MODULO_COMERCIAL.md` ni nada de `/docs`.
- No modifiques migraciones ya aplicadas.
- No inventes `ErrorCode`, valores de ENUM, permisos ni nombres de tabla.
- No integres con SIGTRAZAVET ni con facturación electrónica: la spec reserva columnas, no
  construye puentes.
- No crees endpoints que reviertan operaciones irreversibles: no hay des-fraccionar, no hay
  reapertura de caja, no hay borrado de movimientos.

## 11. Reporte final (obligatorio)

Al terminar, escribí en el chat:

1. Archivos creados y modificados, con ruta.
2. RN cubiertas y resultado de `npm test` y `npm run typecheck`.
3. Qué quedó pendiente, si algo quedó.
4. Qué contradicción, duda o cosa mejorable encontraste y no tocaste.

El punto 4 no es opcional ni es relleno: es lo que lee el auditor de la etapa.
