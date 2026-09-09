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

# 2. Aplicar migraciones + seed de desarrollo y volumen.
#    `supabase db reset` reaplica TODAS las migraciones desde cero e invoca los
#    seeds configurados en `[db.seed]` (supabase/seed.sql con el tenant demo
#    "Veterinaria Demo" y su admin, y el fixture de volumen comercial).
supabase db reset

# 3. Configurar .env (ver más abajo). El tenant demo ya queda listo desde el reset;
#    opcionalmente `npm run seed` siembra además clientes demo y mascotas.
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

1. **Tenant demo** "Veterinaria Demo" (`cuit_rut 20-99999999-9`, plan `premium`)
   — el MISMO valor que usa `supabase/seed.sql`, para que ambos seeds converjan en
   un único tenant demo en vez de crear uno cada uno —
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

### Ver y dar de baja Super Admins

El acceso de plataforma **es** el claim `app_metadata.platform_role='super_admin'`,
y el dashboard de Supabase no muestra `app_metadata` en Authentication → Users.
Para no tener que abrir usuario por usuario está `scripts/super-admins.mjs`:

```bash
node scripts/super-admins.mjs list                  # quiénes tienen acceso hoy
node scripts/super-admins.mjs revoke viejo@leo.vet  # saca el claim, deja la cuenta
node scripts/super-admins.mjs delete viejo@leo.vet  # borra la cuenta de Auth
```

**`revoke` es lo que se quiere casi siempre.** Deja el usuario de Auth en pie, así
que un id que aparezca en `registros_auditoria.user_id` sigue siendo resoluble, y
devolver el acceso es re-correr `crear-super-admin.mjs`. `delete` es para una
cuenta que no debería existir (un email de prueba, uno mal escrito). Ninguno de
los dos toca la auditoría: `registros_auditoria.user_id` no tiene FK a
`auth.users`, así que los registros históricos quedan intactos — que es
exactamente lo que se espera de un log append-only (RN-S3).

Los dos se niegan a dejar la plataforma **sin ningún** Super Admin: no hay camino
de recuperación por la aplicación (`platform_role` solo se escribe con la
service_role key), así que quedarse sin ninguno significa perder la consola hasta
volver a correr un script con esa llave. Se puede forzar con `--force`.

#### Olvidé la contraseña del Super Admin en producción

**No hace falta crear otro.** `crear-super-admin.mjs` es idempotente: con un email
que ya existe hace `updateUserById` y re-setea password, confirmación y claim,
conservando el resto de `app_metadata`.

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
export SUPABASE_ANON_KEY="<anon key>"          # opcional: verifica el login end-to-end
export SUPER_ADMIN_EMAIL="super@leo.vet"       # el MISMO email de siempre
export SUPER_ADMIN_PASSWORD="<password nueva>"
node scripts/crear-super-admin.mjs
```

Con `SUPABASE_ANON_KEY` presente el script inicia sesión y comprueba que el JWT
trae el claim antes de terminar, así que si imprime `✓ Verificado` la cuenta
funciona. No imprime ningún token.

Si en cambio querés **reemplazar la identidad** (el email es de una persona que se
fue, o está mal escrito), el orden importa — nunca des de baja la vieja antes de
comprobar la nueva:

```bash
# 1. Crear la nueva y verificar que entra
SUPER_ADMIN_EMAIL=nuevo@leo.vet SUPER_ADMIN_PASSWORD='…' node scripts/crear-super-admin.mjs
# 2. Entrar de verdad por /admin/login con la nueva  ← no saltear este paso
# 3. Recién ahí, sacarle el acceso a la vieja
node scripts/super-admins.mjs revoke viejo@leo.vet
# 4. Confirmar cómo quedó
node scripts/super-admins.mjs list
```

## Deploy de la API a producción (`deploy-api.sh`)

`supabase functions deploy api` empaqueta **los archivos que hay en disco**, no
los del commit en el que creés estar parado. Con un módulo a medio desarrollar
en el working tree, un deploy corrido desde la raíz del repo lo sube a
producción — con Services que consultan tablas y valores de ENUM que las
migraciones pendientes todavía no crearon allá. Ya pasó una vez (2026-09-04:
`stock` y `ventas` se subieron sin querer).

`scripts/deploy-api.sh` nunca despliega el working tree: materializa el commit
pedido en un `git worktree` descartable y despliega desde ahí.

```bash
export SUPABASE_PROJECT_REF=<project-ref>

scripts/deploy-api.sh                      # despliega origin/main
scripts/deploy-api.sh --dry-run            # corre las guardas y no despliega
scripts/deploy-api.sh --ref <commit|rama>  # otro punto de despliegue
```

Antes de subir nada corre dos guardas sobre el commit, y si alguna falla no
despliega:

1. **Módulos sin lanzar.** Busca los identificadores bloqueados (`stock` y
   `ventas` por defecto) en todo `supabase/functions/api/src`. Alcanza con que
   aparezcan en `main.ts`, en `requireModule` o en un enum de Zod. Se agregan
   más con `--block <modulo>`; para liberar uno, sacalo del array
   `BLOQUEADOS` del script.
2. **El código no puede ir adelante del esquema.** Compara la migración más
   nueva del commit contra la más nueva aplicada en el remoto
   (`supabase migration list --linked`). Es la guarda general: cubre el caso
   que la primera no ve. Se omite con `--skip-schema-check`.

Al terminar hace un smoke test: `/health` tiene que dar **200** y `/especies`
**401** (401, no 404 — prueba que la ruta existe y está detrás de
`tenantContext`). Si no da eso, el deploy no tomó.

> **`db push` es aparte y no lo hace este script.** Aplica *todas* las
> migraciones pendientes, sin selector. Con módulos en desarrollo en el árbol,
> revisá siempre `supabase migration list --linked` y `supabase db push --dry-run`
> antes de correrlo.

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
