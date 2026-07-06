# Prompts — Etapa 9, sub-sesiones S2–S11

Cada bloque es un prompt copy-paste para abrir la sub-sesión en una conversación nueva de
Claude Code. Todos asumen que CLAUDE.md se carga solo y que la deuda está consolidada en
`TODO.md` (DT-1..DT-9) y la cobertura en `docs/MATRIZ_RN_TESTS.md` (generados en S1).

**Regla de la serie:** una sub-sesión por conversación; si el alcance crece, se corta y se
re-planifica — no se fuerza el cierre. Cada sub-sesión termina con `npm test` (unit +
integración con stack local) + suite web + typecheck en verde, y commit propio con sufijo
`[Etapa 9]`.

## Qué modelo usar

| Sub-sesión | Modelo | Por qué |
| :-- | :-- | :-- |
| S2 — Deuda chica | **Sonnet 5** | Cambios mecánicos y acotados; la suite protege. |
| S3 — GRANT anon | **Sonnet 5** | Una migración + un test; el paso crítico (verificar el rol del proxy) está explicitado en el prompt. |
| S4 — DT-1/2/3 profesional | **Fable 5 (u Opus 4.8)** | Decisión de contrato que cruza 3 etapas cerradas + migración con constraint sobre datos existentes; el costo de decidir mal es alto. |
| S5 — Tests de brechas | **Sonnet 5** | Volumen de tests con criterios ya clasificados en la matriz; poco juicio abierto. |
| S6 — Cron | **Opus 4.8** | Plomería de infra (pg_cron/pg_net, secrets, stack local con gotchas) donde diagnosticar fallas raras importa más que el volumen. |
| S7 — Seguridad | **Opus 4.8** | Barrido con juicio (qué es explotable vs. ruido) y cambios transversales de middleware. |
| S8 — WCAG + RN-UX3 | **Opus 4.8** | Amplitud (todas las pantallas) + criterio de diseño/contraste; Sonnet tiende a sobre-parchear. |
| S9 — E2E Playwright | **Sonnet 5** | Escritura de specs sobre flujos ya definidos; mucho volumen, poco riesgo. |
| S10 — EXPLAIN + índices | **Opus 4.8** | Leer planes de ejecución y decidir índices compuestos/parciales es análisis, no volumen. |
| S11 — Pre-deploy | **Fable 5** | Squash de migraciones y decisiones de cierre: irreversible si sale mal, criterio > velocidad. |

Regla general: para re-abrir una sub-sesión ya encaminada (retomar un fix puntual), Sonnet 5
alcanza; para decisiones nuevas sobre etapas cerradas, subir de modelo.

---

## S2 — Deuda chica de bajo riesgo

```text
Etapa 9, sub-sesión S2 (deuda chica). Leé CLAUDE.md, TODO.md (DT-4, DT-6, DT-7) y
docs/PROMPTS_ETAPA9.md (regla de la serie). Alcance EXACTO, nada más:

1. DT-4 — seeder idempotente: en scripts/seed.mjs, rama "usuario ya existe" (~línea 195),
   re-setear password + email_confirm (auth.admin.updateUserById) para que re-correr el seed
   siempre deje credenciales usables. Probalo corriendo el seed DOS veces contra la stack
   local y logueando con las credenciales.
2. DT-6 — consistencia de códigos de error: unificar nomenclatura en
   supabase/functions/api/src/shared/errors.ts (guardería mezcla ESTADIA_NOT_FOUND con
   STAY_OVERLAP/STAY_LOCKED). Proponeme la convención ANTES de renombrar (una línea:
   opción y por qué); después aplicá el rename en errors.ts + services + front + tests en
   un solo pase. Ojo: si algún código viaja serializado al front, actualizar los usos de
   ApiError.code en web/src.
3. DT-7 — bump de vite en web/package.json a la última versión sin breaking (revisar
   changelog); verificar npm run build + suite web completa.

NO toques: los diffs sin commitear de EutanasiaDialog/EventoClinicoFormDialog (son de S4),
migraciones, ni nada fuera de estos 3 ítems. Cierre: suites verdes + typecheck, actualizar
las filas DT en TODO.md a "Resuelta (commit)", un commit por ítem o uno solo si preferís,
con sufijo [Etapa 9].
```

## S3 — GRANT a `anon` acotado

