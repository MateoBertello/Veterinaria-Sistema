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
#    20260614000004_seed_global.sql (permisos) + on_tenant_created, que siembra
#    el catálogo clínico (especies, razas, tipos_vacuna) de cada tenant.
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
   (`especies`/`razas`) que `on_tenant_created` ya sembró para ese tenant.

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
`usuarios` y sin `tenant_id`. Por eso **no entra por `POST /auth/login`** — ese
endpoint resuelve el identificador contra `usuarios` y ahí no está —, sino por su
propio login de plataforma.

Son dos pasos separados: **el script crea la cuenta, la aplicación la usa.**

**1. Provisionar la cuenta** (idempotente: re-correrlo repara password,
confirmación y el claim). Es la única forma de escribir `platform_role`, porque
requiere la `service_role` key:

```bash
# DEV local: toma SUPABASE_URL / SERVICE_ROLE / ANON del .env (acepta las TEST_*)
SUPER_ADMIN_EMAIL=super@leo.local SUPER_ADMIN_PASSWORD='Super1234!' \
  node scripts/crear-super-admin.mjs
```

Con `SUPABASE_ANON_KEY` presente, el script además verifica que la cuenta puede
iniciar sesión y que su JWT trae el claim. No imprime ningún token.

**2. Entrar por la aplicación**: `/admin/login`, con el email y la contraseña de
la cuenta. Va contra `POST /api/v1/admin/auth/login`, que valida las credenciales
en Supabase Auth y solo devuelve sesión si el JWT acredita
`platform_role = 'super_admin'`; cualquier otro fracaso responde el mismo
`401 Credenciales inválidas`, sin decir cuál falló.

La sesión de plataforma vive en `localStorage` bajo sus propias claves
(`sb-platform-token` / `sb-platform-refresh-token`), aparte de la de la clínica
(`sb-token`), y **se renueva sola** con su refresh token contra
`/admin/auth/refresh`. No hay que volver a correr el script para seguir
trabajando.

> **Nota para sesiones viejas.** Antes de que existiera `/admin/login`, la forma
> de entrar era pegar a mano el `access_token` que imprimía el script en
> `localStorage.sb-token`. Eso ya no se usa y conviene limpiarlo: esa sesión no
> tenía refresh token (moría a la hora exacta) y compartía clave con la de la
> clínica, así que cualquier 401 de la API del tenant la borraba.

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
