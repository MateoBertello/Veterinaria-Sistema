# PLAN_ETAPAS.md — Plan de desarrollo por etapas (Veterinaria "Leo" v1.1)

**Cómo usar este plan con Claude Code:** trabajar una etapa por vez, en sesiones de 1–2 casos de uso. Una etapa está **terminada** cuando: (a) todos sus criterios de aceptación (RN) tienen test que pasa, (b) los tests de RLS siguen en verde, (c) el usuario revisó y aprobó los diffs. Recién entonces se avanza. Las referencias RN-xx remiten al Documento Maestro v1.0 y al Addendum v1.1 (`/docs`); el Addendum tiene precedencia.


## Nota de arquitectura: infraestructura de notificaciones (email)

Varias etapas necesitan enviar email, pero la **infraestructura de envío real** (proveedor
tipo Resend/SMTP, con su config y secrets) **NO está construida todavía** y se difiere a una
sesión dedicada. Esto es trabajo planificado, no deuda técnica.

**Estado por etapa:**
- **E5 (Historial):** RN-EC9 (resumen por email al cliente) implementa solo la LÓGICA DEL FLAG
  `sendEmailToClient` — marca `emailSent:true/false` y audita, sin entrega real. La regla queda
  cubierta por tests; falta solo el envío.
- **E6 (Turnos):** RN-NT1..NT6 (recordatorios automáticos) necesitan envío real vía
  `NotificacionService`.
- **E8 (Vacunación):** RN-PV6/PV7 (avisos de dosis próximas) reusan el mismo
  `NotificacionService`.

**Decisión:** construir la infraestructura de email **una sola vez**, como `NotificacionService`
genérico (idealmente al arrancar E6, que es la primera que exige entrega real), y que E5/E6/E8
la consuman. Integrar un proveedor de email es una **dependencia nueva** → requiere aprobación
explícita según CLAUDE.md antes de instalarla.

**Pendiente concreto cuando se construya:** enchufar el envío real en los puntos donde hoy solo
se setea el flag (RN-EC9 de E5 es el primero).

**Extensibilidad futura (no comprometido):** `NotificacionService` se diseña como genérico
por CANAL, de modo que un canal adicional (p. ej. WhatsApp Business API) pueda sumarse sin
tocar las etapas consumidoras. WhatsApp NO está en el spec v1.1 y NO se construye en el plan
actual — queda como posible feature de producto post-v1 (implica cuenta Meta aprobada,
plantillas pre-aprobadas y costo por mensaje; es un proyecto en sí mismo, no un agregado).

---

## Etapa 1 — Fundaciones (sin pantallas)

**Objetivo:** base técnica sobre la que se montan todos los módulos.

**Alcance:**
- Proyecto Supabase + monorepo según estructura de `CLAUDE.md`; CI con typecheck y tests.
- Migración inicial: **DDL completo del Apéndice** (enums, tablas, constraints, índices, funciones `current_tenant_id()`, `is_super_admin()`, RLS) + `seed_global.sql` (Nivel 1) + función `on_tenant_created()` (Nivel 2).
- Edge Function `api` con Hono: router base `/api/v1`, middleware `tenantContext`, `requireModule` (con caché 60 s e invalidación), `requirePermission`, error handler global con Sentry.
- `src/shared`: enum `ErrorCode` completo, helpers de envelope, helper de auditoría, cliente DB.
- Helper `apiClient` del frontend (sin UI todavía).

**Criterios de aceptación (tests):**
- Envelope: toda respuesta cumple el contrato (éxito con/sin `meta`; error con `code/message/statusCode/details`).
- `tenantContext`: request sin JWT → 401; JWT sin `tenant_id` → 401; `tenant_id` en body/query es ignorado.
- `requireModule`: módulo deshabilitado → `403 MODULE_NOT_LICENSED` (RN-G2); habilitar/deshabilitar invalida caché (RN-SM3).
- **RLS (bloqueante):** con dos tenants sembrados, ninguna consulta de A devuelve filas de B en `clientes`, `mascotas`, `turnos`, `estadias`, `historial_clinico`, `servicios`; catálogos globales legibles por ambos; tablas de plataforma solo para `is_super_admin()`.
- `seed_global.sql` idempotente (re-ejecutable sin duplicados); `on_tenant_created()` crea 3 roles con permisos correctos, configuración `(10, 7)` y módulos según plan (basico→HC, profesional→+turnos, premium→+guardería).

