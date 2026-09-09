# Prompt de re-auditoría — correcciones H1..H8 del Módulo Comercial

> **Cómo se usa:** pegar todo lo que sigue en una **sesión nueva** (modelo fuerte, sin el
> contexto de la sesión que hizo las correcciones). No pegar salidas de tests ni de SQL: el
> auditor corre todo él mismo.

---

Sos el auditor de un fix set. No lo escribiste vos y no tenés que defenderlo. Tu único
producto es un veredicto **APROBADO / RECHAZADO** por hallazgo, con la evidencia que lo
sostiene y que vos mismo generaste.

Repositorio: `/home/mateo/Veterinaria-Sistema`, rama `fix/auditoria-comercial`. La corrección
que auditás está **en el árbol de trabajo sin commitear** (más lo commiteado en `e7b9f54` y
`f401174`). Empezá por `git status` y `git diff` para ver el alcance real; el listado de abajo
es la lista de hallazgos que la corrección dice cerrar, no un inventario del diff.

## Reglas de la auditoría — leelas antes de tocar nada

1. **Un test verde no es evidencia.** La evidencia es: **rompo la funcionalidad y el control
   se pone rojo**. Para cada hallazgo hay abajo una mutación propuesta; si se te ocurre una
   mejor, usala y decilo. Si un control no se pone rojo ante la mutación, el hallazgo está
   **RECHAZADO** aunque la suite entera esté verde.
2. **Las mutaciones las corrés vos.** No aceptes salidas pegadas, transcriptas ni resumidas
   por nadie. Si no lo ejecutaste en esta sesión, no lo viste.
3. **Auditás la clase de defecto, no la instancia.** La pregunta no es "¿taparon las siete
   vistas que fugaban?" sino "¿una vista nueva escrita mañana por alguien que no leyó nada de
   esto queda tapada sola, o vuelve a fugar?". Para probarlo creá vos **una instancia nueva**
   del defecto —con tu propio nombre, no reusando la que arreglaron— y mirá si el mecanismo la
   agarra.
4. **Revertí toda mutación** antes de pasar al hallazgo siguiente y verificá que el árbol
   quedó como estaba (`git status`, `git diff --stat`). Las mutaciones sobre la base van con
   su `DROP`/restore; las mutaciones sobre migraciones van con `git checkout --` del archivo o
   borrando el archivo nuevo.
5. **Si algo no se puede verificar, se reporta como no verificado.** No completes con
   inferencia lo que no corriste; tampoco des por buena una explicación del código sin
   ejecutarla. La corrección anterior tenía un test de concurrencia verde que no probaba el
   lock, y solo apareció instrumentando el RPC con `RAISE LOG`: si un resultado "sale bien"
   pero no entendés **por qué**, todavía no terminaste.
6. **Alcance.** Podés leer todo el repo. **No arregles nada**: si encontrás un defecto,
   documentalo. Lo único que escribís son artefactos de mutación temporales, y los revertís.

## Entorno

```bash
cd /home/mateo/Veterinaria-Sistema
supabase status                 # el stack local tiene que estar arriba
npm run typecheck
npx vitest run tests/unit                                        # suite unitaria
npx vitest run --config vitest.integration.config.ts             # suite de integración
```

Acceso directo a la base (cualquiera de las dos formas):

```bash
docker exec -i supabase_db_Veterinaria-Sistema psql -U postgres -d postgres -c "<sql>"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "<sql>"
```

Ojo con dos trampas del arnés antes de creerle a cualquier verde:

- `describeIntegration` **saltea** las suites si faltan `TEST_SUPABASE_URL` /
  `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` (`tests/integration/_env.ts`).
  Confirmá que las suites que mirás corrieron de verdad: contá tests ejecutados, no archivos.
- Varias suites de integración comparten la base. Corré la suite completa al menos una vez y
  verificá al final que **no quedan tenants residuales**:
  `select count(*) from tenants;` antes y después.

---

## Los ocho hallazgos

