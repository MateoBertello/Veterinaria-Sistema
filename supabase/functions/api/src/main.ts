import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { buildCors, securityHeaders } from "./middleware/security.ts";
import { ok } from "./shared/envelope.ts";
import { authRouter } from "./modules/auth/auth.controller.ts";
import { usuariosRouter } from "./modules/usuarios/usuarios.controller.ts";
import { clientesRouter } from "./modules/clientes/clientes.controller.ts";
import { mascotasRouter } from "./modules/mascotas/mascotas.controller.ts";
import { tenantsRouter } from "./modules/admin/tenants.controller.ts";
import { platformAuthRouter } from "./modules/admin/platformAuth.controller.ts";
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
import { dashboardRouter } from "./modules/dashboard/dashboard.controller.ts";
import {
  especiesRouter,
  razasRouter,
  tiposVacunaRouter,
} from "./modules/catalogos/catalogos.controller.ts";
import {
  productosRouter,
  familiasRouter,
  conversionesRouter,
} from "./modules/productos/productos.controller.ts";
import { proveedoresRouter } from "./modules/proveedores/proveedores.controller.ts";
import {
  lotesRouter,
  movimientosRouter,
  existenciasRouter,
} from "./modules/stock/stock.controller.ts";
import { comprasRouter } from "./modules/compras/compras.controller.ts";
import { cajaRouter } from "./modules/caja/caja.controller.ts";
import { ventasRouter } from "./modules/ventas/ventas.controller.ts";
import {
  ajustesRouter,
  lotesAjustesRouter,
  recuentosRouter,
  devolucionesRouter,
} from "./modules/ajustes/ajustes.controller.ts";
import { fraccionamientoRouter } from "./modules/fraccionamiento/fraccionamiento.controller.ts";
import { consumoRouter } from "./modules/consumo/consumo.controller.ts";

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

// ─── Dashboard (métricas agregadas del tenant — Etapa 12A) ───────────────────
// Sin requirePermission ni requireModule: el gate es por métrica, dentro del
// Service (ver dashboard.controller.ts).
app.route("/dashboard", dashboardRouter);

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

// ─── Catálogos clínicos del tenant (Core transversal) ──────────────────────────
// Cada clínica administra los suyos. Rutas del tenant, NO bajo /admin: dejaron
// de ser globales en 20260827000001_catalogos_por_tenant.sql. La LECTURA para
// los combos sigue yendo por PostgREST directo (excepción del CLAUDE.md); acá
// vive todo lo que ESCRIBE, que es auditable y pasa por Controller → Service.
app.route("/especies", especiesRouter);
app.route("/razas", razasRouter);
app.route("/tipos-vacuna", tiposVacunaRouter);

// ─── Catálogo comercial (módulo vendible stock — Etapa C1) ─────────────────────
app.route("/productos", productosRouter);
app.route("/familias-producto", familiasRouter);
app.route("/producto-conversiones", conversionesRouter);
app.route("/proveedores", proveedoresRouter);

// ─── Stock y Compras (módulo vendible stock — Etapa C2) ────────────────────────
app.route("/lotes", lotesRouter);
app.route("/movimientos-stock", movimientosRouter);
app.route("/existencias", existenciasRouter);
app.route("/compras", comprasRouter);

// ─── Caja (módulo vendible ventas — Etapa C3) ─────────────────────────────────
app.route("/caja", cajaRouter);

// ─── Ventas (módulo vendible ventas — Etapa C4) ───────────────────────────────
app.route("/ventas", ventasRouter);

// ─── Ajustes, Recuentos y Devoluciones (módulos stock / ventas — Etapa C5) ─────
app.route("/ajustes", ajustesRouter);
app.route("/lotes", lotesAjustesRouter); // aditivo: /:id/bloquear y /:id/desbloquear
app.route("/recuentos", recuentosRouter);
app.route("/devoluciones", devolucionesRouter);

// ─── Fraccionamiento (módulo stock — Etapa C6) ─────────────────────────────────
app.route("/fraccionamiento", fraccionamientoRouter);

// ─── Consumo clínico (módulo vendible stock — Etapa C7) ───────────────────────
app.route("/consumos", consumoRouter);

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
// Autenticación de plataforma: login/refresh/logout del Super Admin. Va ANTES de
// /admin/tenants por legibilidad (son prefijos distintos, el orden no decide el
// match). Es el único camino que produce un token de plataforma: el Super Admin
// no tiene fila en `usuarios`, así que /auth/login nunca pudo dárselo.
app.route("/admin/auth", platformAuthRouter);

// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
app.route("/admin/tenants", tenantsRouter);

export default app;
