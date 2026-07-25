# Plan de trabajo: portar UI de Repo 2 + cerrar paneles admin + MVP (Repo 1 "Veterinaria Leo")

> Documento de trabajo. Pensado para pegarse en `docs/` de `MateoBertello/Veterinaria-Sistema`.
> Repo destino (el bueno): **`Veterinaria-Sistema`** — Supabase + Hono + React.
> Repo fuente (referencia visual): **`veterinarialeo`** — export de Figma + Firebase.

---

## 0. Reencuadre: qué está hecho y qué no (leer antes de empezar)

Tres correcciones al plan original que ahorran trabajo y evitan retrocesos:

| Tema | Creencia inicial | Realidad en el código | Qué hacer entonces |
| :-- | :-- | :-- | :-- |
| **Resend** | "Hay que implementarlo" | **Ya está** (`CanalEmailResend` en `supabase/functions/api/src/shared/notificaciones/canal-email.ts`). Se usa en notificaciones (cron) y en el envío de resúmenes de historial (RN-EC9). | Solo **configurar** secrets + verificar dominio. Ver §5. |
| **Panel de accesibilidad** | "Portar el de Repo 2" | Repo 1 **ya tiene** `PreferencesContext` + `PreferenciasPage`, y es **mejor**: persiste **por usuario** (`leo:prefs:<userId>`) y respeta `prefers-reduced-motion` del SO. El de Repo 2 es global (localStorage único). | **No reemplazar el motor.** Portar solo el **botón flotante** y las **opciones extra** de Repo 2, montándolos sobre el `PreferencesContext` existente. Ver Etapa 10. |
| **"Bundle de UI"** | "Repo 2 tiene mejor UI" | Ambos usan **el mismo kit** (Radix + shadcn, mismas versiones). El CLAUDE.md de Repo 1 **prohíbe** reescribir `web/src/components/ui/`. Lo que hace ver mejor a Repo 2 es: el **Dashboard**, la **riqueza de accesibilidad** y el **espaciado/densidad**. | Portar esas piezas concretas, no el kit. Ver Etapas 10 y 12. |

**Estado del backend de los 3 paneles pedidos: COMPLETO.** El frontend es greenfield (no existen ni las páginas ni los clientes API). Endpoints ya disponibles:

- **Usuarios** (permiso `manage_users`): `GET /usuarios` (paginado), `POST /usuarios`, `PUT /usuarios/:id`, `GET /usuarios/roles`.
- **Auditoría** (permiso `view_audit`): `GET /auditoria` (filtros: `search, module, action, userId, dateFrom, dateTo, page, limit`), `GET /auditoria/export` (CSV; devuelve headers `X-Export-Truncated` / `X-Export-Total-Matching` / `X-Export-Rows` si trunca).
- **Super Admin** (middleware `requireSuperAdmin`): `GET /admin/tenants` (filtros `q, plan, estado`), `GET /admin/tenants/:id`, `POST /admin/tenants`, `PUT /admin/tenants/:id`, `PATCH /admin/tenants/:id/estado`, `POST /admin/tenants/:id/invitar-admin`, `GET /admin/tenants/:id/modulos`, `PUT /admin/tenants/:id/modulos/:modulo`.

---

## 1. Setup previo: darle a Claude Code acceso a Repo 2 como referencia

Los componentes de Repo 2 **no se pueden copiar tal cual**: importan servicios de Firestore y tipos propios. Se usan como **referencia visual/UX** y se recablean los datos al `apiClient` y a los tipos de Repo 1.

Preparación (una vez), dentro del repo destino:

```bash
# En la raíz de Veterinaria-Sistema
mkdir -p docs/_ref-ui
git clone https://github.com/Tesis1111/veterinarialeo.git docs/_ref-ui/veterinarialeo
echo "docs/_ref-ui/" >> .gitignore   # referencia local, NO se commitea
```

Así Claude Code puede leer `docs/_ref-ui/veterinarialeo/src/app/components/...` cuando el prompt se lo indique. Archivos de referencia clave:

- Dashboard → `docs/_ref-ui/veterinarialeo/src/app/components/Dashboard.tsx`
- Accesibilidad → `.../components/AccessibilityButton.tsx` + `.../context/UIPreferencesContext.tsx`
- Usuarios → `.../components/modules/UsersModule.tsx` (+ `.../services/userService.ts` para ver el `ROLE_META`)
- Auditoría → `.../components/modules/AuditModule.tsx`
- Estilos/accesibilidad CSS → `.../src/styles/globals.css` (clases `.compact-mode`, `.high-contrast`, `.font-*`, `.table-*`, `.card-*`, `.reduce-motion`)

---

## 2. Orden de planes recomendado (y por qué en ese orden)

El orden **no** es el del pedido original; se reordena por dependencias y riesgo. Regla: primero lo **fundacional y de bajo riesgo**, después lo que **ya tiene backend** (wins rápidos), y al final lo **más integrador**.

```
Etapa 10 — Fundaciones visuales (accesibilidad + densidad + tema)   [bajo riesgo, alto impacto visual]
   └─ 10A  Extender PreferencesContext con opciones de Repo 2
   └─ 10B  Botón flotante de accesibilidad (sobre el motor existente)
   └─ 10C  Importar clases CSS de densidad/contraste
   └─ 10D  (opcional) Reconciliación fina de tokens de tema

Etapa 11 — Paneles de administración (backend YA hecho)             [greenfield front, sin sorpresas de backend]
   └─ 11A  Gestión de Usuarios      (manage_users)
   └─ 11B  Auditoría                (view_audit)
   └─ 11C  Super Admin / Tenants    (requireSuperAdmin)  ← el más grande

Etapa 12 — Dashboard                                                [el más integrador; necesita endpoints de conteo]
   └─ 12A  Endpoints de métricas/resumen (si faltan)
   └─ 12B  Portar Dashboard recableado al apiClient

Etapa 13 — Cierre de MVP + Resend en producción                     [deploy real]
```

**Racional del orden:**

- **10 primero** porque el look/densidad es transversal: si se construyen los paneles nuevos *antes* de fijar el sistema visual, hay que repasarlos después. Además es casi todo CSS + un componente + cablear un contexto que ya existe → poco riesgo de romper reglas de negocio.
- **11 antes que 12** porque los paneles tienen el **backend terminado** (velocidad, cero incógnitas de datos), mientras que el Dashboard probablemente necesite endpoints de **agregación/conteo** que hoy no existen (los listados sí traen `meta.total`, pero no hay un endpoint de métricas). Construir el Dashboard al final permite que consuma datos reales de todo lo demás.
- **11C (Super Admin) al final del 11** porque abre un **área nueva** de la app (rutas `/admin/*`, guard `requireSuperAdmin`, layout aparte) y conviene hacerlo con Usuarios y Auditoría ya resueltos como patrón.
- **13 al final**: nada de deploy hasta que el `npm test` + `typecheck` estén en verde con todo lo nuevo.

---

## 3. Prompts para Claude Code — Etapa 10 (fundaciones visuales)

> Recordatorio: el CLAUDE.md del repo se lee solo. Los prompts son escuetos a propósito y delegan en él. Trabajar **una sub-etapa por sesión**, dejar el repo en verde antes de pasar a la siguiente.

### Prompt 10A — Extender el motor de preferencias

```
Contexto: quiero enriquecer el sistema de accesibilidad SIN romper su arquitectura.
Fuente de verdad del motor actual: web/src/preferences/PreferencesContext.tsx
(persistencia por usuario en localStorage `leo:prefs:<userId>`, aplica CSS var
--font-size + clases en <html>, respeta prefers-reduced-motion). NO cambiar ese
diseño: sigue siendo por-usuario y OS-aware.

Referencia de opciones a incorporar (solo como catálogo de features, NO copiar su
implementación global): docs/_ref-ui/veterinarialeo/src/app/context/UIPreferencesContext.tsx

Tarea (Etapa 10A):
1. Extender el tipo Preferences con las opciones nuevas que SÍ mapean a CSS real:
   - density ya existe (comfortable|compact); agregar tableViewMode: "compact"|"comfortable"|"expanded"
   - agregar cardSpacing: "tight"|"normal"|"relaxed"
   - highContrast y reducedMotion ya existen; mantener.
   (Descartar showAvatars/animationsEnabled del repo de referencia si son redundantes
   con reducedMotion o no aplican; justificarlo en el resumen.)
2. En applyPreferences(), togglear las clases correspondientes en <html>
   (table-compact/comfortable/expanded, card-tight/normal/relaxed), manteniendo el
   patrón actual de toggle de clases.
3. Actualizar loadPreferences() con sanitización de los nuevos campos (type guards),
   sin lanzar nunca.
4. Tests unitarios del contexto siguiendo el estilo existente (PreferencesContext.test.tsx):
   defaults, persistencia por usuario, sanitización de valores inválidos, aplicación de clases.

Respetar convenciones del CLAUDE.md. Dejar `npm test` + typecheck en verde.
Al terminar: resumir qué opciones se agregaron, cuáles se descartaron y por qué.
```

