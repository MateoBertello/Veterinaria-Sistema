import { Hono, type Context as HonoContext } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { RegistrarConsumoSchema } from "./consumo.schemas.ts";
import { ConsumoService, type Context } from "./consumo.service.ts";
import { ok } from "../../shared/envelope.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";

function callerCtx(c: HonoContext): Context {
  const ctx = (c as any).get?.("ctx");
  if (ctx?.tenantId) {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      logger: ctx.logger || console,
      db: ctx.db,
    };
  }
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, userId, logger: console };
}

export const consumoRouter = new Hono();

consumoRouter.use("*", tenantContext);
consumoRouter.use("*", requireActiveTenant);
consumoRouter.use("*", requireModule("stock"));

const viewStock = requirePermission("view_stock");
const consumeStock = requirePermission("consume_stock");

consumoRouter.post("/", consumeStock, async (c) => {
  const ctx = callerCtx(c);
  const jsonBody = await c.req.json().catch((e) => {
    console.error("JSON parse error:", e);
    return {};
  });
  const validationResult = RegistrarConsumoSchema.safeParse(jsonBody);
  if (!validationResult.success) {
    console.error("ZOD ERROR:", validationResult.error.issues);
    throw new DomainError(ErrorCode.VALIDATION_ERROR as any, 422, "Error de validación", validationResult.error.issues);
  }
  const body = validationResult.data;

  // §10.3: el endpoint clínico no descontará stock. El frontend llama acá.
  // RN-SC1: el tenantId del body se ignora (ya lo hace el schema al ser strict, y acá usamos ctx)

  const result = await ConsumoService.registrar(
    ctx,
    body.historialId,
    body.items,
    body.planVacunacionId,
    body.recetaId,
    body.profesionalPrescriptorId,
  );

  return c.json(ok(result.data), 201);
});

consumoRouter.get("/evento/:historialId", viewStock, async (c) => {
  const ctx = callerCtx(c);
  const historialId = c.req.param("historialId");
  if (!historialId) throw new DomainError(ErrorCode.VALIDATION_ERROR as any, 400, "historialId requerido");

  const result = await ConsumoService.porEvento(ctx, historialId);
  return c.json(ok(result.data));
});

consumoRouter.get("/disponibilidad", viewStock, async (c) => {
  const ctx = callerCtx(c);
  const productoId = c.req.query("productoId");
  if (!productoId) throw new DomainError(ErrorCode.VALIDATION_ERROR as any, 422, "productoId requerido");

  const result = await ConsumoService.disponibilidad(ctx, productoId);
  return c.json(ok(result.data));
});