**Entregables:** migraciones aplicadas, suite `tests/integration/rls.test.ts` verde, README de arranque local.

---

## Etapa 2 — Autenticación, Seguridad y Super Admin

**Objetivo:** identidad, roles y plano de control de la plataforma.

**Alcance (casos de uso):**
- v1.0 §2.1: Registrar/Editar Usuario · Autenticación (login/logout) · Recuperar Usuario/Contraseña (sobre Supabase Auth).
- v1.1 §7: **Crear/Gestionar Tenant** · **Gestionar Módulos Contratados** (consola Super Admin, pantalla 7 del prompt Figma).
- Endpoint `GET /api/v1/modulos-habilitados` y sidebar dinámico del tenant (oculta módulos no contratados, RN-G2).

**Criterios de aceptación (RN):**
- Seguridad v1.0: RN-S1 (nunca exponer hash; delegado en Supabase Auth), RN-S2 (JWT + permiso en todo endpoint), RN-S3 (auditoría de escrituras), reglas del caso de uso de usuarios y recuperación de v1.0 §2.1.
- Super Admin: RN-SA1 (CUIT/RUT único → `TENANT_DUPLICATE_TAXID`), RN-SA2 (alta transaccional: tenant + seeder + invitación, con rollback), RN-SA3 (tenant suspendido → 403 global), RN-SA4 (sin exponer datos de negocio), RN-SA5 (auditoría `platform`).
- Módulos: RN-SM1 (verificación por request), RN-SM2 (deshabilitar no borra datos), RN-SM3 (vigencia ≤ 60 s), RN-SM4 (auditoría de toggles).

**Entregables:** login funcional, consola Super Admin (tabla de tenants + switches HC/TU/GU), invitación del primer Admin por email.

---

## Etapa 3 — Core Cliente-Mascota

**Objetivo:** el nexo del que dependen los tres módulos vendibles.

**Alcance (casos de uso):**
- Registrar/Editar Cliente · Eliminar Cliente (v1.0 §1, con baja lógica).
- **Registrar/Editar Mascota (versión v1.1):** con `tamano` obligatorio y `alimentoDieta`.
- Cambiar Dueño de Mascota · Marcar Mascota como Fallecida (manual).
- Catálogos `GET /especies` y `GET /especies/{id}/razas` (globales).

**Criterios de aceptación (RN):**
- Clientes: reglas de v1.0 §1 (unicidad DNI/CUIT por tenant, baja lógica, auditoría `clients`).
- Mascotas: RN-MA1..MA7 (v1.0) + **RN-MA8** (`tamano` ENUM → `VALIDATION_ERROR`), **RN-MA9** (dieta máx. 500, fallback "Sin indicaciones de dieta"), **RN-MA10** (`estado` ENUM reemplaza booleano).
- Cambio de dueño: RN-CD1..CD5 (`SAME_OWNER`, trazabilidad, `clientNameAtTime` preservado).
- Fallecimiento manual: RN-MF1..MF5 (`PET_DECEASED` en altas posteriores, badge y exclusión de turnos/estadías).

**Entregables:** pantallas de Clientes y Mascotas (ficha con tamaño/dieta destacados), exportación Excel/PDF de listados.

---

## Etapa 4 — Transversales: Servicios, Configuración, Horarios, Auditoría

**Objetivo:** catálogos y parámetros que consumen Turnos, Guardería e Historial.

**Alcance (casos de uso):**
- **Gestión de Servicios** (v1.1 §2.4, pantalla 4 Figma).
- **Configuración de la Clínica** (v1.1 §2.5, pantalla 5 Figma).
- Gestionar Horarios de Profesional (v1.0 §2.2) + ABM de Doctores.
- Consultar y Exportar Auditoría (v1.0 §2.3).

