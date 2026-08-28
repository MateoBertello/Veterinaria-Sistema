# Aislamiento por tenant: A3 corregido, test bloqueante del camino real, y propuesta sobre A2

Etapa: aislamiento por tenant. Este PR **no** migra los 14 services a `getDb()` — la sección
"A2" de abajo es la evaluación pedida, para decidir con los números a la vista.

---

## 1. A3 — consultas con service role sin filtro de tenant

Las cuatro consultas señaladas, más una quinta del mismo tipo que apareció al revisar el archivo.
Ninguna de las cuatro originales era una fuga confirmada; la quinta **sí** lo era.

| Sitio | Qué pasaba | Arreglo |
|---|---|---|
| `servicios.service.ts` — guard RN-SV3 | Contaba turnos futuros por `servicio_id` + fecha sin `tenant_id`. `turnos.servicio_id` referencia `servicios(id)` a secas, así que un turno de otra clínica podía apuntar al mismo servicio: bloqueaba la baja acá y de paso confirmaba su existencia. | `+ .eq("tenant_id", ctx.tenantId)` |
| `usuarios.service.ts` — guard LAST_ADMIN | Leía `roles` por id sin `tenant_id`, y `roles` es una tabla **por tenant** (`UNIQUE (tenant_id, name)`). El nombre del rol decide si aplica `LAST_ADMIN`. | `+ .eq("tenant_id", ctx.tenantId)` |
| `notificaciones.service.ts` ×2 | `UPDATE notificaciones SET estado=… WHERE id=…` sin `tenant_id`. El id venía del INSERT de arriba, pero el alcance de un UPDATE con service role es el que escribe la query. | `+ .eq("tenant_id", tenantId)` |
| `auth.service.ts` — `recuperarUsuario` | `.single()` sobre `email_ci`. La unicidad del esquema es `UNIQUE (tenant_id, email)`: dos clínicas **pueden** tener el mismo email; lo que hoy lo evita es GoTrue, no la tabla. Con dos filas, PostgREST devolvía error y el pedido se descartaba **en silencio** — el usuario legítimo se quedaba sin recuperar su cuenta. Es la forma del bug DT-19 ya resuelto en el login. | `.single()` → `.limit(10)` + manejo explícito de varias filas. La búsqueda sigue siendo cross-tenant a propósito (el endpoint es público, no hay tenant en contexto) y eso quedó documentado en el código. |

### Extra: una fuga confirmada en el mismo archivo

`usuarios.service.ts — editar()` escribía `usuarios.rol_id` **con el `roleId` que llega en el body,
sin validar que el rol fuera del tenant**. `crear()` sí lo validaba (con el comentario explicando
por qué); `editar()` no. Como `usuarios.rol_id → roles(id)` no lleva el tenant en la FK y la
consulta corre con service role, el id de un rol de otra clínica entraba sin que nada dijera nada.
Y como los permisos se resuelven desde el rol, era un camino de **escalada cross-tenant**.

Es la misma clase de defecto que A3 y una corrección de una línea en el mismo archivo, así que se
incluyó. Se valida igual que en `crear()` (antes de tocar Auth) y el paso 5 reutiliza el rol ya
resuelto, lo que además elimina una segunda consulta que tampoco filtraba por tenant.

### Cobertura

Tests unitarios nuevos, verificados en rojo contra el código sin arreglar:

- `servicios.service.test.ts` — *A3 — RN-SV3: el guard de turnos futuros filtra por `tenant_id`*
- `usuarios.service.test.ts` — *A3 — editar con un `roleId` de otra clínica → `VALIDATION_ERROR`*
- `auth.service.test.ts` — *dos tenants con el mismo email resuelven sin error* + *la búsqueda por
  email es cross-tenant a propósito*

Las dos escrituras de `notificaciones` no tienen unitario propio: no producen diferencia observable
(el id ya es del tenant) y el valor está en el alcance de la query, no en el comportamiento. Quedan
cubiertas por el filtro explícito y su comentario.

