import { Hono, type Context } from "hono";
import { TurnoService, type CallerContext } from "./turnos.service.ts";
import {
  CrearTurnoSchema,
  SlotsQuerySchema,
  ModificarTurnoSchema,
  CancelarTurnoSchema,
  CambiarEstadoSchema,
  ListarTurnosQuerySchema,
} from "./turnos.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

// Módulo vendible 'turnos' (RN-G2) + permiso manage_appointments (RN-TU7).
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("turnos"),
  requirePermission("manage_appointments"),
];

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
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

// GET /turnos?date=&status= — lista agenda activa o filtrada
turnosRouter.get("/", async (c) => {
  const parsed = ListarTurnosQuerySchema.safeParse({
    date:   c.req.query("date"),
    status: c.req.query("status"),
  });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros inválidos", parsed.error.issues);
  }
  const turnos = await TurnoService.listarTurnos(parsed.data, callerCtx(c));
  return c.json(ok(turnos), 200);
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

// GET /turnos/:id — detalle con accionesDisponibles (RN-MC1)
turnosRouter.get("/:id", async (c) => {
  const turno = await TurnoService.obtenerTurno(c.req.param("id"), callerCtx(c));
  return c.json(ok(turno), 200);
});

// PUT /turnos/:id — modificar turno (RN-MC1, RN-MC2, RN-MC7)
turnosRouter.put("/:id", async (c) => {
  const parsed = ModificarTurnoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos inválidos para modificar", parsed.error.issues);
  }
  const turno = await TurnoService.modificarTurno(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(turno), 200);
});

// PATCH /turnos/:id/cancelar — cancelar con motivo (RN-MC3, RN-MC7)
turnosRouter.patch("/:id/cancelar", async (c) => {
  const parsed = CancelarTurnoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Motivo de cancelación inválido", parsed.error.issues);
  }
  const turno = await TurnoService.cancelarTurno(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(turno), 200);
});

// DELETE /turnos/:id — eliminar (RN-MC6, RN-MC7)
turnosRouter.delete("/:id", async (c) => {
  await TurnoService.eliminarTurno(c.req.param("id"), callerCtx(c));
  return c.json(ok(null), 200);
});

// PATCH /turnos/:id/estado — gestionar estado (RN-ES1..ES5)
turnosRouter.patch("/:id/estado", async (c) => {
  const parsed = CambiarEstadoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Estado inválido", parsed.error.issues);
  }
  const turno = await TurnoService.cambiarEstado(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(turno), 200);
});