**Criterios de aceptación (RN):**
- Servicios: RN-SV1 (duración 5–480 múltiplo de 5), RN-SV2 (`SERVICE_IN_USE` por nombre duplicado activo), RN-SV3 (baja protegida con turnos futuros), RN-SV4 (`requiereProfesional`), RN-SV5 (tenant del JWT), RN-SV6/SV7 (permiso `manage_services`, auditoría `services`).
- Configuración: RN-CF1 (singleton GET/PUT), RN-CF2 (rangos 1–500 / 1–90), RN-CF3 (efecto inmediato sin cancelar reservas), RN-CF4/CF5 (permiso `manage_tenant_settings`, auditoría).
- Horarios: reglas RN-HOR de v1.0 (franjas válidas, sin solapamiento de franjas, RN-HOR3 alimenta slots).
- Auditoría: filtros, exportación y registro `EXPORT`.

**Entregables:** CRUD de servicios, panel de configuración con sticky footer, gestión de horarios, vista de auditoría.

---

## Etapa 5 — Historial Clínico (módulo vendible)

**Objetivo:** registro clínico longitudinal, con eutanasia transaccional y adjuntos.

**Alcance (casos de uso):**
- Consultar Historial Clínico (v1.0 §3).
- **Registrar Evento Clínico (versión v1.1):** incluye flujo de **Eutanasia** (pantalla 8 Figma) y campo opcional `proximaDosis` (persiste el ítem del plan; la UI del plan llega en Etapa 8).
- Exportar / Enviar Historial (v1.0 §3).
- Adjuntos a Supabase Storage (bucket privado + signed URLs).
- RPC `registrar_eutanasia` (migración).

**Criterios de aceptación (RN):**
- Consulta: RN-HC1..HC5 (orden desc, último peso derivado, dueño histórico, permiso, índice `(pet_id, date)`).
- Registro: RN-EC1..EC9 (obligatorios, `PET_DECEASED`, adjuntos JPG/PNG/GIF/PDF ≤10 MB, `clientNameAtTime`, rangos clínicos, email condicional).
- Eutanasia: **RN-EC10** (`EUTHANASIA_CONFIRMATION_REQUIRED` sin flag), **RN-EC11** (transacción única evento+estado; test de rollback), **RN-EC12** (sin endpoint de reversión); cancela dosis pendientes (RN-PV4).
- Exportación: RN-EX1..EX5 (`EMPTY_HISTORY`, PDF maquetado, auditoría `EXPORT`).

**Entregables:** vista de historial con timeline, formulario seccionado de evento, modal crítico de eutanasia, export PDF/Excel.

---

## Etapa 6 — Turnos (módulo vendible)

**Objetivo:** agenda con duración por servicio y ciclo de vida completo.

**Alcance (casos de uso):**
- **Agendar Turno (versión v1.1):** Combobox de Servicio, `endTime` calculado server-side (pantalla 1 Figma).
- **Modificar / Cancelar Turno (versión v1.1):** modal unificado de detalle con acciones por estado (pantalla 2 Figma).
- Gestionar Estado del Turno (v1.0 §4).
- Notificaciones Automáticas de Turnos (v1.0 §4) implementadas ya como `NotificacionService` genérico (tabla `notificaciones` con `origen`), dejando listo el segundo procesador para la Etapa 8.

**Criterios de aceptación (RN):**
- Agendar: RN-TU1..TU8 (v1.0, con RN-TU3 actualizada a solapamiento **por intervalo** → `TURNO_SOLAPADO`) + **RN-TU9** (servicio activo obligatorio, `endTime` ignorado si viene del cliente) + **RN-TU10** (doctor obligatorio según servicio).
- Modificar/Cancelar: RN-MC1 (matriz de acciones por estado + `accionesDisponibles` en el DTO → `APPOINTMENT_LOCKED`), RN-MC2 (revalidación con duración vigente), RN-MC3..MC7.
- Estados: RN-ES1..ES5 (`INVALID_TRANSITION`, terminalidad).
- Notificaciones: RN-NT1..NT6 (ventana, exclusiones, idempotencia por `UNIQUE(tenant, origen, referencia, canal)`, canales según contacto, cron + disparo manual).
- Test de concurrencia: dos requests simultáneos al mismo bloque → solo uno persiste.