---

## 2. Test de aislamiento del camino real (bloqueante)

**`tests/integration/aislamiento-api.integration.test.ts`** — nuevo.

El problema que resuelve: `tests/integration/rls.test.ts` le pega a PostgREST con el JWT de cada
tenant, así que valida las **políticas RLS de la base**. Pero los datos de negocio no pasan por ahí:
pasan por la Edge Function, donde 14 de 17 services abren la conexión con `getServiceDb()`. El test
que el CLAUDE.md declara bloqueante desde la Etapa 1 no cubría el camino real.

Esta suite monta el app de Hono in-process y ejerce **HTTP → controller → service → DB**:

- **Lectura** — 12 endpoints de detalle de A pedidos con el JWT de B; los listados de B (clientes,
  mascotas, servicios, doctores, usuarios, turnos, estadías, auditoría, roles) buscando el id de A
  en el JSON crudo; y el cálculo de slots contra el doctor y el servicio de A.
- **Escritura** — 27 intentos de B sobre entidades de A: editar/borrar cliente y mascota,
  fallecimiento, cambio de dueño (con destino de B **y** con destino válido de A, para descartar
  que el rechazo venga del chequeo del destino), evento clínico, eutanasia, las cuatro operaciones
  de plan de vacunación, servicios, los cuatro caminos de turnos, los cuatro de guardería, doctor,
  franjas horarias y usuario.
- **Regresiones A3** — el guard RN-SV3 con un turno de B apuntando a un servicio de A; `LAST_ADMIN`
  resolviendo el rol del propio tenant; recuperación de usuario con el email repetido en dos tenants.

Tres decisiones que hacen que el verde signifique algo:

1. **Los dos tenants son `premium` y sus usuarios `admin`.** Si no, un `403 MODULE_NOT_LICENSED` o un
   403 por permiso daría verde sin haber probado el aislamiento. `verificarMotivo()` rechaza
   explícitamente los verdes por el motivo equivocado: `MODULE_NOT_LICENSED`, `VALIDATION_ERROR`
   (lo frenó Zod antes del Service) y cualquier 5xx (explotó antes de llegar al control).
2. **El status no alcanza.** Se toma una foto con service role de las 10 tablas de negocio de A
   antes y después de la tanda de escrituras y se comparan. Un endpoint que escribiera y *después*
   respondiera 404 seguiría siendo una fuga; la comparación corre **primero**, porque es el caso
   que más fácil se pasa por alto.
3. **El fixture falla ruidosamente.** Si algún id sale vacío, `provisionTenant` tira. Sin eso, un id
   faltante produce pedidos a `/historial/undefined`, la API responde 4xx/5xx y el test lo cuenta
   como "aislamiento OK" — verde que no prueba nada. Pasó de verdad durante el desarrollo de esta
   suite y por eso está la guarda.

**Validación por mutación** (los tres caminos de detección se comprobaron rompiendo el código a
propósito y confirmando el rojo, después restaurando):

| Mutación | Qué reportó |
|---|---|
| Quitar `.eq("tenant_id")` de `mascotas.obtenerPorId` | `entidades de A legibles con el JWT de B: [ 'mascota → 200' ]` |
| Quitar el filtro del SELECT y del UPDATE de `clientes.editar` | `escrituras de B que la API aceptó sobre datos de A: [ 'editar cliente → 200' ]` |
| Escritura silenciosa sobre `clientes` de A sin cambiar el status | `los pedidos de B modificaron 'clientes' del tenant A` |

**Nota sobre el teardown.** Es la primera suite que siembra el grafo completo de entidades a la vez,
y ahí el `DELETE FROM tenants` no alcanza: varias FKs entre esas tablas son `ON DELETE RESTRICT`
(`turnos.client_id`, `estadias.client_id`, `historial_clinico.professional_id`) y RESTRICT se chequea
de inmediato, no al final de la sentencia, así que el cascade sobre `clientes` choca contra el
RESTRICT de `turnos` y el borrado falla entero — dejando cuentas de Auth huérfanas que rompen la
corrida siguiente por email repetido. La suite borra explícitamente en orden hijo→padre y, al
provisionar, limpia los residuos de una corrida anterior. **Las demás suites de integración tienen la
misma fragilidad latente**; no se tocaron (fuera de alcance), pero conviene saberlo.

