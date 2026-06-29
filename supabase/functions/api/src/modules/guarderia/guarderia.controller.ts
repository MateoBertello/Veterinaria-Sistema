import { Hono, type Context } from "hono";
import { z } from "zod";
import { EstadiaService, type CallerContext } from "./guarderia.service.ts";
import {
  CrearEstadiaSchema,
  CupoQuerySchema,
  ModificarEstadiaSchema,
  CancelarEstadiaSchema,
} from "./guarderia.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

// Módulo vendible 'guarderia' (regla 4) + permiso manage_daycare (RN-GU6).
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("guarderia"),
  requirePermission("manage_daycare"),
];

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
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
// El controller lee la estadía vigente y pre-rellena los campos no enviados
// en el body para que el service siempre envíe valores completos al RPC.
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

  const { tenantId } = getTenantContext(c);
  const { getServiceDb } = await import("../../shared/db.ts");
  const db = getServiceDb();

  // Leer estadía vigente para pre-rellenar campos no enviados.
  const { data: vigente, error: fetchErr } = await db
    .from("estadias")
    .select("check_in_date, check_out_date, reason, notes")
    .eq("id", idParsed.data)
    .eq("tenant_id", tenantId)
    .single();

  if (fetchErr || !vigente) {
    throw new DomainError(ErrorCode.ESTADIA_NOT_FOUND, 404, "Estadía no encontrada");
  }

  const v = vigente as Record<string, unknown>;
  const dto = {
    checkInDate:  (body.data.checkInDate  ?? v["check_in_date"])  as string,
    checkOutDate: (body.data.checkOutDate ?? v["check_out_date"]) as string,
    reason:       (body.data.reason       ?? v["reason"])         as string,
    notes:        body.data.notes !== undefined ? body.data.notes : (v["notes"] as string | null) ?? null,
  };

  const estadia = await EstadiaService.actualizar(idParsed.data, dto, callerCtx(c));
  return c.json(ok(estadia), 200);
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
