import { Hono, type Context } from "hono";
import { HorarioService, type CallerContext } from "./horarios.service.ts";
import { CrearFranjaSchema, AlternarActivoSchema } from "./horarios.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

/** Contexto del llamante — tenant_id y userId siempre del JWT. */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ────────────────────────────────────────────────────────────────────────────────
// Router anidado bajo /doctores — franjas de un profesional + resumen global.
// RN-HOR5: gestión restringida a Administrador (permiso manage_schedules).
// ────────────────────────────────────────────────────────────────────────────────
export const horariosDoctorRouter = new Hono();

horariosDoctorRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_schedules"),
);

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
