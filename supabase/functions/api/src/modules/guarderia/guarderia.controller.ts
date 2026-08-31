import { Hono, type Context } from "hono";
import { z } from "zod";
import { EstadiaService, type CallerContext, type CheckinResponse, type CheckoutResponse } from "./guarderia.service.ts";
import {
  CrearEstadiaSchema,
  CupoQuerySchema,
  ListarEstadiasQuerySchema,
  ModificarEstadiaSchema,
  CancelarEstadiaSchema,
} from "./guarderia.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

// Módulo vendible 'guarderia' (regla 4) + permiso manage_daycare (RN-GU6).
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("guarderia"),
  requirePermission("manage_daycare"),
];

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ─── /estadias ────────────────────────────────────────────────────────────────
// Montado en /api/v1/estadias

export const guarderiaRouter = new Hono();
guarderiaRouter.use("/*", ...sharedMiddleware);

// GET /estadias/cupo?dateFrom=&dateTo= — ocupación vs. cupo por día (RN-GU4).
// Se registra antes de cualquier ruta con :id futura.
guarderiaRouter.get("/cupo", async (c) => {
  const parsed = CupoQuerySchema.safeParse({
    dateFrom: c.req.query("dateFrom"),
    dateTo:   c.req.query("dateTo"),
  });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros de cupo inválidos", parsed.error.issues);
  }
  const { dateFrom, dateTo } = parsed.data;
  const cupo = await EstadiaService.cupo(dateFrom, dateTo, callerCtx(c));
  return c.json(ok(cupo), 200);
});

// GET /estadias — estadías que ocupan un día (`date`) o un rango (`dateFrom`+`dateTo`,
// vista mensual). Alimenta la ocupación y las acciones de check-in/out.
guarderiaRouter.get("/", async (c) => {
  const parsed = ListarEstadiasQuerySchema.safeParse({
    date:     c.req.query("date"),
    dateFrom: c.req.query("dateFrom"),
    dateTo:   c.req.query("dateTo"),
  });
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Parámetros de fecha inválidos", parsed.error.issues);
  }
  const { date, dateFrom, dateTo } = parsed.data;
  const estadias = date != null
    ? await EstadiaService.listar(date, callerCtx(c))
    : await EstadiaService.listarRango(dateFrom!, dateTo!, callerCtx(c));
  return c.json(ok(estadias), 200);
});

// POST /estadias — Registrar Estadía (RN-GU1..GU5, RN-GU7).
guarderiaRouter.post("/", async (c) => {
  const parsed = CrearEstadiaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de la estadía inválidos", parsed.error.issues);
  }
  const estadia = await EstadiaService.crear(parsed.data, callerCtx(c));
  return c.json(ok(estadia), 201);
});

// PUT /estadias/:id — Modificar Estadía (RN-ME1..ME2, ME5-ME6).
// Body parcial: el pre-relleno con los valores vigentes lo resuelve el Service
// (regla 3 — acá solo se valida, se resuelve el permiso, se delega y se serializa).
guarderiaRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de estadía inválido");
  }

  const body = ModificarEstadiaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de modificación inválidos", body.error.issues);
  }

  const estadia = await EstadiaService.actualizar(idParsed.data, body.data, callerCtx(c));
  return c.json(ok(estadia), 200);
});

// PATCH /estadias/:id/checkin — Check-in de Estadía (RN-CK1, CK2, CK4..CK6).
// Sin body: el timestamp de ingreso lo pone el RPC server-side.
guarderiaRouter.patch("/:id/checkin", async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de estadía inválido");
  }

  const result: CheckinResponse = await EstadiaService.checkin(idParsed.data, callerCtx(c));
  return c.json(ok(result), 200);
});

// PATCH /estadias/:id/checkout — Check-out de Estadía (RN-CK1, CK3, CK4..CK6).
// Sin body: el timestamp de egreso lo pone el RPC server-side. El cupo se libera
// implícitamente al pasar a Finalizada (deja de contar en el cupo de la guardería).
guarderiaRouter.patch("/:id/checkout", async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de estadía inválido");
  }

  const result: CheckoutResponse = await EstadiaService.checkout(idParsed.data, callerCtx(c));
  return c.json(ok(result), 200);
});

// PATCH /estadias/:id/cancelar — Cancelar Estadía (RN-ME1, ME3, ME5-ME6).
guarderiaRouter.patch("/:id/cancelar", async (c) => {
  const id = c.req.param("id");
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "ID de estadía inválido");
  }

  const body = CancelarEstadiaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de cancelación inválidos", body.error.issues);
  }

  const result = await EstadiaService.cancelar(idParsed.data, body.data.cancellationReason, callerCtx(c));
  return c.json(ok(result), 200);
});