**Entregables:** agenda por fecha, formulario de agendar, modal de detalle con 4 variantes de estado, job de recordatorios.

---

## Etapa 7 — Guardería (módulo vendible)

**Objetivo:** estadías con cupo configurable y datos de la mascota visibles.

**Alcance (casos de uso):**
- **Registrar Estadía (versión v1.1):** tarjeta de mascota (tamaño + dieta) e indicador de cupo por día (pantalla 3 Figma); endpoint `GET /estadias/cupo`.
- Modificar / Cancelar Estadía (v1.0 §5).
- Check-in / Check-out (v1.0 §5).

**Criterios de aceptación (RN):**
- Registro: RN-GU1..GU3, RN-GU5..GU7 (v1.0) + **RN-GU4 actualizada**: cupo por día contra `configuracion_tenant.cupo_maximo_diario` → `CUPO_GUARDERIA_AGOTADO` con días afectados en `details`; test de borde exacto (ocupados = cupo) y test de que reducir el cupo no cancela reservas existentes (RN-CF3).
- Modificación: RN-ME1..ME6 (`STAY_LOCKED`, revalidación de rango y solapamiento `STAY_OVERLAP`).
- Check-in/out: RN-CK1..CK6 (`INVALID_TRANSITION`, marcas temporales, liberación de cupo).

**Entregables:** formulario de estadía con cupo visual, vista de ocupación por día, acciones de check-in/out.

---

## Etapa 8 — Plan de Vacunación (cierra Historial Clínico)

**Objetivo:** timeline de dosis y avisos automáticos reutilizando notificaciones.

**Alcance (casos de uso):**
- **Gestión de Plan de Vacunación** (v1.1 §3, pantalla 6 Figma): timeline, programar/editar/cancelar dosis, marcar aplicada (transacción plan+evento), catálogo `GET /tipos-vacuna`.
- `NotificacionService.procesarAvisosVacunacion()` + cron + endpoint manual.

**Criterios de aceptación (RN):**
- RN-PV1 (estados persistidos vs `estadoVisual` derivado Próxima/Vencida), RN-PV2 (`PAST_DATE`), RN-PV3 (`VACCINE_TYPE_NOT_FOUND`), RN-PV4 (eutanasia cancela pendientes — test cruzado con Etapa 5), RN-PV5 (`VACCINE_PLAN_ALREADY_APPLIED`), RN-PV6 (idempotencia de avisos), RN-PV7 (ventana = `diasAvisoVacuna` del tenant; test con dos tenants con configuraciones distintas), RN-PV8/PV9 (permisos y auditoría).

**Entregables:** pestaña de plan en la ficha de mascota, job de avisos, integración con el registro de Vacunación de la Etapa 5.

---

## Etapa 9 — Hardening y cierre

**Objetivo:** calidad transversal antes de producción.

**Alcance:** suite E2E Playwright por módulo (flujos felices + errores clave), auditoría WCAG 2.1 AA (foco visible, contraste, aria-labels, focus trap en modales), revisión de índices con `EXPLAIN` sobre los listados, panel de preferencias de accesibilidad (RN-UX3), revisión de tasas de error en Sentry, seeds de demo, documentación de despliegue, y re-ejecución completa de la matriz RN→test (todas las RN de las etapas 1–8 con test en verde).

---

## Matriz de avance (completar durante el desarrollo)

