# Tests

| Suite | Comando | Necesita base |
|---|---|---|
| Unitarios (Services por RN, controllers, guardrails) | `npm test` / `npm run test:unit` | No |
| Integración (RLS, aislamiento por API, RPCs contra PostgreSQL real) | `npm run test:integration` | Sí — Supabase local levantado |
| E2E (Playwright) | `npm run test:e2e` | Sí — stack completo + `npm run seed` |

## Qué corre en CI y qué no

`.github/workflows/ci.yml` corre **sólo** `pnpm typecheck` y `pnpm test:unit`.
La suite de integración y la E2E **no corren en CI**: necesitan un Supabase
levantado, y hoy se corren a mano en local antes de cerrar una etapa. Dos
consecuencias que conviene tener presentes:

1. Todo lo que tiene que ser **bloqueante en CI** vive en `tests/unit/`. Por eso
   los guardrails (`tenant-filter-guardrail`, `audit-modulo-enum`,
   `signo-movimiento`, `vistas-security-invoker`) son análisis estático sobre
   las migraciones y el código fuente: sin base, corren en cada push.
2. Los tests de integración se corren **sobre base limpia** (`supabase db reset`
   y después `npm run test:integration`). No hay nadie que los corra por vos.

`vitest.integration.config.ts` fuerza `fileParallelism: false`: los archivos
crean y borran tenants y cuentas de Auth reales contra el mismo Supabase, y en
paralelo se pisan entre sí. El motivo largo está en el comentario de ese archivo.

## El fixture de volumen

`supabase/seeds/comercial_volumen_seed.sql` (C8·T1) siembra tres tenants
sintéticos con productos, lotes, ventas y ~600 movimientos de stock. Sin él,
`reportes.integration.test.ts` no tiene nada que reportar y los planes de
ejecución no eligen índices.

**Se aplica desde `[db.seed]` en `supabase/config.toml`**, o sea en el
`supabase db reset`. Antes se aplicaba desde el `beforeAll` de
`reportes.integration.test.ts` con
`execSync("docker exec -i supabase_db_Veterinaria-Sistema psql ...")`. Se movió
porque esa forma no tenía ninguna ventaja y sí tres problemas:

- **Hardcodeaba el nombre del contenedor.** `supabase_db_<nombre-del-directorio>`:
  cualquiera que clonara el repo en una carpeta con otro nombre veía la suite
  fallar por un error de docker que no dice nada del test.
- **Ignoraba a dónde apuntan los tests.** El arnés (`tests/integration/_env.ts`)
  permite apuntar la suite a otro Supabase con `TEST_SUPABASE_URL`. El
  `docker exec` escribía siempre en el contenedor local, así que contra un
  destino remoto sembraba una base y aseveraba contra otra.
- **Exigía docker desde el proceso de test**, que es una dependencia rara para
  una suite que por lo demás sólo habla HTTP con Supabase.

No se movió a `scripts/seed.mjs` (el seeder de desarrollo, `npm run seed`)
porque el fixture escribe directo en `auth.users`, y eso pide el rol `postgres`:
no alcanza con la service-role key que usa ese script. SQL aplicado por la CLI
es el único camino que lo permite, y `[db.seed]` es donde la CLI espera ese SQL.

`reportes.integration.test.ts` ya no siembra: verifica que el fixture esté y, si
falta, falla diciendo que hay que correr `supabase db reset`. Una suite de
reportes sin datos daría verde reportando cero, que es el falso verde que se
quiere evitar.

## Cuentas de Auth huérfanas

Las cuentas de `auth.users` no las borra ninguna FK: `limpiarTenant`
(`tests/integration/_teardown.ts`) recorre tablas de negocio, así que una cuenta
de Auth sin fila en `usuarios` sobrevive a la limpieza y se acumula corrida tras
corrida hasta romper la siguiente por email duplicado.

Toda suite que cree cuentas de Auth las borra en su `afterAll` con
`borrarUsuarioAuthPorEmail`, **incluidas las que crea el código bajo prueba y no
la suite**: `POST /admin/tenants` invita por email a la cuenta de contacto del
tenant (`TenantService.crear` → `inviteUserByEmail`), que queda en `auth.users`
sin fila en `usuarios`. Es el caso de `alta@test.com` en
`admin.integration.test.ts`.
