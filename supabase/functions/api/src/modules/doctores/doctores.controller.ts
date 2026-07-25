import { Hono, type Context } from "hono";
import { DoctorService, type CallerContext } from "./doctores.service.ts";
import {
  ActualizarDoctorSchema,
  ListarDoctoresQuerySchema,
} from "./doctores.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireAnyPermission, requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

export const doctoresRouter = new Hono();

/**
 * Leer el listado de profesionales NO es gestionarlos: lo necesitan el que arma
 * horarios, el que agenda un turno y el que registra un evento clínico o aplica
 * una vacuna (todos eligen un profesional de una lista). Exigir `manage_users`
 * —que solo tiene el Administrador— dejaba al veterinario sin poder usar sus
 * propias pantallas, ni siquiera para asignarse a sí mismo un horario.
 */
const puedeVerProfesionales = requireAnyPermission([
  "manage_users",
  "manage_schedules",
  "manage_appointments",
  "manage_medical_history",
  "view_medical_history",
]);

// Doctores es una extensión del usuario (RN-SEC5): su GESTIÓN sigue bajo manage_users.
const puedeGestionarProfesionales = requirePermission("manage_users");

// Autenticación → tenant activo (RN-SA3) → permiso, que difiere entre leer y
// gestionar; se elige por método para no repetir el gate en cada ruta.
doctoresRouter.use("/*", tenantContext, requireActiveTenant, (c, next) => {
  const gate = c.req.method === "GET" ? puedeVerProfesionales : puedeGestionarProfesionales;
  return gate(c, next);
});

/** Contexto del llamante — tenant_id y userId siempre del JWT. */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ── GET /doctores ────────────────────────────────────────────────────────────
doctoresRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const parsed = ListarDoctoresQuerySchema.safeParse({
    search:       c.req.query("search"),
    available:    c.req.query("available"),
    professional: c.req.query("professional"),
    page:         c.req.query("page"),
    limit:        c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, search: undefined, available: undefined, professional: undefined };

  const { items, total } = await DoctorService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

// ── GET /doctores/:id ──────────────────────────────────────────────────────────
doctoresRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const doctor = await DoctorService.obtenerPorId(c.req.param("id"), tenantId);

  if (!doctor) {
    throw new DomainError(ErrorCode.FORBIDDEN, 403, "Doctor no encontrado en este tenant");
  }
  return c.json(ok(doctor), 200);
});

// ── PATCH /doctores/:id ────────────────────────────────────────────────────────
// Editar perfil profesional; available=false es la baja lógica.
doctoresRouter.patch("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = ActualizarDoctorSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de doctor inválidos",
      parsed.error.issues,
    );
  }

  const doctor = await DoctorService.actualizar(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(doctor), 200);
});