```text
Etapa 9, sub-sesión S3 (DT-5, GRANT anon). Leé CLAUDE.md, TODO.md (DT-5) y la migración
supabase/migrations/20260622000001_grants_supabase_roles.sql. Alcance:

1. PRIMERO verificá empíricamente con qué rol entra a PostgREST el proxy de catálogos del
   front (especies/razas/tipos_vacuna — el apikey se inyecta server-side; ver Etapa 3).
   Mostrame la evidencia antes de escribir SQL.
2. Migración NUEVA (jamás editar la aplicada) que revoque INSERT/UPDATE/DELETE de anon en
   public, ajuste los ALTER DEFAULT PRIVILEGES, y conserve SELECT de anon SOLO sobre los
   catálogos globales si el paso 1 lo confirma (si el proxy entra como authenticated o
   service_role, revocá también el SELECT).
3. Test de integración: anon no puede DML sobre una tabla de negocio (42501), y los
   catálogos del front siguen respondiendo (probar la pantalla real de alta de mascota
   contra la stack local, no solo el test).

Cierre: suites verdes (integración incluida), TODO.md DT-5 → Resuelta, commit
fix(seguridad): acotar GRANTs de anon a catálogos globales [Etapa 9].
```

## S4 — DT-1/2/3: identidad única del "profesional"

```text
Etapa 9, sub-sesión S4 (DT-1+DT-2+DT-3, identidad del profesional). Leé CLAUDE.md, TODO.md
(DT-1/2/3 completos) y docs/MATRIZ_RN_TESTS.md. Contexto: hay diffs SIN COMMITEAR en
web/src/components/historial/{EutanasiaDialog,EventoClinicoFormDialog}(.test).tsx que son el
workaround DT-3 — se absorben en esta sesión (decidir si sobreviven o se reemplazan).

Trabajá en este orden, con TDD (tests RN-SEC5 primero):
1. DT-1: migración nueva con UNIQUE(tenant_id, user_id) en doctores — antes, query de
   diagnóstico de duplicados existentes en la stack local y limpieza en la misma migración
   si hace falta (WHERE user_id IS NOT NULL; los doctores sin usuario no entran al UNIQUE:
   evaluá índice parcial). INSERT→UPSERT en usuarios.service.ts (crear Y editar) +
   specialty por defecto.
2. DT-2: decidí el contrato único del profesional y proponémelo en 5 líneas ANTES de
   implementar (opción sugerida en TODO.md: FK de historial sigue en usuarios(id), y el
   backend expone qué doctores son seleccionables como profesional en vez de que el front
   adivine). Documentá la semántica de id vs userId donde se serializa.
3. DT-3: con el backend filtrando, resolvé el front (quitar el filtro-parche o dejarlo como
   defensa documentada) y actualizá los tests de los dos diálogos.

Es la sesión de más riesgo de la serie: toca Etapas 2/4/5 cerradas. No refactorices nada
que no esté en DT-1/2/3. Cierre: suites verdes, TODO.md DT-1/2/3 → Resueltas, commits
chicos por DT con sufijo [Etapa 9].
```

## S5 — Cierre de brechas de la matriz RN→test

```text
Etapa 9, sub-sesión S5 (tests de brechas). Leé CLAUDE.md y docs/MATRIZ_RN_TESTS.md —
la sección "Clasificación de las 44 brechas" es tu lista de trabajo: implementá SOLO el
grupo A (36 RN) + las dos citas cruzadas del grupo C. Los grupos B y D NO van acá.

Orden sugerido (de mayor valor):
1. A1 permisos: unit test paramétrico de middleware/requirePermission.ts (RN-S2, hoy SIN
   test) + un caso 403 por controller citando la RN del módulo (RN-AUD3, CF4, CK5, EC7,
   ES4, EX5, GU6, HOR5, ME5, TU7).
2. A3 recuperación de cuenta: RN-REC1/REC2/REC3 sobre /auth/recuperar-* (hoy sin ningún
   test). El de REC2 (anti-enumeración) es el importante.
3. A4 reglas funcionales (9), A2 auditoría por módulo (5), A6 modelo de seguridad (4),
   A5 confirmaciones UI (4) — ver tabla de la matriz para el detalle de cada una.
4. C: agregar cita cruzada RN-HOR3 en el test de slots (turnos.service.test.ts) y RN-SM1
   en requireModule.test.ts.

Regla dura: nombre del test = código RN. CERO cambios de producto: si un test revela un
bug, NO lo arregles — registralo como DT nuevo en TODO.md y seguí (salvo typo trivial).
Al final actualizá docs/MATRIZ_RN_TESTS.md (tabla + resumen de cobertura). Si a mitad de
sesión el volumen se hace pesado, cortá en un commit verde y decime qué falta. Commit(s):
test(<módulo>): cubrir RN-xx.. [Etapa 9].
```

## S6 — CRON de notificaciones (turnos + vacunación)

