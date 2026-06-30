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

Todas con contraseña **`Demo1234!`**:

| Rol           | Email                  |
| ------------- | ---------------------- |
| admin         | `admin@demo.local`     |
| veterinario   | `vet@demo.local`       |
| recepcionista | `recepcion@demo.local` |

Tenant: **Veterinaria Demo** · plan **premium** (los 3 módulos visibles).
