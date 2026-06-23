# CLAUDE.md — Sistema de Gestión Veterinaria "Leo" (SaaS multi-tenant)

Este archivo define las reglas que **toda** sesión de Claude Code debe respetar en este repositorio. Ante cualquier duda, la fuente de verdad es la documentación en `/docs`:

- `docs/Documento_Maestro_Veterinaria_Leo.md` (v1.0 — especificación base)
- `docs/Addendum_Documento_Maestro_Veterinaria_Leo_v1.1.md` (v1.1 — **tiene precedencia** sobre v1.0 en todo lo que redefine)
- `docs/PLAN_ETAPAS.md` (plan de desarrollo por etapas; trabajar SOLO en la etapa indicada por el usuario)

## Stack (no sustituir tecnologías sin autorización explícita)

- **Frontend:** React 18 + Vite + Tailwind CSS v4 + Radix UI. Toasts con `sonner`. Color primario `#f97316`, tipografía Inter.
- **Backend:** Hono.js sobre Supabase Edge Functions (Deno/TypeScript).
- **Datos:** Supabase PostgreSQL (RLS obligatorio), Supabase Auth (JWT), Supabase Storage (bucket privado `adjuntos-clinicos`, signed URLs).
- **Validación:** Zod en todos los request bodies y query params.
- **Observabilidad:** Sentry en backend y frontend.
- **Tests:** Vitest (unit/integración), Playwright (E2E). 

## Reglas de arquitectura INVIOLABLES

1. **Multi-tenant:** el `tenant_id` se obtiene SIEMPRE del JWT (`app_metadata.tenant_id`) vía middleware `tenantContext`. **NUNCA** se acepta `tenant_id` en body, query ni params. Toda tabla de negocio tiene `tenant_id UUID NOT NULL` + política RLS. Catálogos globales (`especies`, `razas`, `tipos_vacuna`, `permisos`) NO llevan `tenant_id`.
2. **Envelope estándar** en TODAS las respuestas:
   - Éxito: `{ "success": true, "data": <T>, "meta": { page, limit, total } }` (`meta` solo en listados).
   - Error: `{ "success": false, "error": { "code", "message", "statusCode", "details": [] } }`.
   - Los códigos salen del enum central `ErrorCode` (`src/shared/errors.ts`). No inventar códigos: si falta uno, proponerlo y agregarlo al enum en el mismo PR.
3. **Capas:** Controller (Hono route: valida con Zod, resuelve auth/permiso, delega, serializa) → Service (reglas de negocio RN-xx, única capa que toca la base) → DB. Los controllers NO contienen reglas de negocio.
**Excepción:** los catálogos globales de solo lectura (`especies`, `razas`, `tipos_vacuna`) se leen por PostgREST directo desde el frontend (con RLS), sin Controller ni Service. La regla Controller→Service aplica a toda **escritura auditable** y a la lógica de negocio que RLS no expresa.
4. **Licenciamiento:** todo endpoint de módulo vendible pasa por `requireModule('historial_clinico' | 'turnos' | 'guarderia')` → `403 MODULE_NOT_LICENSED`.
5. **Permisos:** todo endpoint valida JWT y luego el permiso del rol (RN-S2). Permisos: `manage_users`, `manage_clients`, `manage_pets`, `view_medical_history`, `manage_medical_history`, `manage_appointments`, `manage_daycare`, `manage_schedules`, `view_audit`, `manage_services`, `manage_tenant_settings`.
6. **Auditoría implícita (RN-S3/RN-UX4):** toda escritura registra en `registros_auditoria` (usuario, módulo, acción, entidad, valores previos/nuevos) desde el Service, sin intervención del usuario.
7. **Errores 5xx:** capturar en el error handler global de Hono, reportar a Sentry con tags `module` y `tenantId`, responder `INTERNAL_ERROR` con mensaje genérico. Nunca filtrar stack traces al cliente.
8. **Irreversibles:** la eutanasia (RN-EC10..12) es una transacción única vía RPC `registrar_eutanasia`; no crear endpoints que reviertan `estado='Fallecida'`.

## Convenciones de código