| Etapa | Estado | RNs con test | Fecha de cierre | Notas |
| :---- | :---- | :---- | :---- | :---- |
| 1 — Fundaciones | Pendiente | — | — | |
| 2 — Auth + Super Admin | Backend ✅ / Frontend pendiente | RN-S1..S3, RN-SA1..SA5, RN-SM1..SM4 | 2026-06-19 | Backend cerrado: Auth+Usuarios, Super Admin/Tenants, Módulos Contratados + sidebar dinámico (lógica). Endpoint `/modulos-habilitados` en camelCase. **Frontend pendiente** (scaffold/pantallas diferidas). |
| 3 — Core | ✅ Cerrada | RN-CL1..CL9, RN-MA1..MA10, RN-CD1..CD5, RN-MF1..MF5 | 2026-06-22 | Backend (4 bloques) + pantallas Clientes y Mascotas. Catálogos por PostgREST directo vía proxy. Filtros edadCat son convención de UI. |
| 4 — Transversales | ✅ Cerrada (frontend operable) | RN-SV1..SV7, RN-CF1..CF5, RN-HOR1..HOR6, RN-AUD1..AUD5 | 2026-07-01 | Backend cerrado (2026-06-23): Servicios, Configuración, Doctores, Horarios, Auditoría (consulta + export CSV con truncación explícita). 12 unit tests de auditoría + bloque RLS-auditoria bloqueante. Frontend operable cerrado: Servicios+Configuración (commit `f0bd9dd`) y Doctores+Horarios (commit `ad2215e`, lista/edición de doctores y gestión de franjas con `INVALID_RANGE`/`SCHEDULE_OVERLAP`). **Pantalla de Auditoría (consulta/export) queda diferida a post-MVP** — su backend ya está cerrado y en verde, pero no bloquea el cierre de esta etapa. |
| 5 — Historial Clínico | ✅ Cerrada | RN-HC1..HC5, RN-EC1..EC12, RN-EX1..EX5 | 2026-07-01 | Backend cerrado: HC/EC/eutanasia transaccional/adjuntos/export PDF+XLSX; RN-EC9 con envío real de resumen por email (reusa canal Etapa 6c). Frontend cerrado: timeline + registro de evento (commit `6ee918d`); modal de eutanasia (AlertDialog con confirmación explícita), exportación PDF/Excel y acceso a Historial Clínico desde el sidebar (selector dueño→mascota, antes roto) (commit `d71edeb`). |
| 6 — Turnos | ✅ Cerrada (frontend operable) | RN-TU1..TU10, RN-MC1..MC7, RN-ES1..ES5, RN-NT1..NT6 | 2026-07-05 | Backend cerrado: agendar con duración por servicio, transiciones de estado, modificar/cancelar, `NotificacionService` genérico + recordatorios (canal email Resend). Frontend cerrado: agenda por fecha (6d-1), formulario de agendar (6d-2), modal de detalle con acciones por estado + edición reusando el flujo de agendar en modo PUT (6d-3). Ajustes de UX: vista calendario mensual (una query, sin N+1), atajo Editar y transición de estado inline en la fila, y **valor del estado** (chips Activos/Completados/Cancelados reusando `?date=&status=`, resumen del día programados/confirmados, acento por estado) + ayuda del flujo. `accionesDisponibles`/derivación de transición como autoridad (el front dibuja, el backend valida). 182 tests de componente verdes. **Cron de recordatorios diferido a E9.** |
| 7 — Guardería | Backend ✅ / Frontend pendiente | RN-GU1..GU7, RN-ME1..ME6, RN-CK1..CK6 | 2026-06-30 | Backend cerrado: Registrar+cupo (RPC `crear_estadia_con_cupo` con `FOR UPDATE` anti-overbooking), Modificar/Cancelar (`modificar_estadia_con_cupo`/`cancelar_estadia`), Check-in/out (`hacer_checkin`/`hacer_checkout`: transiciones Reservada→EnCurso→Finalizada con marcas temporales y liberación de cupo implícita). Las tres con RPCs ejercitados de verdad en integración (ciclo de cupo cruzado, transiciones, aislamiento tenant×RPC y HTTP, REVOKE anon). **Frontend pendiente** (formulario con cupo visual, ocupación por día, acciones check-in/out). |
| 8 — Plan de Vacunación | Backend ✅ / Frontend pendiente | RN-PV1..PV9 | 2026-06-30 | Backend cerrado: plan de dosis (CRUD + marcar aplicada transaccional) y **avisos automáticos** (RN-PV6/PV7) reusando `NotificacionService` (`origen='vacunacion'`); idempotencia por el UNIQUE de `notificaciones`; ventana por-tenant (`diasAvisoVacuna`); endpoint manual `POST /notificaciones/vacunas/procesar` (cron diferido a E9, junto con turnos). Integración bloqueante verde: idempotencia real por UNIQUE, ventana dos tenants, aislamiento. **Frontend pendiente** (pestaña de plan en la ficha de mascota). |
| 9 — Hardening | Pendiente | — | — | |