### Prompt 10B — Botón flotante de accesibilidad

```
Tarea (Etapa 10B): portar el botón flotante de accesibilidad como capa de PRESENTACIÓN
sobre el motor existente (usePreferences() de web/src/preferences/PreferencesContext.tsx).

Referencia visual/UX (NO copiar su lógica de estado ni sus imports de Firestore/localStorage):
docs/_ref-ui/veterinarialeo/src/app/components/AccessibilityButton.tsx

Requisitos:
- Nuevo componente web/src/components/accesibilidad/AccessibilityButton.tsx.
- Botón fijo (esquina inferior derecha) que abre un panel (usar el kit de web/src/components/ui/:
  Popover o Sheet, lo que mejor calce; NO reescribir el kit).
- Todos los controles leen/escriben vía usePreferences() (fontSize, density, tableViewMode,
  cardSpacing, highContrast, reducedMotion) + botón "Restablecer" (reset()).
- Accesible: rol/aria correctos, foco atrapado en el panel, cerrable con Esc, target táctil
  ≥ 44px, contraste AA. Debe convivir con el skip-link existente del Shell.
- Montarlo en el Shell de web/src/App.tsx para que aparezca en todas las pantallas autenticadas
  (no en /login).
- La PreferenciasPage existente sigue funcionando (misma fuente de datos). Si queda redundante,
  proponer en el resumen si se deja como "vista completa" o se deprecia; NO borrarla en esta etapa.
- Tests de componente (render, cambios de preferencia reflejados en <html>, reset, accesibilidad
  básica con testing-library).

Respetar CLAUDE.md y GUIA_ESTILO.md (color primario #f97316, Inter). Dejar el repo en verde.
```

### Prompt 10C — Clases CSS de densidad/contraste

```
Tarea (Etapa 10C): incorporar las reglas CSS de densidad, contraste y tablas que consumen
las clases que togglea PreferencesContext.

Referencia: docs/_ref-ui/veterinarialeo/src/styles/globals.css
(bloques .font-small/.font-large, .compact-mode, .table-compact/comfortable/expanded,
.card-tight/normal/relaxed, .high-contrast, .reduce-motion).

Requisitos:
- Añadir esas reglas al CSS global de Repo 1 (web/src/components/styles/global.css o donde
  vivan los estilos globales; ubicarlo correctamente según el import chain actual).
- ADAPTAR los nombres/escalas a las clases que realmente togglea nuestro PreferencesContext
  (density-compact, no compact-mode, salvo que se unifique el naming en 10A; ser consistente).
- Alto contraste: en Repo 1 el primario es naranja #f97316 — ajustar los overrides de contraste
  a nuestra paleta (no dejar overrides pensados para otra paleta).
- reduce-motion: respetar además el @media (prefers-reduced-motion) del sistema.
- Verificar manualmente en 2-3 pantallas (Clientes, Turnos) que compact/expanded y highContrast
  se ven bien y no rompen el layout.

No tocar reglas de negocio. Dejar typecheck + build del front en verde.
```

### Prompt 10D — (Opcional) Reconciliación de tokens de tema

```
Tarea (Etapa 10D, OPCIONAL — solo si tras 10A-C el look sigue por detrás de la referencia):
comparar los design tokens (:root) de ambos proyectos y traer SOLO lo que mejore el acabado
sin violar el spec.

Referencia: docs/_ref-ui/veterinarialeo/src/styles/globals.css (:root)
Restricción dura del proyecto: primario #f97316, tipografía Inter (CLAUDE.md + Documento Maestro).
NO cambiar el primario ni la tipografía.

Candidatos a portar (evaluar uno por uno, sin romper contraste AA):
- --radius y escalas de radios (sensación de redondeo).
- Escala de grises/foreground/muted-foreground si mejora legibilidad.
- Tokens de chart (--chart-1..5) para que los gráficos del Dashboard (Etapa 12) queden coherentes.

Entregar un diff mínimo y justificado. Correr la suite de componentes del front tras el cambio.
```