- **DB:** `snake_case`, `TIMESTAMPTZ DEFAULT now()`, FKs con `ON DELETE` explícito, índices en `tenant_id` y columnas de búsqueda. Migraciones en `supabase/migrations/` (nunca editar migraciones ya aplicadas; crear una nueva).
- **DTOs/API:** `camelCase`. El mapeo snake↔camel se hace en el Service.
- **Rutas:** `/api/v1`, sustantivos en plural y en español (`/mascotas`, `/turnos`, `/servicios`); Super Admin bajo `/api/v1/admin/*`.
- **Estados y enums:** usar EXACTAMENTE los valores de los ENUMs PostgreSQL del Apéndice DDL (`Pequeño|Mediano|Grande`, `Activa|Fallecida`, etc.).
- **Frontend:** componentes en `src/components`, páginas en `src/pages`, hooks de datos con fetch al envelope (helper `apiClient` que desempaqueta `data` y lanza `ApiError` con `code`). Estados vacío/cargando/error en toda lista o detalle. Accesibilidad WCAG 2.1 AA.

## Acceso a datos y rendimiento — evitar consultas N+1

- **Listados con datos relacionados en UNA sola consulta.** Todo listado que muestre campos de una entidad relacionada (p. ej. mascotas con el nombre del dueño; turnos con servicio, doctor, mascota y cliente; estadías con datos de la mascota) resuelve la relación en una única consulta: *resource embedding* de supabase-js/PostgREST (`select('*, cliente:clientes(nombre, apellido)')`) o un JOIN en SQL.
- **Prohibido el patrón N+1.** Nunca traer una lista y luego iterar (`for`/`map`) con un `await` a la base por cada fila para "rellenar" datos relacionados. Es la causa #1 de N+1 y se penaliza fuerte en serverless: cada query es un round-trip a la DB.
- **Los embeds respetan RLS.** Un embed/JOIN sobre una tabla con RLS sigue aplicando el aislamiento por tenant; no es un bypass y no debilita la regla 1.
- **Mismo principio en el frontend.** El cliente no dispara una request por fila de un listado (request waterfall): consume los datos ya embebidos que devuelve el endpoint del listado.
- **Índices.** Las FKs usadas en embeds/JOINs frecuentes deben estar indexadas (además del índice en `tenant_id`).
- En revisión de diffs, la firma del N+1 es una llamada a la base dentro de un `map`/`for` sobre un resultado de listado. Si aparece, se reescribe con embed o JOIN antes de aprobar.


## Estilo

- **Guía de estilo:** el lenguaje visual (colores, badges, headers, cards, tablas, diálogos, iconografía) está en `docs/GUIA_ESTILO.md`; respetarlo en toda pantalla para mantener consistencia. Los campos, flujos y reglas de cada pantalla los manda el Documento Maestro v1.0 + Addendum v1.1, NO la guía de estilo. El kit en `web/src/components/ui/` es heredado y no se reescribe.


## Estructura del repositorio

```
/docs                      # documentación (solo lectura para Claude Code)
/supabase
  /migrations              # DDL incremental
  /functions/api           # Edge Function única con Hono (router /api/v1)
    /src
      /middleware          # tenantContext, requireModule, requirePermission, errorHandler
      /modules/<modulo>    # <modulo>.controller.ts, <modulo>.service.ts, <modulo>.schemas.ts
      /shared              # errors.ts (ErrorCode), envelope.ts, audit.ts, db.ts
/web                       # React + Vite
/tests
  /unit                    # services por RN
  /integration             # RLS, aislamiento de tenants, middleware
  /e2e                     # Playwright por módulo
```

## Flujo de trabajo y testing (OBLIGATORIO)

- Trabajar **solo** en el alcance de la etapa activa de `docs/PLAN_ETAPAS.md`. No refactorizar otras etapas sin pedirlo.
- **TDD por RN:** antes de implementar un caso de uso, escribir los tests unitarios del Service usando las reglas RN-xx como casos (nombre del test = código RN, ej. `it('RN-TU3: rechaza solapamiento por intervalo → TURNO_SOLAPADO')`).
- Los tests de **aislamiento RLS** (un tenant no ve datos de otro) son bloqueantes desde la Etapa 1: ninguna etapa se considera terminada si fallan.
- Cada commit debe dejar el repo en verde (`npm test` + typecheck). Commits chicos, mensaje con el caso de uso/etapa (`feat(turnos): agendar con duración de servicio [Etapa 6]`).
- Al terminar una tarea, resumir: qué se implementó, qué RNs quedaron cubiertas por tests y qué quedó pendiente.
- No instalar dependencias nuevas significativas sin justificarlo primero.
