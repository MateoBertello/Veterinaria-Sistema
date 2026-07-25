import { Hono, type Context } from "hono";
import { HorarioService, type CallerContext } from "./horarios.service.ts";
import { CrearFranjaSchema, AlternarActivoSchema } from "./horarios.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

/**
 * Contexto del llamante — tenant_id y userId siempre del JWT.
 *
 * `canManageAll` (RN-HOR7) sale de los permisos que ya resolvió
 * `requirePermission("manage_schedules")` y dejó en el contexto: quien además
 * administra la clínica (`manage_users`) gestiona el horario de cualquiera; el
 * veterinario, solo el suyo.
 */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  const permisos = c.get("permisos") ?? new Set<string>();
  return {
    tenantId,
    callerUserId: userId,
    callerName:   CALLER_UNRESOLVED,
    callerRole:   CALLER_UNRESOLVED,
    canManageAll: permisos.has("manage_users"),
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Router anidado bajo /doctores — franjas de un profesional + resumen global.
// RN-HOR5: gestión restringida a Administrador (permiso manage_schedules).
// ────────────────────────────────────────────────────────────────────────────────
export const horariosDoctorRouter = new Hono();

// Ojo con el alcance: este router se monta en /doctores JUNTO con el de gestión
// de profesionales, así que un `use("/*")` acá le aplicaba manage_schedules a
// TODO /doctores —incluido el `GET /doctores` que sirve el otro router— y le
// devolvía 403 a la recepcionista al abrir "Agendar turno". El middleware se
// acota a las rutas que este router realmente atiende.
const gateHorarios = [tenantContext, requireActiveTenant, requirePermission("manage_schedules")] as const;

horariosDoctorRouter.use("/horarios/resumen", ...gateHorarios);
horariosDoctorRouter.use("/:id/horarios", ...gateHorarios);

// ── GET /doctores/horarios/resumen ──────────────────────────────────────────────
// Ruta estática: declarada antes de las rutas con :id para evitar capturas.
horariosDoctorRouter.get("/horarios/resumen", async (c) => {
  const resumen = await HorarioService.resumen(callerCtx(c));
  return c.json(ok(resumen), 200);
});

// ── GET /doctores/:id/horarios ──────────────────────────────────────────────────
horariosDoctorRouter.get("/:id/horarios", async (c) => {
  const franjas = await HorarioService.listarPorDoctor(c.req.param("id"), callerCtx(c));
  return c.json(ok(franjas), 200);
});

// ── POST /doctores/:id/horarios ─────────────────────────────────────────────────
horariosDoctorRouter.post("/:id/horarios", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearFranjaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de franja inválidos",
      parsed.error.issues,
    );
  }

  const franja = await HorarioService.crearFranja(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(franja), 201);
});

// ────────────────────────────────────────────────────────────────────────────────
// Router plano bajo /horarios — activar/desactivar y eliminar franjas.
// ────────────────────────────────────────────────────────────────────────────────
export const horariosRouter = new Hono();

horariosRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_schedules"),
);

// ── PATCH /horarios/:horarioId ──────────────────────────────────────────────────
horariosRouter.patch("/:horarioId", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = AlternarActivoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'active' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const franja = await HorarioService.alternarActivo(
    c.req.param("horarioId"),
    parsed.data.active,
    callerCtx(c),
  );
  return c.json(ok(franja), 200);
});

// ── DELETE /horarios/:horarioId ─────────────────────────────────────────────────
horariosRouter.delete("/:horarioId", async (c) => {
  await HorarioService.eliminar(c.req.param("horarioId"), callerCtx(c));
  return c.json(ok({ deleted: true }), 200);
});