---

## 4. Prompts para Claude Code — Etapa 11 (paneles admin)

> El backend está hecho. Cada panel = cliente API nuevo (`web/src/api/<x>.ts` sobre el helper
> `apiClient` que desempaqueta `data` y lanza `ApiError`) + página + componentes + tests.
> Seguir el patrón de un módulo ya existente (p. ej. `web/src/api/servicios.ts` + `ServiciosPage`)
> como plantilla de estilo.

### Prompt 11A — Gestión de Usuarios

```
Tarea (Etapa 11A): construir el frontend del módulo Gestión de Usuarios. El BACKEND YA EXISTE;
solo consumirlo.

Endpoints (permiso manage_users, ya aplicado en el backend):
- GET  /usuarios?page&limit           → listado paginado (envelope con meta.total)
- POST /usuarios                       → crear (ver CrearUsuarioSchema del backend para el shape)
- PUT  /usuarios/:id                   → editar (EditarUsuarioSchema)
- GET  /usuarios/roles                 → catálogo de roles

Referencia visual/UX (NO copiar imports de Firestore; recablear todo al apiClient y a
web/src/types): docs/_ref-ui/veterinarialeo/src/app/components/modules/UsersModule.tsx
(mirar también .../services/userService.ts por el mapa ROLE_META de badges/labels de rol).

Requisitos:
1. web/src/api/usuarios.ts con funciones tipadas (listar, crear, editar, listarRoles) usando
   apiClient; mapeo snake↔camel si hiciera falta del lado del front.
2. Tipos en web/src/types (Usuario, Rol) coherentes con lo que devuelve el backend.
3. web/src/pages/UsuariosPage.tsx: tabla paginada con estados vacío/cargando/error (obligatorio),
   búsqueda si aplica, badges de rol y de estado.
4. Diálogos de alta/edición (usar el kit ui/ + react-hook-form como el resto del repo), validando
   en cliente lo mismo que valida el backend (Zod del lado server manda; el front no debe permitir
   enviar lo que el server rechazaría).
5. Recordar la deuda ya resuelta DT-1: al asignar rol veterinario el backend hace UPSERT en doctores
   — el front solo refleja el resultado; no duplicar lógica.
6. Ruta protegida en App.tsx (/usuarios) visible solo con permiso manage_users (ver cómo el Sidebar
   arma items por permiso en lib/navigation.ts).
7. Tests: cliente API (mock fetch/envelope), página (render de estados, paginación), diálogos
   (validación, submit). Nombrar por caso.

Respetar CLAUDE.md (envelope, apiClient, accesibilidad AA) y GUIA_ESTILO.md. Repo en verde.
```

### Prompt 11B — Auditoría

```
Tarea (Etapa 11B): frontend del módulo Auditoría. BACKEND YA HECHO.

Endpoints (permiso view_audit):
- GET /auditoria?search&module&action&userId&dateFrom&dateTo&page&limit  → paginado con filtros
- GET /auditoria/export?<mismos filtros menos page/limit>                 → descarga CSV.
  OJO: si el export se truncó, el backend NO falla: manda headers
  X-Export-Truncated=true, X-Export-Total-Matching, X-Export-Rows. El front DEBE detectarlos
  y avisar al usuario que la descarga está truncada (nunca silencioso).

Referencia visual/UX: docs/_ref-ui/veterinarialeo/src/app/components/modules/AuditModule.tsx
(recablear datos al apiClient; los registros los sirve GET /auditoria).

Requisitos:
1. web/src/api/auditoria.ts: listar(filtros) + exportarCsv(filtros) — este último maneja la
   respuesta como blob y lee los headers de truncado (usar fetch directo con el token, ya que
   apiClient probablemente asume JSON; ver auth/session para el token).
2. web/src/pages/AuditoriaPage.tsx: barra de filtros (texto, módulo, acción, usuario, rango de
   fechas), tabla paginada con estados vacío/cargando/error, y botón "Exportar CSV" que respeta
   los filtros activos y muestra un toast si el resultado vino truncado.
3. Mostrar valores previos/nuevos de cada asiento de forma legible (diff simple) sin volcar JSON crudo.
4. Ruta /auditoria protegida por permiso view_audit.
5. Tests: cliente (incluye caso de export truncado → aviso), página (filtros, paginación, estados).

Respetar convenciones. Repo en verde.
```