---

## 3. A2 — evaluación de migrar los 14 services a `getDb()`

**Recomendación: no migrar.** No es un refactor; es deshacer una decisión de seguridad ya tomada,
migrada y testeada. Los números:

### Qué se rompe, concretamente

1. **Todas las escrituras, de una.** `20260725000003_hardening_authenticated_rls.sql:48` hace
   `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM authenticated`. Bajo `getDb()`
   el rol efectivo es `authenticated`: cada INSERT/UPDATE/DELETE de los Services devolvería
   permission denied. Migrar exige **revertir ese REVOKE**, y ese REVOKE es justamente lo que impide
   que un JWT robado escriba directo contra PostgREST salteando la Edge Function
   (`hardening-authenticated.integration.test.ts` lo prueba: auto-asignarse permisos, borrar la
   auditoría, revertir una eutanasia). El saldo es negativo: hoy la API es el único camino de
   escritura; después, PostgREST también lo sería.

2. **Las 9 RPCs quedan afuera.** `registrar_eutanasia`, `cambiar_dueno_mascota`,
   `crear_estadia_con_cupo`, `modificar_estadia_con_cupo`, `cancelar_estadia`, `hacer_checkin`,
   `hacer_checkout`, `marcar_dosis_aplicada`, `crear_tenant`. Todas `SECURITY DEFINER` con
   `REVOKE … FROM PUBLIC` y `GRANT EXECUTE … TO service_role` **únicamente**. Otorgárselas a
   `authenticated` deja que cualquier usuario logueado invoque `registrar_eutanasia` directo contra
   PostgREST, salteando `requireModule`, `requirePermission` y la irreversibilidad de la regla 8.

3. **La auditoría implícita (regla 6) muere.** `recordAudit` inserta en `registros_auditoria` desde
   el Service. Ese INSERT está revocado para `authenticated` y **tiene que seguir revocado**: la
   suite de hardening prueba que un usuario no puede borrar la auditoría que lo delata. La auditoría
   necesita service role haga lo que haga el resto.

4. **El cron de notificaciones no tiene JWT que usar.** `cron.controller.ts` lo dispara
   pg_cron → pg_net con `X-Cron-Secret`, fuera de `tenantContext`, y barre **todos** los tenants
   activos con el módulo licenciado. No hay usuario. `notificaciones.service.ts` se queda en service
   role de manera permanente: es un service genuinamente de dos modos.

5. **`auth.admin.*` — 9 sitios** (crear cuenta, cambiar email, desactivar, signOut) exige service
   role por definición de GoTrue. No negociable.

6. **Las lecturas también se angostan, y en silencio.** El hardening dejó el SELECT de `authenticated`
   condicionado al permiso por tabla (`historial_clinico` exige `view_medical_history`). Un Service
   que hoy lee legítimamente cruzando esa frontera — p. ej. turnos embebiendo datos de la mascota
   para un usuario con `manage_appointments` pero sin `view_medical_history` — pasaría a recibir
   embeds vacíos en vez de un error. Respuesta incorrecta y callada: peor modo de falla que el actual.

7. **Storage** (4 sitios, bucket privado + signed URLs) tendría que reescribirse contra políticas de
   storage por tenant.

### La alternativa: exigir el `tenant_id` por construcción, no por disciplina

La superficie real de disciplina, medida hoy: **141 llamadas `.from()`** en los services, **112** con
`.eq("tenant_id", …)` explícito. Las ~29 restantes son catálogos globales, tablas de plataforma
(`tenants`, super admin), INSERTs que llevan el tenant en el payload y las búsquedas cross-tenant
deliberadas. Es decir: el problema no es que falte disciplina hoy, es que nada la sostiene mañana.