*(Numeración reconstruida del árbol de trabajo. Si tu copia del informe original numera
distinto, mandá el contenido: cada ítem se identifica por lo que describe, no por el número.)*

### H1 — Vistas sin `security_invoker`: cualquier usuario leía las filas de otras clínicas

**El defecto.** Una vista sin `security_invoker = true` corre con los privilegios de su dueño
(`postgres`, `BYPASSRLS`) y no aplica la RLS de las tablas de abajo. Con `SELECT` otorgado a
`authenticated`, cualquier usuario logueado de cualquier tenant leía por PostgREST directo las
filas de todos los demás en las 7 vistas comerciales.

**Lo que la corrección dice haber hecho:** `security_invoker` + `REVOKE` en las 7 vistas; el
guardrail estático `tests/unit/vistas-security-invoker.test.ts` deriva su alcance de
`CREATE [OR REPLACE] VIEW` en las migraciones; y `tests/integration/rls.test.ts` dejó de usar
la lista de 7 escrita a mano y ahora enumera **todas** las vistas de `public` desde `pg_class`.

**Cómo lo verificás — creá tu propia vista, con tu propio nombre.** No reuses ninguna de las
siete. Elegí un nombre que no exista en el repo (p. ej. `v_auditoria_fuga_<algo tuyo>`) y
escribí una migración nueva que la cree sobre una tabla con `tenant_id`, **exactamente como la
escribiría alguien que no leyó nada de esto**: sin `security_invoker` y con `GRANT SELECT ...
TO authenticated`. Después:

1. Con la migración **solo en el repo** (todavía sin aplicar): corré el guardrail estático.
   Tiene que ponerse **rojo nombrando tu vista**. Si pasa, el guardrail no cubre la clase.
2. Aplicala a la base (`supabase db reset` o `psql` con el mismo DDL) y corré los dos tests
   BLOQUEANTES de vistas de `rls.test.ts`. Tienen que ponerse **rojos**: tu vista tiene que
   aparecer en la lista de fugas y/o en la de legibles por `authenticated`. Si `rls.test.ts`
   sigue verde, la enumeración desde `pg_class` no está funcionando como dice.
3. Probá también el **falso positivo**: agregá `ALTER VIEW ... SET (security_invoker = true)`
   y el `REVOKE`, y confirmá que los tres controles vuelven a verde. Un guardrail que se
   queja igual no sirve.
4. Variantes que un autor real escribiría y el parser podría no ver: `CREATE OR REPLACE VIEW`,
   `create view` en minúscula, `public.` explícito, la vista creada en una migración y el
   `ALTER`/`REVOKE` en otra posterior, un `CREATE VIEW` dentro de un bloque `DO $$ ... $$` o
   de un `EXECUTE`. Probá al menos las dos últimas: son las que un parser por regex se pierde.
5. Verificá el estado real de la base, no solo el texto de las migraciones:
   ```sql
   select c.relname,
          c.reloptions,
          has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
          has_table_privilege('anon', c.oid, 'SELECT')          as anon_select
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname = 'public'
    order by 1;
   ```
   Toda vista tiene que traer `security_invoker=true` en `reloptions` y `false` en las dos
   columnas de privilegio.

Borrá tu vista y tu migración al terminar.

### H2 — La foto de aislamiento podía compararse sin haber mirado nada

**El defecto.** `tests/integration/aislamiento-api.integration.test.ts` compara un snapshot
por tabla antes y después de los intentos cross-tenant. El orden se pedía por **una** columna;
en tablas donde esa columna no es única por tenant el orden de las filas no es determinista y
la comparación puede fallar o pasar por motivos ajenos al aislamiento. Además, un error al
fotografiar dejaba la foto en `[]` **de los dos lados** y la comparación pasaba sin mirar la
tabla.

**Cómo lo verificás.**