### Prompt 11C — Super Admin / Tenants

```
Tarea (Etapa 11C): construir el área Super Admin (gestión de tenants y módulos). BACKEND YA HECHO.
Es un ÁREA NUEVA de la app, separada del shell normal.

Endpoints (todos bajo requireSuperAdmin — el usuario debe ser super_admin de plataforma):
- GET   /admin/tenants?page&limit&q&plan&estado
- GET   /admin/tenants/:id
- POST  /admin/tenants
- PUT   /admin/tenants/:id
- PATCH /admin/tenants/:id/estado            (body: { activo: boolean })
- POST  /admin/tenants/:id/invitar-admin     (reintento idempotente, RN-SA2)
- GET   /admin/tenants/:id/modulos           (estado de módulos vendibles del tenant)
- PUT   /admin/tenants/:id/modulos/:modulo   (body: { habilitado: boolean }; modulo ∈
                                              historial_clinico|turnos|guarderia)

Requisitos:
1. web/src/api/admin.ts con todas las funciones tipadas (apiClient).
2. Rutas /admin/* con su propio layout/guard: solo super_admin entra. Reusar el patrón de
   ProtectedRoute pero chequeando la condición de super admin (ver cómo el backend identifica
   super_admin: middleware requireSuperAdmin / claim del JWT; el front debe leer el equivalente
   de la sesión, NO confiar solo en ocultar el link).
3. Pantalla lista de tenants: tabla paginada con filtros (q, plan, estado), acción de activar/
   desactivar (PATCH estado con confirmación), y acceso al detalle.
4. Detalle de tenant: datos + edición (PUT), botón "Invitar admin" (POST invitar-admin, idempotente),
   y panel de módulos: un switch por módulo vendible que llama PUT .../modulos/:modulo. Reflejar
   MODULE_UNKNOWN / errores del envelope.
5. Alta de tenant (POST) con su formulario (CrearTenantSchema del backend como contrato).
6. Estados vacío/cargando/error en todas las listas y el detalle. Accesibilidad AA.
7. Tests: cliente API, guard de super admin (no-super-admin es rechazado), lista (filtros/paginación),
   toggle de módulos, activar/desactivar.

Respetar CLAUDE.md. Este panel NO pasa por requireModule (es plataforma, no módulo vendible).
Repo en verde.
```

---

## 5. Prompts para Claude Code — Etapa 12 (Dashboard)

El Dashboard de Repo 2 lee Firestore directo (`traerClientes`, `traerMascotas`,
`traerTodosLosHistoriales`, `traerTurnos`, `onSnapshot`, …). Portarlo = **recablear cada fuente**
al apiClient de Repo 1 **y** probablemente crear endpoints de **conteo/resumen** (hoy no hay un
endpoint de métricas; solo `meta.total` en cada listado).

### Prompt 12A — Endpoints de métricas (crear solo lo que falte)

```
Tarea (Etapa 12A): proveer los datos agregados que necesita un dashboard, respetando la
arquitectura Controller→Service y multi-tenant (tenant_id del JWT, RLS).

Antes de crear nada, verificar qué se puede resolver con los listados existentes usando
?limit=1 y leyendo meta.total (clientes, mascotas, turnos, etc.). Crear endpoint nuevo SOLO
para lo que no se pueda derivar así sin caer en N+1.

Si hace falta un resumen, crear un módulo dashboard (o metricas) con:
- GET /dashboard/resumen → { clientes: n, mascotasActivas: n, turnosHoy: n, ... } resuelto en el
  Service con consultas agregadas (COUNT), UNA por métrica, respetando RLS. Prohibido el patrón
  N+1 (nada de traer listas y contar en el loop).
- Envelope estándar. Permisos: pensar qué rol ve el dashboard (probablemente cualquiera autenticado
  del tenant; documentarlo).
- Tests unitarios del Service (conteos por tenant, aislamiento) + integración RLS (un tenant no ve
  conteos de otro) — BLOQUEANTE.

Respetar CLAUDE.md. Repo en verde.
```

