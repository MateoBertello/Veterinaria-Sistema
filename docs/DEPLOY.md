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

## 3. Secrets de Vault — cron de notificaciones (DT-10)

La migración `20260706000003_cron_notificaciones.sql` deja programado el job
pg_cron horario, pero queda **inerte** hasta cargar dos secrets en Vault
(SQL Editor del Dashboard, una sola vez por entorno):

```sql
SELECT vault.create_secret('<mismo valor que CRON_SECRET>', 'cron_notif_secret');
SELECT vault.create_secret('<URL completa del endpoint>',   'cron_notif_url');
```

**Gotcha del path** (función `api` + basePath `/api/v1` → el segmento `api` se repite en prod):

- Producción: `https://<project-ref>.supabase.co/functions/v1/api/api/v1/internal/notificaciones/procesar`
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
| `VITE_API_URL` | Base de la API. Si el hosting proxea `/api/v1` (recomendado, ver abajo) puede omitirse (default: `/api/v1`, path relativo). |
| `VITE_SENTRY_DSN` | DSN frontend. Sin ella, Sentry del front es no-op (el ErrorBoundary sigue funcionando). |
| `VITE_SENTRY_ENVIRONMENT` | Opcional (default: modo de Vite). |

### Rutas que el hosting debe resolver

En dev las resuelve el proxy de Vite (`web/vite.config.ts`); en prod el hosting
tiene que replicarlas:

1. `/api/v1/*` → `https://<project-ref>.supabase.co/functions/v1/api/api/v1/*` (la API Hono; mismo doble `api` del §3).
2. `/rest/v1/*` → `https://<project-ref>.supabase.co/rest/v1/*` **inyectando el header `apikey: <anon-key>`** server-side (catálogos globales por PostgREST directo: `especies`, `razas`, `tipos_vacuna`; el usuario aporta su `Authorization: Bearer`).
3. SPA fallback: todo lo demás → `index.html`.

Ejemplo nginx:

```nginx
location /api/v1/ {
  proxy_pass https://<project-ref>.supabase.co/functions/v1/api/api/v1/;
  proxy_set_header Host <project-ref>.supabase.co;
}
location /rest/v1/ {
  proxy_pass https://<project-ref>.supabase.co/rest/v1/;
  proxy_set_header Host <project-ref>.supabase.co;
  proxy_set_header apikey "<anon-key>";
}
location / { try_files $uri /index.html; }
```

Alternativa sin proxy (hostings sin inyección de headers): setear
`VITE_API_URL=https://<project-ref>.supabase.co/functions/v1/api/api/v1` y
exponer la anon key en el bundle para `/rest/v1`. La anon key es pública por
diseño (RLS es la barrera real); hoy el código del front espera la apikey
inyectada por proxy, así que esta variante requiere un ajuste menor en
`web/src/api/catalogos.ts`. Preferir el proxy.

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

- [ ] `GET https://<project-ref>.supabase.co/functions/v1/api/api/v1/especies` sin JWT → `401` con envelope `{ success: false, ... }` (la función corre y el auth gatea).
- [ ] Login desde el front desplegado → `/clientes` carga (proxy `/api/v1` OK).
- [ ] Alta de mascota: el select de especies se llena (proxy `/rest/v1` + apikey OK).
- [ ] `SELECT jobname FROM cron.job;` muestra los 2 jobs (§3).
- [ ] Vault: `SELECT name FROM vault.secrets;` muestra `cron_notif_secret` y `cron_notif_url`.
- [ ] Sentry backend: forzar un 5xx (o esperar al primero real) y verificar el evento con tags `module`/`tenantId` y sin PII.
- [ ] Sentry frontend: verificar que el proyecto recibe el evento de prueba (o al menos que la app carga con `VITE_SENTRY_DSN` seteada).
- [ ] Bucket privado `adjuntos-clinicos` existe (lo crea la migración de Storage; los archivos van por signed URLs).
- [ ] Recuperación de contraseña: el mail llega y el link apunta a `AUTH_REDIRECT_URL`.