1. Para **cada** entrada de `TABLAS_SNAPSHOT`, comprobá contra la base que la tupla de orden
   declarada es única dentro de un tenant. Se automatiza: por cada `(tabla, columnas)`,
   `select count(*) from (select <columnas>, count(*) from <tabla> group by <columnas>
   having count(*) > 1) x;` sobre datos sembrados. Cualquier resultado > 0 es una tabla que
   sigue con orden no determinista → hallazgo abierto.
2. Mutación del guard: hacé que una tabla no se pueda fotografiar (por ejemplo agregando a la
   lista una tabla inexistente, o revocando temporalmente el acceso) y confirmá que la suite
   **revienta** con el mensaje de "no se pudo fotografiar", en vez de dar verde.
3. Mutación de fondo: metelé al Service de algún módulo comercial una fuga real —quitá un
   `.eq("tenant_id", ctx.tenantId)` de una consulta de escritura— y confirmá que la matriz de
   aislamiento se pone roja **en esa entidad**. Si no la agarra, la matriz no cubre el módulo
   que dice cubrir.

### H3 — El teardown buscaba la cuenta de Auth en la primera página del listado

**El defecto.** Varios `afterAll` hacían `auth.admin.listUsers()` y buscaban el super admin en
el resultado. Ese endpoint pagina (default 50): con el proyecto poblado la cuenta no aparecía,
no se borraba nunca y contaminaba la corrida siguiente.

**Lo que la corrección dice haber hecho:** `borrarUsuarioAuthPorEmail()` en
`tests/integration/_teardown.ts`, que pagina con `per_page=1000`, revienta si el `DELETE`
falla y verifica que la cuenta desapareció; más `tests/integration/teardown-pagination.test.ts`.

**Cómo lo verificás.**

1. **El test nuevo probablemente no prueba la paginación.** Crea 60 cuentas de relleno, pero
   la función pide páginas de 1000: el bucle no itera nunca y con el código viejo
   (`listUsers()` sin `page`) el resultado podría ser el mismo. Comprobalo: corré
   `teardown-pagination.test.ts` **contra la implementación vieja** (revertí `_teardown.ts` con
   `git stash` / `git checkout --` y adaptá la llamada) y mirá si se pone rojo. Si pasa, el
   test no cubre la clase y H3 está rechazado aunque la función nueva sea correcta.
2. Probá que el bucle de paginación funciona de verdad: bajá `perPage` a 10 en una copia,
   sembrá más de 10 cuentas y confirmá que igual encuentra y borra la correcta dejando las
   demás intactas.
3. Buscá reincidencias de la clase en todo el repo:
   `grep -rn "listUsers(" tests/ scripts/`. Cada uso que no pagine es la misma bomba.

### H4 — El test de concurrencia de RN-SC8 pasaba sin el `FOR UPDATE`

**El defecto.** El test de `tests/integration/ventas.integration.test.ts` (C4·T5) daba verde
aunque el RPC no serializara: las llamadas perdedoras fallaban por el **CHECK** de
`existencias_lote` (existencia negativa), no por el lock. El test contaba éxitos y fallos, y
un fallo por constraint contaba igual que un rechazo de negocio.

**Lo que la corrección dice haber hecho:** las llamadas perdedoras ahora deben fallar con
`INSUFFICIENT_STOCK` y se rechaza explícitamente el mensaje de violación de CHECK.

**Cómo lo verificás — este es el que importa.**

1. Sacá el `FOR UPDATE` del RPC `registrar_venta` en la base (redefiní la función con `psql`,
   guardándote el cuerpo original con `pg_get_functiondef` para restaurarlo) y corré el test
   de RN-SC8. **Tiene que ponerse rojo.** Si sigue verde, la corrección no cerró nada.
2. Mientras corre la versión sin lock, instrumentá con `RAISE LOG` (o `RAISE NOTICE`) el punto
   donde el RPC decide rechazar, y leé los logs del contenedor
   (`docker logs supabase_db_Veterinaria-Sistema`) para ver **por qué** falla cada llamada
   perdedora. Es la única forma de distinguir "serializó" de "el CHECK la salvó". Reportá esa
   evidencia en el veredicto.