### Prompt 12B — Portar el Dashboard

```
Tarea (Etapa 12B): portar el Dashboard como pantalla principal post-login, recableado 100% al
apiClient de Repo 1.

Referencia visual/UX: docs/_ref-ui/veterinarialeo/src/app/components/Dashboard.tsx
(tomar el LAYOUT, las tarjetas de métricas, los accesos rápidos por rol y los gráficos con recharts;
DESCARTAR todo import de Firestore/onSnapshot y su DashboardPreferences en localStorage).

Requisitos:
1. web/src/pages/DashboardPage.tsx que consuma GET /dashboard/resumen (o los meta.total de los
   listados, según Etapa 12A) vía web/src/api/dashboard.ts.
2. Tarjetas de métricas + accesos rápidos que naveguen a las páginas reales del repo (clientes,
   turnos, historial, usuarios, /admin si es super admin). Mostrar/ocultar tarjetas según permisos
   y módulos habilitados (reusar la lógica de módulos de lib/navigation.ts / fetchModulosHabilitados).
3. Gráficos con recharts (ya es dependencia del front) usando los tokens de chart del tema.
4. Estados vacío/cargando/error. Accesibilidad AA. Respetar densidad/preferencias (Etapa 10).
5. Cambiar la ruta "/" para que renderice el Dashboard en vez de redirigir a /clientes
   (App.tsx: hoy hace <Navigate to="/clientes">).
6. Tests: cliente de métricas, render de tarjetas según permisos/módulos, estados.

Respetar CLAUDE.md. Repo en verde.
```

---

## 6. Instructivo: cerrar el MVP + poner Resend en producción

El MVP está al cierre de la **Etapa 9 (S11)**; existe `docs/DEPLOY.md`. Esta es la lista de
cierre concreta, en orden.

### 6.1. Pre-cierre (código)

1. Terminar Etapas 10–12 con `npm test` (unit + integración RLS) + `typecheck` en verde. Ninguna
   etapa cierra con tests de aislamiento de tenant en rojo (regla del CLAUDE.md).
2. Correr la suite completa una vez de punta a punta antes de tocar infra:
   ```bash
   npm test && npm run test:integration && (cd web && npm run test:run) && npm run typecheck
   npm run test:e2e   # Playwright
   ```
3. Revisar `TODO.md`: todas las deudas DT-1..DT-13 figuran resueltas. Verificar que no se agregó
   deuda nueva sin registrar durante las etapas 10–12.

### 6.2. Provisión de servicios

4. **Supabase**: proyecto creado, `supabase link --project-ref <ref>`.
5. **Sentry**: dos DSN (backend y frontend).
6. **Resend**: cuenta creada (ver 6.3 para el dominio).
7. **Hosting del front**: Netlify o Vercel (el repo trae `web/public/_redirects` de Netlify y
   `web/vercel.json`; elegir uno). El front llama same-origin a `/api/v1/*` y el host lo proxea a
   la Edge Function — así el login evita CORS.

### 6.3. Configurar Resend (esto es "implementar Resend" en la práctica)

Resend ya está en el código; solo faltan credenciales y un remitente verificado.

**Opción de prueba (sin dominio, para validar el flujo ya mismo):**
- `NOTIF_FROM_EMAIL="Veterinaria Leo <onboarding@resend.dev>"`
- Limitación: el sandbox de Resend **solo entrega a la casilla de tu propia cuenta Resend**.
  Sirve para probar, **no** para mandar a clientes reales.

**Opción producción (obligatoria para emailear clientes reales):**
1. En Resend → Domains → agregar tu dominio (ej. `tudominio.com`).
2. Resend te da registros DNS: **SPF (TXT)**, **DKIM (CNAME/TXT)** y conviene **DMARC (TXT)**.
   Cargarlos en el DNS del dominio (ver §7 sobre dónde comprarlo).
3. Esperar verificación (minutos a horas). Estado "Verified".
4. Setear el remitente con ese dominio: `NOTIF_FROM_EMAIL="Veterinaria Leo <turnos@tudominio.com>"`.

### 6.4. Cargar secrets y desplegar (orden importa: esquema → secrets → función → front)