```text
Etapa 9, sub-sesión S6 (cron de notificaciones — diferido de E6c/E8c). Leé CLAUDE.md,
docs/MATRIZ_RN_TESTS.md (brecha RN-NT5) y los endpoints existentes
POST /turnos/notificaciones/procesar y POST /notificaciones/vacunas/procesar.

Alcance:
1. Migración nueva que habilite pg_cron + pg_net y programe el job (frecuencia: proponeme
   una y justificala en una línea) que dispare el procesamiento de recordatorios de turnos
   y avisos de vacunación para TODOS los tenants con el módulo licenciado. El secret para
   invocar la Edge Function NO va hardcodeado en la migración: usá Vault
   (vault.decrypted_secrets) o equivalente y documentá cómo se setea por entorno.
2. Decisión a proponerme antes de implementar: invocar la Edge Function vía pg_net (HTTP)
   vs. llamar la lógica vía función SQL. Una línea por opción y tu recomendación.
3. Prueba REAL end-to-end de que dispara y NO spamea: en la stack local, ejecutar el job
   dos veces (cron.schedule con run inmediato o SELECT del comando del job) y verificar en
   la tabla notificaciones que el UNIQUE evitó duplicados. Test de integración RN-NT5 que
   deje esa evidencia fijada.

Gotchas de entorno: correr todo desde ~/Veterinaria-Sistema; NO supabase start sobre stack
viva; tras cambiar firmas de funciones, NOTIFY pgrst reload (ver memoria de gotchas RPC).
Cierre: suites verdes, actualizar matriz (RN-NT5 → cubierta), agregar el secret a la lista
de deploy (nota para S11), commit feat(notificaciones): cron pg_cron/pg_net [Etapa 9].
```

## S7 — Seguridad: CORS, headers, inyección

```text
Etapa 9, sub-sesión S7 (seguridad). Leé CLAUDE.md (reglas 2 y 7). Hoy NO existe middleware
CORS ni security headers en supabase/functions/api. Alcance:

1. CORS explícito en Hono: allowlist de orígenes por env var (dev: localhost:5173; prod:
   dominio real), nunca * con credenciales. Verificá que el preflight OPTIONS no rompa el
   front contra la stack local (login + una pantalla con escritura).
2. Security headers en respuestas de la API: X-Content-Type-Options, Referrer-Policy, y
   Cache-Control: no-store en respuestas con datos clínicos/personales.
3. Barrido de inyección: (a) toda interpolación de strings del usuario en .or()/.ilike()
   de supabase-js en los services con búsqueda (clientes, mascotas, etc.) — sanitizar o
   reescribir con filtros parametrizados; (b) CSV/fórmula injection en los export
   (auditoría CSV, historial XLSX): escapar celdas que empiecen con =, +, -, @.
4. Verificar con un test que ningún 5xx filtra stack trace (regla 7).

Reportá primero qué encontraste en el barrido (3) antes de tocar código, así decidimos si
algo es ruido. Tests para cada fix. Cierre: suites verdes, commit
fix(seguridad): CORS, headers e inyección [Etapa 9].
```

## S8 — WCAG 2.1 AA + panel de preferencias (RN-UX3)

```text
Etapa 9, sub-sesión S8 (accesibilidad). Leé CLAUDE.md, docs/GUIA_ESTILO.md y la definición
de RN-UX3 en el Documento Maestro (panel global: tamaño de fuente, densidad de tablas,
alto contraste, reducción de movimiento — persistido por usuario). Dos bloques:

1. Auditoría AA transversal y fixes (solo presentación, el kit web/src/components/ui es
   heredado y NO se reescribe): foco visible consistente en todos los interactivos;
   contraste — medí el ratio real de #f97316 sobre blanco donde se usa como texto o botón
   con texto y proponeme la corrección (tono más oscuro para texto vs. mantener el brand
   en superficies) ANTES de aplicarla; aria-label en icon-buttons y campos sin label;
   verificación de focus trap + retorno de foco en los modales Radix (el AlertDialog de
   eutanasia como caso crítico); navegación por teclado en los calendarios de Turnos y
   Guardería. Tests de componente para lo verificable (roles, labels, foco); citá RN-UX2
   en los asserts de toasts existentes.
2. Panel de preferencias RN-UX3: pantalla nueva según la spec, persistencia por usuario,
   aplicada globalmente (CSS vars/clases en el root). Con sus tests.

No cambies flujos ni campos (eso lo manda el Documento Maestro, no la guía de estilo).
Al cerrar: suites verdes, matriz actualizada (RN-UX2/UX3 → cubiertas), commits separados
para (1) y (2) con sufijo [Etapa 9].
```

## S9 — E2E Playwright

