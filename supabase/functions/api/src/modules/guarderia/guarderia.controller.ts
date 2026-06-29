import { Hono, type Context } from "hono";
import { EstadiaService, type CallerContext } from "./guarderia.service.ts";
import { CrearEstadiaSchema, CupoQuerySchema } from "./guarderia.schemas.ts";
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