```bash
# 1) Migraciones
supabase db push

# 2) Secrets del Edge Function
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set NOTIF_FROM_EMAIL="Veterinaria Leo <turnos@tudominio.com>"
supabase secrets set CRON_SECRET="<valor-aleatorio-largo>"
supabase secrets set AUTH_REDIRECT_URL="https://app.tudominio.com/reset-password"
supabase secrets set CORS_ALLOWED_ORIGINS="https://app.tudominio.com"
supabase secrets set SENTRY_DSN="<dsn-backend>"   # opcional pero recomendado
# (SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY las inyecta Supabase sola en prod: NO setearlas)

# 3) Edge Function
supabase functions deploy api

# 4) Secrets de Vault para el cron de notificaciones (DT-10) — en el SQL Editor del Dashboard:
#    SELECT vault.create_secret('<mismo valor que CRON_SECRET>', 'cron_notif_secret');
#    SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1/api/v1/internal/notificaciones/procesar', 'cron_notif_url');
#    (path SINGLE `api`, no doble — está documentado en DEPLOY.md y en el _redirects)

# 5) Frontend
cd web && npm ci && npm run build   # → web/dist ; publicar en Netlify/Vercel
#    Setear en el build del host: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (para catálogos).
```

### 6.5. Smoke test post-deploy

8. Login real, crear cliente/mascota (verifica catálogos + RLS en prod).
9. Disparar un email real: enviar un resumen de historial por email (RN-EC9) a una casilla propia
   y confirmar recepción (valida Resend + dominio).
10. Verificar el cron: que `disparar_notificaciones()` no tire `RAISE WARNING` (señal de secrets de
    Vault faltantes). Confirmar los dos jobs en `cron.job` (notificaciones + purga de auditoría).
11. Provocar un 5xx controlado y verificar que llega a Sentry con tags `module`/`tenantId` y sin PII.
12. Recuperación de contraseña: que el mail use `AUTH_REDIRECT_URL` correcto.

Con eso, MVP cerrado y operativo.

---

## 7. ¿Comprar dominio en Hostinger? — respuesta

**Sí necesitás un dominio.** Dos razones lo vuelven casi obligatorio para el MVP real:

1. **Resend**: para emailear a clientes reales necesitás un remitente en tu propio dominio con
   SPF/DKIM verificados. Sin dominio quedás en el sandbox (`onboarding@resend.dev`), que solo
   entrega a tu propia casilla → inservible para producción.
2. **URL profesional del front** (`app.tudominio.com`) y `AUTH_REDIRECT_URL` de recuperación de
   contraseña. Da imagen y evita depender de subdominios de Netlify/Vercel.

**Pero no tiene que ser Hostinger, y casi seguro NO conviene su plan de hosting.** Tu stack corre
en **Supabase** (backend/DB) + **Netlify o Vercel** (frontend estático). No usás un servidor de
hosting tradicional, así que pagar hosting en Hostinger sería plata al pedo. Lo único que necesitás
comprar es **el nombre de dominio** (registro) y poder **editar sus DNS**.

Recomendación práctica:

| Necesidad | Qué comprar | Comentario |
| :-- | :-- | :-- |
| Solo el dominio + DNS bueno y barato | **Cloudflare Registrar** o **Porkbun** | Dominio a precio de costo, DNS gratis y rápido, fácil cargar los TXT/CNAME de Resend. Ideal para este stack. |
| Ya tenés/preferís Hostinger | **Solo el dominio** de Hostinger | Perfecto: comprás el dominio, entrás al panel DNS y cargás SPF/DKIM/DMARC de Resend + el CNAME/registro que te pida Netlify o Vercel para `app.tudominio.com`. **No** contrates su hosting. |
| Querés todo en un lugar | Hostinger dominio + apuntar DNS | Funciona igual; la diferencia con Cloudflare/Porkbun es sobre todo precio y comodidad del panel DNS. |

**Resumen:** comprá **un dominio** (Hostinger sirve, pero Cloudflare/Porkbun suelen salir más
baratos y con mejor DNS). **No** compres hosting en Hostinger: el frontend va a Netlify/Vercel y el
backend a Supabase. Con el dominio verificado en Resend y apuntado al host del front, cerrás el
punto 6.3 y el MVP queda listo para usuarios reales.