```text
Etapa 9, sub-sesión S9 (E2E). Leé CLAUDE.md (stack: Playwright ya previsto) y
docs/MATRIZ_RN_TESTS.md (RN-UX1 quedó para acá). Alcance:

1. Setup: instalar @playwright/test (justificación: prevista en el stack de CLAUDE.md),
   playwright.config.ts con webServer (vite dev) contra la stack local seedeada
   (npm run seed; credenciales admin_demo/Demo1234!). Un smoke test de login para validar
   el arnés antes de escribir specs.
2. Specs en tests/e2e/, por módulo, UN flujo feliz + 1-2 errores clave (no exhaustivo):
   auth (login ok, credencial mala, 401→redirect); clientes+mascotas (alta encadenada,
   búsqueda, cambio de dueño); historial (registrar evento, eutanasia con confirmación
   explícita e irreversibilidad visible, export); turnos (agendar, TURNO_SOLAPADO,
   transición de estado); guardería (estadía, cupo lleno CUPO_AGOTADO o equivalente,
   check-in/out); vacunación (plan, marcar aplicada).
3. RN-UX1 (≤3 clics para acciones frecuentes): assert de pasos en los flujos de agendar,
   registrar evento y alta de cliente desde el dashboard.

Preferí selectors por rol/label accesible (S8 ya pasó) sobre data-testid; agregá testid
solo si no hay alternativa. Si el volumen no entra en una sesión, cortá después de
auth+core en un commit verde y seguimos en S9b. Cierre: npx playwright test verde local,
matriz actualizada (RN-UX1), commit test(e2e): flujos por módulo [Etapa 9].
```

## S10 — EXPLAIN + índices

```text
Etapa 9, sub-sesión S10 (rendimiento de listados). Leé CLAUDE.md (sección N+1/índices) y
TODO.md DT-9 (solo la parte de índices de auditoría; la retención NO va acá). Alcance:

1. Generá volumen sintético en la stack local (script en scratchpad, NO en el repo:
   ~10-50k filas en turnos, estadias, historial_clinico, registros_auditoria,
   plan_vacunacion repartidas en 2+ tenants).
2. EXPLAIN (ANALYZE, BUFFERS) sobre las queries reales de los listados grandes: agenda de
   turnos por fecha y por rango mensual, estadías por rango, búsqueda ilike de
   clientes/mascotas, timeline de historial por mascota (RN-HC5), consulta de auditoría
   por fecha/módulo/usuario (RN-AUD4), barrido de avisos de vacunación. Copiá los planes
   relevantes en el informe.
3. Verificá que toda FK usada en embeds frecuentes tenga índice. Migración nueva SOLO con
   los índices que los planes justifiquen (compuestos (tenant_id, fecha) o parciales si el
   plan lo pide) — nada especulativo. Re-correr EXPLAIN y mostrar el antes/después.

Cierre: informe breve en docs/EXPLAIN_INDICES.md (queries, plan antes/después, decisión),
suites verdes, matriz actualizada si cubrís la parte de índices de RN-HC5/RN-AUD4, commit
perf(db): índices según EXPLAIN de listados [Etapa 9].
```

## S11 — Pre-deploy: migraciones, seeds, Sentry, documentación

```text
Etapa 9, sub-sesión S11 (cierre pre-deploy — ÚLTIMA de la serie; verificá que S2-S10 estén
commiteadas y en verde antes de empezar). Leé CLAUDE.md, TODO.md (DT-8 y DT-9) y
docs/PLAN_ETAPAS.md. Alcance:

1. DT-8 — historial de migraciones: evaluá consolidar las migraciones-fix en un historial
   limpio (viable solo porque no hay producción). Proponeme el plan concreto ANTES de
   tocar nada (qué se squashea, cómo se valida); gate obligatorio: supabase db reset +
   seed + LAS TRES suites verdes. Si el beneficio no justifica el riesgo, documentar el
   orden y cerrar DT-8 como "se mantiene historial".
2. DT-9 — retención de auditoría (RN-AUD4): proponeme MVP (job de purga simple, p. ej.
   reusando pg_cron de S6) vs. post-MVP documentado; implementá lo que decida.
3. Seeds de demo finales: revisar que el seed cubra los 3 módulos vendibles con datos
   presentables.
4. Sentry: verificar en la config real que los 5xx reportan con tags module y tenantId, y
   revisar tasas de error si hay DSN activo.
5. docs/DEPLOY.md nuevo: orden de deploy (migraciones → Edge Function → front), secrets
   (Resend, Sentry, cron/Vault de S6, service role), variables por entorno, y cómo correr
   el seed inicial.
6. Cierre de etapa: re-correr TODO (typecheck + unit + integración + web + Playwright),
   actualizar docs/MATRIZ_RN_TESTS.md y la Matriz de avance de PLAN_ETAPAS.md (Etapa 9 →
   Cerrada, con fecha).

Es la sesión con la única operación potencialmente destructiva de la serie (squash + db
reset): no la hagas sin mostrarme el plan del punto 1. Commits chicos por punto, sufijo
[Etapa 9].
```