Tres opciones, de menor a mayor costo:

**Opción A — guardrail estático (recomendada para arrancar).**
Un test que recorra los fuentes de `modules/*/*.service.ts` y exija que toda `.from("<tabla con
tenant_id>")` que corra con `getServiceDb()` lleve su `.eq("tenant_id"` en la misma cadena, con una
allowlist explícita y comentada para las excepciones legítimas (las ~29 de arriba). Costo: un
archivo de test, sin migración, sin tocar `shared/db.ts`, sin runtime. Atrapa exactamente los cuatro
casos de A3 y el de `editar()` **antes** de que se escriban. Contra: es sintáctico, no entiende
control de flujo, y hay que mantener la allowlist.

**Opción B — wrapper con tenant por construcción.**
Un cliente delgado en `shared/` construido desde el `CallerContext`, que para las tablas con
`tenant_id` aplique el filtro solo y meta el `tenant_id` en el payload de los INSERT, con una vía de
escape explícita y greppable (`crossTenant("login por email")`) para los cuatro casos legítimos.
Costo: un archivo nuevo, reescritura mecánica de 141 sitios (la mayoría eliminando el `.eq()` que ya
está), sin migración ni cambios de RLS/grants; puede ir módulo por módulo con el test de aislamiento
de arriba como red. Contra: es otra abstracción sobre supabase-js y los genéricos del
`PostgrestFilterBuilder` son incómodos de envolver sin perder tipado.

**Opción C — migrar a `getDb()`.** Los siete puntos de arriba. No recomendada.

Mi sugerencia: **A ahora, y B solo si A resulta ruidosa.** Ninguna de las dos toca `shared/db.ts`
para agregar comportamiento implícito, que es la restricción pedida.

---

## 4. CLAUDE.md

- La frase *"Los embeds respetan RLS"* pasó a *"…pero solo donde RLS está activa"*, aclarando que
  vale para el acceso PostgREST del frontend y **no** para el camino de la API, donde un embed no
  aporta aislamiento porque no hay RLS que respetar.
- Sección nueva **"Aislamiento explícito en el camino de la API (service role)"** con la tabla de
  quién impone el aislamiento en cada camino y cuatro reglas operativas: el `.eq("tenant_id")`
  obligatorio, que un id del body no está validado por venir de una FK, que `.single()` sobre una
  columna de unicidad por tenant es un bug, y que los tests de aislamiento bloqueantes ahora son dos.

---

## Estado

- `npx vitest run tests/unit tests/integration` → **736 pasando, 59 archivos**.
- `npm run typecheck` → limpio.
- `npm run lint` no corre en este repo: ESLint 10 pide `eslint.config.*` y no hay ninguno. Pre-existente.
- **Flakes pre-existentes, ajenos a este cambio.** En dos de las cuatro corridas combinadas falló un
  test distinto cada vez, y ambos pasaron al reintentar (solos y combinados):
  `turnos.integration.test.ts` (*"un turno de A no es visible para B bajo RLS"*: el `POST /turnos` de
  setup no devolvió 201) y `grants.integration.test.ts` (*"service_role conserva EXECUTE"*: el RPC
  devolvió `error` nulo en vez de `P0001`). Ninguno toca código modificado acá; huele a contención
  contra el Supabase remoto compartido cuando corren 59 archivos en paralelo. Vale como deuda:
  esas dos suites deberían ser resistentes al paralelismo o correr serializadas.

## Fuera de alcance, para anotar

- `GET /historial/<no-uuid>` responde **500 `INTERNAL_ERROR`** (Postgres 22P02) en vez de 422: el
  controller de `/historial/:id` no valida el parámetro con Zod, a diferencia de
  `/plan-vacunacion/:id`, que sí lo hace. Ensucia Sentry con errores que son del cliente.
- El teardown frágil de las demás suites de integración (ver la nota en la sección 2).
