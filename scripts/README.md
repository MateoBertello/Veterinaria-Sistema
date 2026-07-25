# Entorno de desarrollo local

Cómo levantar la Veterinaria "Leo" desde cero en tu máquina y dejar un tenant de
demo listo para usar, sin crear nada a mano por SQL ni por la consola de Supabase.

## Requisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli) (binario **standalone**)
- Node.js 20+ (`@supabase/supabase-js` y `dotenv` ya vienen en `devDependencies`)
- Dependencias instaladas: `npm install`

> **No instales el CLI con npm/npx en Linux.** El paquete `supabase` de npm no
> publica binario `linux-x64` y `npx supabase ...` falla con
> *"No matching Supabase CLI binary package found for linux-x64"*. Usá el binario
> standalone:
>
> ```bash
> # .deb (Ubuntu/Debian)
> curl -fsSLo /tmp/supabase.deb https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb
> sudo dpkg -i /tmp/supabase.deb
>
> # …o binario suelto en ~/.local/bin (asegurate de tenerlo en el PATH)
> curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
>   | tar -xz -C ~/.local/bin supabase
> ```

## Arranque desde cero

```bash
# 1. Levantar el stack local (Postgres, Auth, PostgREST, Studio, Inbucket…)
supabase start

# 2. Aplicar migraciones + seed global de catálogos.
#    `supabase db reset` reaplica TODAS las migraciones desde cero, incluido
#    20260614000004_seed_global.sql (permisos, especies, razas, tipos_vacuna).
#    Ese seed corre como migración: NO hay que invocarlo aparte.
supabase db reset

# 3. Configurar .env (ver más abajo) y sembrar el entorno de demo.
npm run seed

# 4. Servir la Edge Function de la API (Hono).
supabase functions serve

# 5. Levantar el frontend.
npm --prefix web run dev
```

`supabase start` imprime las URLs y llaves locales (API URL, `anon key`,
`service_role key`). Copialas al `.env` antes del paso 3.

## Variables de entorno (`.env` en la raíz)

El seeder lee `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (con fallback a las
variantes `TEST_*`, para alinear con el arnés de integración):

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key que imprime `supabase start`>
SUPABASE_ANON_KEY=<anon key que imprime `supabase start`>
```

> El seeder usa la **service-role key** (bypassa RLS) — uso legítimo para seeds,
> igual que los tests de integración. **Es solo para DEV.** Si `SUPABASE_URL` no
> apunta a un host local, el seeder aborta; podés forzarlo con `SEED_ALLOW_REMOTE=1`
> (no recomendado).

## Qué hace `npm run seed`

Es **idempotente**: corrércelo dos veces no duplica ni rompe.

1. **Tenant demo** "Veterinaria Demo" (`cuit_rut 20999999999`, plan `premium`)
   provisionado por el **camino real**: el RPC `crear_tenant` → `on_tenant_created`,
   que crea los 3 roles con sus permisos, la `configuracion_tenant (10, 7)` y los
   módulos contratados según el plan (premium ⇒ historial + turnos + guardería).
2. **Un usuario por rol** vía la Auth admin API, con `app_metadata.tenant_id`
   correcto y la fila correspondiente en `usuarios` (y en `doctores` para el
   veterinario).
3. **Datos demo**: 2 clientes con sus mascotas, usando los catálogos globales
   (`especies`/`razas`) ya sembrados por la migración.

## Credenciales que deja el seed

Todas con contraseña **`Demo1234!`**. **El login es por _usuario_ (username), NO por email**
— el endpoint `POST /auth/login` recibe `{ username, password }` y resuelve el email
internamente:

| Rol           | Usuario (login)  | Email interno          |
| ------------- | ---------------- | ---------------------- |
| admin         | `admin_demo`     | `admin@demo.local`     |
| veterinario   | `vet_demo`       | `vet@demo.local`       |
| recepcionista | `recepcion_demo` | `recepcion@demo.local` |

Tenant: **Veterinaria Demo** · plan **premium** (los 3 módulos visibles).

## Consola Super Admin (`/admin/*`)

El Super Admin de plataforma **no es un usuario de tenant**: es un usuario de
Supabase Auth con `app_metadata.platform_role = 'super_admin'`, sin fila en
`usuarios` y sin `tenant_id`. Por eso **no entra por `POST /auth/login`** (ese
endpoint busca por username en `usuarios`): su sesión sale directo de Supabase
Auth. `node scripts/crear-super-admin.mjs` hace las dos cosas — lo provisiona
(idempotente) e imprime el `access_token` con la línea para abrir la consola:

```bash
# DEV local: toma SUPABASE_URL / SERVICE_ROLE / ANON del .env (acepta las TEST_*)
SUPER_ADMIN_EMAIL=super@leo.local SUPER_ADMIN_PASSWORD='Super1234!' \
  node scripts/crear-super-admin.mjs
```

El front lee el JWT de `localStorage.sb-token`: pegando la línea que imprime el
script y recargando, `/admin/tenants` abre. El token vence (1 h por defecto) —
volvé a correr el script para renovarlo.

## Errores comunes (troubleshooting)

Estos síntomas parecen "login roto" pero casi siempre son del entorno local:

- **Corré TODO (`supabase …` y `npm run seed`) desde `~/Veterinaria-Sistema`.** El CLI de
  Supabase nombra el proyecto según el **directorio actual** (`supabase_*_<basename>`).
  Si lo lanzás desde tu home (`~`) levanta un **proyecto fantasma vacío** (sin migraciones
  ni la función `api`) → `/functions/v1/api/...` responde **`Function not found` (404)** y
  `npm run seed` falla con `ENOENT package.json`. Verificá: `docker ps | grep supabase`
  debe mostrar el sufijo **`_Veterinaria-Sistema`**.
- **No corras `supabase start` sobre una stack ya levantada.** Deja el volumen de Postgres
  inconsistente → el contenedor `supabase_db_*` entra en **crash-loop** (`Restarting (1)`)
  y Kong nunca sube (`curl` a `:54321` da `HTTP 000`). Recuperá con
  `supabase stop --no-backup` → `supabase start` → `npm run seed` (es DEV, se reconstruye).
- **`{"message":"name resolution failed"}` (503)** en `/functions/v1/*` = el edge runtime no
  se está sirviendo. Este CLI lo levanta como parte de `supabase start` (no hace falta
  `functions serve` aparte).
- **No cambies `[functions.api] verify_jwt` a `true`.** Debe quedar en **`false`**: la función
  `api` hace su propia autenticación por-ruta (`tenantContext` en lo protegido; `/auth/login`
  y `/auth/recuperar-*` son **públicas**). Con `verify_jwt = true` el gateway rechaza el login
  sin token antes de llegar a la app.
- **Diagnóstico rápido:** `curl` directo a `/functions/v1/api/v1/auth/login` distingue el nivel
  del fallo — `404` (proyecto/función equivocada) · `503` (runtime caído) · `500` (excepción en
  la función) · `200` (sano). Y `curl` a GoTrue (`POST /auth/v1/token?grant_type=password` con
  header `apikey: <publishable>`) aísla si el problema es la credencial.
