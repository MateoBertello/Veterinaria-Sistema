# DEPLOY.md — Guía de despliegue (Sistema Veterinaria "Leo")

Primer deploy y actualizaciones de un entorno (staging/producción) sobre Supabase.
Escrita al cierre de la Etapa 9 (S11). Host del frontend agnóstico: se documentan
los requisitos y un ejemplo concreto.

## 0. Prerrequisitos

- Proyecto Supabase creado (anotar `<project-ref>`), Supabase CLI ≥ 2.x logueada.
- Cuenta [Resend](https://resend.com) con remitente/dominio verificado (emails de notificaciones).
- Proyecto Sentry (dos DSN sugeridos: backend y frontend).
- Hosting de estáticos para `web/` (nginx, Netlify, Vercel, etc.).
- Node 20+ para buildear el front y correr scripts.

## 1. Orden de deploy

El orden importa: primero el esquema, después los secrets (la función los lee al
arrancar), después la función, al final el front.

```bash
# 1. Vincular el repo al proyecto (una vez por máquina)
supabase link --project-ref <project-ref>

# 2. Migraciones (todas, en orden; incluye extensiones, RLS, RPCs y jobs pg_cron)
supabase db push

# 3. Secrets del Edge Function (ver §2)
supabase secrets set --env-file ./prod.env   # o uno por uno: supabase secrets set CLAVE=valor

# 4. Edge Function única (Hono, router /api/v1)
supabase functions deploy api

# 5. Secrets de Vault para el cron de notificaciones (ver §3 — requiere la URL de la función ya desplegada)

# 6. Frontend (ver §4)
cd web && npm ci && npm run build            # → web/dist/
```

Para actualizaciones, repetir 2 → 4 → 6 según lo que haya cambiado. Las migraciones
ya aplicadas no se editan jamás: todo cambio de esquema es una migración nueva.

## 2. Secrets del Edge Function (`supabase secrets set`)

| Variable | Obligatoria | Uso |
| :--- | :--- | :--- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | (auto) | Las inyecta Supabase en las funciones desplegadas; **no** setearlas a mano en prod. |
| `SENTRY_DSN` | Recomendada | DSN backend. Sin ella, los 5xx no se reportan (la API responde igual). Los eventos viajan con tags `module` y `tenantId` y **sin PII** (scrub en `errorHandler.ts`). |
| `SENTRY_ENVIRONMENT` | Opcional | `production` / `staging` (default: `production`). |
| `RESEND_API_KEY` | Sí (notificaciones) | API key de Resend (`re_...`). |
| `NOTIF_FROM_EMAIL` | Sí (notificaciones) | Remitente verificado, ej. `Veterinaria Leo <turnos@tu-dominio.com>`. Para pruebas sin dominio: `Nombre <onboarding@resend.dev>`. |
| `CRON_SECRET` | Sí (cron) | Valor aleatorio largo. Autoriza `POST /internal/notificaciones/procesar` (header `X-Cron-Secret`). Fail-closed: sin él, la ruta interna rechaza todo. |
| `AUTH_REDIRECT_URL` | Sí | URL del front para el mail de recuperación de contraseña, ej. `https://app.tu-dominio.com/reset-password` (default: `http://localhost:3000/reset-password`). |
| `CORS_ALLOWED_ORIGINS` | Según hosting | Lista separada por comas de orígenes del front (ej. `https://app.tu-dominio.com`). La allowlist nunca es `*` (fallback dev: `localhost:5173`). Solo interviene si el front llama a la función **directo** (cross-origin); con el proxy same-origin del §4 el navegador no dispara CORS. |
| `SUPABASE_JWT_SECRET` | Solo proyectos con JWT simétrico | Secreto con el que el proyecto firma los JWT, para verificarlos (`shared/jwt.ts`). **Los proyectos actuales NO la necesitan**: firman con claves asimétricas (ES256) y la verificación usa el JWKS público, que se resuelve solo desde `SUPABASE_URL`. Setearla únicamente en proyectos viejos que sigan con HS256 — sin ella, un token HS256 se rechaza (fail-closed). Se encuentra en Dashboard → Settings → API → JWT Settings. |

> **Por qué la función verifica la firma ella misma.** La Edge Function está
> desplegada con `verify_jwt = false` porque tiene que atender `/auth/login`,
> que llega sin token: el gateway no valida nada y la función es públicamente
> alcanzable. Por eso `tenantContext` y `requireSuperAdmin` verifican la firma
> del JWT (`shared/jwt.ts`) antes de mirar ningún claim. Es indispensable en
> `/admin/*`, que opera con `service_role` y por lo tanto no tiene a RLS como
> segunda barrera. No hay nada que configurar en un proyecto nuevo: alcanza con
> `SUPABASE_URL`, que Supabase ya inyecta.

## 3. Secrets de Vault — cron de notificaciones (DT-10)

La migración `20260706000003_cron_notificaciones.sql` deja programado el job
pg_cron horario, pero queda **inerte** hasta cargar dos secrets en Vault
(SQL Editor del Dashboard, una sola vez por entorno):

```sql
SELECT vault.create_secret('<mismo valor que CRON_SECRET>', 'cron_notif_secret');
SELECT vault.create_secret('<URL completa del endpoint>',   'cron_notif_url');
```

**Path del endpoint** (SINGLE `api`, no doble). Supabase strippea solo `/functions/v1`
y conserva el nombre de la función (`api`), que coincide con el primer segmento del
basePath de Hono (`/api/v1`) → ese `api` se comparte, no se repite. Verificado contra
prod: single `api` → la ruta matchea; doble `api` → 404.

- Producción: `https://<project-ref>.supabase.co/functions/v1/api/v1/internal/notificaciones/procesar`
- Local (pg_net corre dentro del contenedor de DB): `http://host.docker.internal:54321/functions/v1/api/v1/internal/notificaciones/procesar`

Sin estos secrets, `disparar_notificaciones()` hace `RAISE WARNING` y no dispara
(sin romper nada). Para rotar: `SELECT vault.update_secret(id, '<nuevo>') FROM vault.secrets WHERE name = '...';`

El otro job pg_cron (`auditoria-purga-semanal`, retención RN-AUD4 = 12 meses,
domingos 04:00 UTC) es SQL puro y **no necesita secrets**: queda operativo con
la sola migración. Verificación de ambos jobs:

```sql
SELECT jobname, schedule FROM cron.job;
-- notificaciones-hourly    | 0 * * * *
-- auditoria-purga-semanal  | 0 4 * * 0
```

## 4. Frontend

### Variables de build (Vite las hornea en el bundle)

| Variable | Uso |
| :--- | :--- |
| `VITE_API_URL` | Base de la API. Hosting estático: `https://<project-ref>.supabase.co/functions/v1/api/v1` (single `api`). Con reverse proxy puede omitirse (default: `/api/v1`, relativo). |
| `VITE_SUPABASE_URL` | Solo hosting estático: `https://<project-ref>.supabase.co`. Junto con la anon key activa el **modo directo** de catálogos (`web/src/api/catalogos.ts`). |
| `VITE_SUPABASE_ANON_KEY` | Solo hosting estático: anon key del proyecto. Es pública por diseño (identifica el proyecto; RLS + Bearer del usuario son la barrera — `anon` no tiene ni SELECT desde DT-5). |
| `VITE_SENTRY_DSN` | DSN frontend. Sin ella, Sentry del front es no-op (el ErrorBoundary sigue funcionando). |
| `VITE_SENTRY_ENVIRONMENT` | Opcional (default: modo de Vite). |

### Opción A — Hosting estático sin proxy (Vercel / Netlify)

Setear las 3 primeras variables de la tabla en el build. El front llama a la
Edge Function y a PostgREST **directo** (cross-origin), así que además hay que
setear el secret `CORS_ALLOWED_ORIGINS` (§2) con el dominio del front. El SPA
fallback ya está en el repo: `web/vercel.json` (Vercel) y `web/public/_redirects`
(Netlify). Config del proyecto en el hosting: root `web/`, build `npm run build`,
output `dist/`.

Cobertura de test del modo directo: `web/src/api/catalogos.test.ts` (URL
absoluta + apikey; el modo proxy sigue siendo el default sin las variables).

### Opción B — Reverse proxy propio (nginx/Caddy en VPS)

Mantiene la anon key fuera del bundle y todo same-origin (CORS no interviene).
El proxy replica las rutas del dev (`web/vite.config.ts`):

1. `/api/v1/*` → `https://<project-ref>.supabase.co/functions/v1/api/v1/*` (la API Hono; single `api`, ver §3).
2. `/rest/v1/*` → `https://<project-ref>.supabase.co/rest/v1/*` **inyectando el header `apikey: <anon-key>`** server-side (catálogos globales: `especies`, `razas`, `tipos_vacuna`; el usuario aporta su `Authorization: Bearer`).
3. SPA fallback: todo lo demás → `index.html`.

```nginx
location /api/v1/ {
  proxy_pass https://<project-ref>.supabase.co/functions/v1/api/v1/;
  proxy_set_header Host <project-ref>.supabase.co;
}

# `/rest/v1` es PostgREST crudo: todas las tablas y todos los métodos. El único
# uso legítimo desde el front son los tres catálogos globales, de lectura. Se
# acota a GET/HEAD para no exponer una ventana de escritura al esquema entero.
# La base ya lo impide por su lado (el rol `authenticated` perdió INSERT/UPDATE/
# DELETE en la migración 20260725000003), pero conviene que el borde tampoco lo
# ofrezca: son dos candados independientes.
location /rest/v1/ {
  limit_except GET HEAD { deny all; }
  proxy_pass https://<project-ref>.supabase.co/rest/v1/;
  proxy_set_header Host <project-ref>.supabase.co;
  proxy_set_header apikey "<anon-key>";
}
location / { try_files $uri /index.html; }
```

> **Nota sobre el modo directo (Opción A).** Ahí no hay proxy que acotar: el
> navegador habla con PostgREST con la anon key del bundle. La barrera es
> exclusivamente la base — privilegios de tabla y RLS —, que es justamente lo
> que endurece la migración `20260725000003`: `authenticated` quedó de solo
> lectura y cada tabla sensible exige, además del tenant, que el usuario esté
> activo y tenga el permiso que pediría el endpoint dueño del dato.

## 5. Bootstrap de datos (entorno nuevo)

**Producción NO usa `scripts/seed.mjs`** (es el seeder de demo de DEV; además
se niega contra URLs remotas salvo `SEED_ALLOW_REMOTE=1`). El alta real es:

1. **Super Admin**: crear el usuario en Supabase Auth (Dashboard → Authentication,
   o admin API) y asignarle en App Metadata: `{ "platform_role": "super_admin" }`
   (lo valida `requireSuperAdmin` y la función SQL `is_super_admin()`).
2. **Primer tenant**: logueado como Super Admin, alta por
   `POST /api/v1/admin/tenants` (RPC `crear_tenant`: crea roles, permisos,
   configuración y módulos según plan) y su usuario admin inicial por los
   endpoints de `/api/v1/admin/*`.
3. Lo demás (usuarios, servicios, horarios, clientes) se carga desde la app
   con el admin del tenant.

Para **staging/demo** sí puede usarse el seeder completo (tenant "Veterinaria
Demo" + usuarios por rol + datos operativos de los 3 módulos + mascota
fallecida por eutanasia):

```bash
SEED_ALLOW_REMOTE=1 SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> npm run seed
```

Credenciales que deja: `admin@demo.local` / `vet@demo.local` /
`recepcion@demo.local`, password `Demo1234!` (rotarlas si el entorno es accesible).

## 6. Checklist post-deploy

- [ ] `GET https://<project-ref>.supabase.co/functions/v1/api/v1/especies` sin JWT → `401` con envelope `{ success: false, ... }` (la función corre y el auth gatea).
- [ ] Login desde el front desplegado → carga el panel de inicio (proxy `/api/v1` OK). Probar **tipeando** el usuario, no pegándolo, y con otra combinación de mayúsculas.
- [ ] Alta de mascota: el select de especies se llena (proxy `/rest/v1` + apikey OK).
- [ ] `SELECT jobname FROM cron.job;` muestra los 2 jobs (§3).
- [ ] Vault: `SELECT name FROM vault.secrets;` muestra `cron_notif_secret` y `cron_notif_url`.
- [ ] Sentry backend: forzar un 5xx (o esperar al primero real) y verificar el evento con tags `module`/`tenantId` y sin PII.
- [ ] Sentry frontend: verificar que el proyecto recibe el evento de prueba (o al menos que la app carga con `VITE_SENTRY_DSN` seteada).
- [ ] Bucket privado `adjuntos-clinicos` existe (lo crea la migración de Storage; los archivos van por signed URLs).
- [ ] Recuperación de contraseña: el mail llega y el link apunta a `AUTH_REDIRECT_URL`.

### Verificaciones de seguridad (agregadas tras el endurecimiento de auth)

- [ ] **Token forjado a `/admin/*` → 401.** Con un JWT armado a mano (`alg: none` o firma inventada) con `app_metadata.platform_role = "super_admin"`:
      `curl -s -o /dev/null -w '%{http_code}' https://<ref>.supabase.co/functions/v1/api/v1/admin/tenants -H "Authorization: Bearer <token-forjado>"` → **401**.
      Si responde 200, la verificación de firma no está activa y la consola de plataforma queda abierta.
- [ ] **Escritura directa por PostgREST → 403 (`42501`).** Logueado como un usuario cualquiera:
      `PATCH /rest/v1/usuarios?id=eq.<uno-mismo>` con `{"full_name":"x"}` → **403 `42501`**.
      Es el control que impide auto-asignarse un rol, borrar auditoría o revertir una eutanasia salteando la API.
- [ ] **Lectura acotada por permiso.** Un usuario SIN `view_audit` que consulta `GET /rest/v1/registros_auditoria` recibe **`[]`** (no un error): RLS filtra por permiso, no solo por tenant.
- [ ] **Desactivar deja afuera de verdad.** Desactivar un usuario desde la app y verificar que ya no puede autenticarse (`POST /auth/v1/token` → error de usuario baneado) y que su token todavía vigente no devuelve filas.
- [ ] **Rate limit del login.** 6 intentos fallidos seguidos contra la misma cuenta → el 6.º responde **429 `RATE_LIMITED`**; un login correcto de otro usuario desde la misma IP sigue funcionando.
- [ ] **Continuidad de sesión.** Dejar la app abierta más de una hora (o forzar el vencimiento) y confirmar que sigue operativa: el cliente renueva con el refresh token en vez de mandar a `/login`.