3. Restaurá el RPC y confirmá verde.
4. Clase, no instancia: ¿hay otros RPCs con la misma forma —`confirmar_compra`,
   `ajustar_existencia`, `registrar_devolucion`, `aplicar_recuento`,
   `registrar_consumo_clinico`, `fraccionar_lote`, apertura/cierre de caja— cuyo test de
   concurrencia (si existe) podría estar pasando por el CHECK y no por el lock? Revisá los
   que tengan test y decí cuáles no tienen ninguno.

### H5 — RN-MV4: el signo del movimiento tiene tres valores, no dos

**El defecto.** `merma_fraccionamiento` debe registrar signo **0** (asiento de trazabilidad
que no altera existencias); la spec y el test solo contemplaban `+1` y `-1`.

**Cómo lo verificás.**

1. Mutá `signo_movimiento()` en la base para que devuelva `-1` en `merma_fraccionamiento` y
   corré `tests/integration/stock.integration.test.ts`. Rojo esperado.
2. Enumerá **todos** los valores del enum de tipo de movimiento en la base y comprobá que cada
   uno tiene un signo definido y probado. El test cubre tres casos; el enum tiene más de diez.
   Un valor sin cobertura es la próxima instancia del mismo hallazgo:
   ```sql
   select e.enumlabel, signo_movimiento(e.enumlabel::tipo_movimiento)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'tipo_movimiento' order by e.enumsortorder;
   ```
   (ajustá el nombre del tipo y de la función a lo que exista realmente).
3. Verificá la coherencia contable de fondo con datos: para un fraccionamiento real,
   `sum(cantidad_con_signo)` sobre el lote padre y el hijo tiene que dar lo que dice
   `existencias_lote`. Si el signo 0 se usa en algún tipo donde sí hay movimiento físico, la
   caché y el libro mayor se separan.

### H6 — El guardrail de auditoría miraba en una sola dirección y no miraba los RPCs

**El defecto.** `tests/unit/audit-modulo-enum.test.ts` verificaba que todo `module:` de
`recordAudit` estuviera en el enum, pero (a) no verificaba la dirección inversa (valores del
enum ausentes del tipo `AuditModule`) y (b) no miraba los `INSERT INTO registros_auditoria`
que hacen los **RPCs en SQL**, donde un módulo inválido revienta la transacción entera.

**Cómo lo verificás.**

1. Escribí una migración nueva tuya con un RPC que inserte en `registros_auditoria` con un
   literal de módulo inexistente. El test tiene que ponerse rojo señalando tu archivo. Probá
   también las formas que un parser por regex se pierde: el `module` pasado por variable, el
   `INSERT` construido con `EXECUTE format(...)`, columnas en otro orden, comentarios en el
   medio. Decí cuáles agarra y cuáles no.
2. Agregá un valor al enum `modulo_auditoria` en una migración y no lo agregues a
   `AuditModule`: el control bidireccional tiene que ponerse rojo. Notá que la corrección dejó
   una `ALLOWLIST_DB_ONLY` vacía — comprobá que agregar algo ahí efectivamente lo exime, y
   juzgá si la lista es una puerta trasera aceptable (documentada) o un agujero.
3. Prueba de realidad, no de parser: hacé que un RPC audite con un módulo inválido **contra la
   base** y confirmá que PostgreSQL efectivamente aborta la transacción. Es la premisa de todo
   el guardrail.

### H7 — `idx_mov_mascota`: índice sin consumidor

**El defecto.** El índice sobre `movimientos_stock(tenant_id, mascota_id)` se creó en C8 pero
ninguna consulta del código filtra `movimientos_stock` por `mascota_id`: el consumo clínico va
por la vista `v_consumo_clinico`, que filtra `historial_clinico` y entra a movimientos por
`idx_mov_historial`. La corrección lo elimina en
`supabase/migrations/20261029000001_eliminar_idx_mov_mascota_sin_consumidor.sql`.

