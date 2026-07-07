import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { buildCors, securityHeaders } from "./middleware/security.ts";
import { ok } from "./shared/envelope.ts";
import { authRouter } from "./modules/auth/auth.controller.ts";
import { usuariosRouter } from "./modules/usuarios/usuarios.controller.ts";
import { clientesRouter } from "./modules/clientes/clientes.controller.ts";
import { mascotasRouter } from "./modules/mascotas/mascotas.controller.ts";
import { tenantsRouter } from "./modules/admin/tenants.controller.ts";
import { modulosRouter } from "./modules/modulos/modulos.controller.ts";
import { serviciosRouter } from "./modules/servicios/servicios.controller.ts";
import { configuracionRouter } from "./modules/configuracion/configuracion.controller.ts";
import { doctoresRouter } from "./modules/doctores/doctores.controller.ts";
import {
  horariosDoctorRouter,
  horariosRouter,
} from "./modules/horarios/horarios.controller.ts";
import { auditoriaRouter } from "./modules/auditoria/auditoria.controller.ts";
import {
  historialRouter,
  historialMascotaRouter,
  adjuntosRouter,
} from "./modules/historial/historial.controller.ts";
import { turnosRouter } from "./modules/turnos/turnos.controller.ts";
import { notificacionesRouter } from "./modules/notificaciones/notificaciones.controller.ts";
import { cronNotificacionesRouter } from "./modules/notificaciones/cron.controller.ts";
import { guarderiaRouter } from "./modules/guarderia/guarderia.controller.ts";
import {
  planVacunacionRouter,
  planVacunacionMascotaRouter,
  avisosVacunacionRouter,
} from "./modules/vacunacion/vacunacion.controller.ts";

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Seguridad transversal (Etapa 9 / S7) ──────────────────────────────────
// CORS con allowlist explícita + security headers en TODA respuesta. Se registran
// antes de los routers: el preflight OPTIONS lo resuelve buildCors() sin llegar al
// tenantContext de cada módulo.
app.use("*", buildCors());
app.use("*", securityHeaders);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json(ok({ status: "ok", ts: new Date().toISOString() }));
});

// ─── Módulos habilitados del tenant autenticado (sidebar dinámico) ──────────
app.route("/modulos-habilitados", modulosRouter);

// ─── Módulo Auth ──────────────────────────────────────────────────────────────
app.route("/auth", authRouter);

// ─── Módulo Usuarios ──────────────────────────────────────────────────────────
app.route("/usuarios", usuariosRouter);

// ─── Módulo Clientes (Core Cliente-Mascota) ────────────────────────────────────
app.route("/clientes", clientesRouter);

// ─── Módulo Mascotas (Core Cliente-Mascota) ────────────────────────────────────
app.route("/mascotas", mascotasRouter);

// ─── Módulo Servicios (Transversal — Etapa 4) ──────────────────────────────────
app.route("/servicios", serviciosRouter);

// ─── Configuración de la Clínica (Transversal — Etapa 4) ───────────────────────
app.route("/configuracion", configuracionRouter);

// ─── Doctores + Horarios de Atención (Transversal — Etapa 4) ───────────────────
// Doctores: ABM (listar/editar) bajo manage_users.
// Horarios: franjas anidadas (/doctores/:id/horarios, /doctores/horarios/resumen)
// y operaciones planas (/horarios/:id) bajo manage_schedules. Hono permite
// registros aditivos en el mismo prefijo /doctores.
app.route("/doctores", horariosDoctorRouter);
app.route("/doctores", doctoresRouter);
app.route("/horarios", horariosRouter);

// ─── Auditoría (Transversal — Etapa 4) ────────────────────────────────────────
app.route("/auditoria", auditoriaRouter);

// ─── Historial Clínico (módulo vendible — Etapa 5) ───────────────────────────
app.route("/historial", historialRouter);
app.route("/mascotas", historialMascotaRouter); // aditivo: /:petId/historial y /:petId/resumen-clinico
app.route("/adjuntos", adjuntosRouter);          // descarga de adjuntos por signed URL

// ─── Turnos (módulo vendible — Etapa 6) ──────────────────────────────────────
// Notificaciones se registra primero: su prefijo /turnos/notificaciones es más
// específico que el /turnos/:id de la agenda (Hono permite registros aditivos).
app.route("/turnos/notificaciones", notificacionesRouter);
app.route("/turnos", turnosRouter);

// ─── Guardería (módulo vendible — Etapa 7) ───────────────────────────────────
app.route("/estadias", guarderiaRouter);

// ─── Plan de Vacunación (módulo historial_clinico — Etapa 8) ─────────────────
// planVacunacionMascotaRouter: aditivo en /mascotas → /:petId/plan-vacunacion
// planVacunacionRouter:        rutas planas → /plan-vacunacion/:id
app.route("/mascotas", planVacunacionMascotaRouter);
app.route("/plan-vacunacion", planVacunacionRouter);
// avisosVacunacionRouter: disparo manual de avisos → /notificaciones/vacunas/procesar (RN-PV6/PV7)
app.route("/notificaciones/vacunas", avisosVacunacionRouter);

// ─── Cron de notificaciones (sistema, fuera de tenant — Etapa 9 / RN-NT5) ────────
// Disparado por pg_cron→pg_net (no por un usuario); protegido por X-Cron-Secret.
// Barre todos los tenants activos con el módulo licenciado (turnos + vacunas).
app.route("/internal/notificaciones", cronNotificacionesRouter);

// ─── Consola Super Admin (fuera de tenant) ──────────────────────────────────────
// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
app.route("/admin/tenants", tenantsRouter);

export default app;
