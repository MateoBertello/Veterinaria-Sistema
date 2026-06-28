import { Hono, type Context } from "hono";
import { TurnoService, type CallerContext } from "./turnos.service.ts";
import { CrearTurnoSchema, SlotsQuerySchema } from "./turnos.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

// Módulo vendible 'turnos' (RN-G2) + permiso manage_appointments (RN-TU7).
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("turnos"),
  requirePermission("manage_appointments"),
];

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
}

// ─── /turnos ────────────────────────────────────────────────────────────────
// Montado en /api/v1/turnos

export const turnosRouter = new Hono();
turnosRouter.use("/*", ...sharedMiddleware);

// GET /turnos/slots?doctorId=&date=&servicioId= — slots disponibles (RN-TU2)
turnosRouter.get("/slots", async (c) => {
  const { tenantId } = getTenantContext(c);
  const parsed = SlotsQuerySchema.safeParse({
    doctorId:   c.req.query("doctorId"),
    date:       c.req.query("date"),
    servicioId: c.req.query("servicioId"),
  });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros de slots inválidos", parsed.error.issues);
  }
  const { doctorId, date, servicioId } = parsed.data;
  const slots = await TurnoService.slotsDisponibles(doctorId, date, servicioId, tenantId);
  return c.json(ok(slots), 200);
});

// POST /turnos — Agendar Turno (RN-TU1, RN-TU3..TU6, RN-TU8..TU10)
turnosRouter.post("/", async (c) => {
  const parsed = CrearTurnoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos del turno inválidos", parsed.error.issues);
  }
  const turno = await TurnoService.crearTurno(parsed.data, callerCtx(c));
  return c.json(ok(turno), 201);
});