**Cómo lo verificás.**

1. No creas el `EXPLAIN` pegado en el comentario de la migración: **corrélo vos**, con el
   fixture de volumen cargado (ver H8), con y sin el índice, y comparando el plan real.
2. Confirmá que ninguna consulta lo necesitaba:
   `grep -rn "mascota_id" supabase/functions/api/src` y revisá cada `from("movimientos_stock")`.
3. Preguntá lo que la corrección no responde: ¿queda alguna consulta que **debería** existir
   (un reporte de trazabilidad por mascota) y que ahora quedaría sin índice? Si la respuesta
   es sí, el borrado es correcto hoy y una trampa en tres semanas: decilo.
4. Verificá que el índice se fue de la base: `\d movimientos_stock` o
   `select indexname from pg_indexes where tablename = 'movimientos_stock';`.

### H8 — El fixture de volumen no se podía aplicar

**El defecto.** `supabase/seeds/comercial_volumen_seed.sql` insertaba en `auth.users` sin las
columnas `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, que
son `NOT NULL` en GoTrue: el seed fallaba y los tests de reportes que dependen de él quedaban
en rojo (8 de los 12 rojos que reportaba el Bloque 1).

**Cómo lo verificás.**

1. Aplicá el seed vos mismo sobre una base limpia (`supabase db reset` + el seed) y confirmá
   que termina sin error y con el volumen que declara. Contá filas.
2. Corré los tests de reportes que dependían del fixture y confirmá que pasan **por el seed** y
   no porque el test se saltee (`describeIntegration`) o porque tolere un fixture vacío. Un
   reporte que devuelve `[]` sobre una base vacía y el test que lo acepta es el mismo falso
   verde de siempre.
3. La pregunta abierta del hallazgo original era **qué mecanismo del repo aplica este seed**.
   Buscala: `grep -rn "comercial_volumen_seed" . --include=*.ts --include=*.mjs --include=*.json
   --include=*.md --include=*.sql`. Si sigue sin haber ninguno —ni script npm, ni
   `supabase/config.toml`, ni CI—, el seed se arregló pero sigue sin correr solo, y eso es
   hallazgo abierto, no cerrado.

---

## Controles transversales (corrélos igual, aunque los ocho den APROBADO)

1. `npm run typecheck` limpio.
2. `npx vitest run tests/unit` — anotá totales.
3. `npx vitest run --config vitest.integration.config.ts` — anotá totales, y **cuántas suites
   quedaron SKIPPED**. Un skip silencioso es un rojo disfrazado.
4. Corré la suite de integración **dos veces seguidas**. La segunda tiene que pasar igual y
   dejar `select count(*) from tenants;` en el mismo valor que antes de la primera. Un
   teardown que no limpia es un test que solo pasa una vez.
5. `npm run lint` — comparalo contra `git stash`ando la corrección: no puede haber errores
   nuevos respecto de la base.
6. Un `git diff` completo leído entero, buscando lo que nadie reportó: `.eq("tenant_id"`
   faltantes, `.single()` sobre columnas con unicidad por tenant, consultas dentro de un `map`
   o un `for` (N+1), y tests nuevos que mockean el Service y dicen probar una RN.

## Formato del veredicto

Para cada hallazgo, en este orden:

- **H<n> — <título>**: `APROBADO` / `RECHAZADO` / `NO VERIFICADO`.
- **Mutación que corrí** (el comando o el DDL exacto) y **qué pasó**: rojo/verde, con el
  fragmento de salida que lo muestra.
- **Clase cerrada o instancia tapada**: qué instancia nueva creaste y si el mecanismo la
  agarró.
- **Lo que queda abierto**, si algo queda.

Cerrá con un veredicto global y, si es RECHAZADO, la lista mínima de correcciones pendientes
ordenada por gravedad. No propongas ni apliques los arreglos: el alcance de esta sesión
termina en el diagnóstico.
