import { Hono, type Context as HonoContext } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { ok, fail } from "../../shared/envelope.ts";
import { ErrorCode } from "../../shared/errors.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";
import { ComprasService, type ServiceContext } from "./compras.service.ts";
import {
  crearCompraSchema,
  actualizarCompraSchema,
  agregarItemCompraSchema,
  actualizarItemCompraSchema,
  anularCompraSchema,
  buscarComprasQuerySchema,
} from "./compras.schemas.ts";

function callerCtx(c: HonoContext): ServiceContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

export const comprasRouter = new Hono();

comprasRouter.use("*", tenantContext);
comprasRouter.use("*", requireActiveTenant);
comprasRouter.use("*", requireModule("stock"));
comprasRouter.use("*", requirePermission("manage_suppliers"));

comprasRouter.get("/", async (c) => {
  const query = buscarComprasQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await ComprasService.buscarPaginado(query.data, tenantId);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});

comprasRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = crearCompraSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de compra inválidos", 400, parsed.error.issues), 400);
  }
  const data = await ComprasService.crear(parsed.data, callerCtx(c));
  return c.json(ok(data), 201);
});

comprasRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const data = await ComprasService.obtenerPorId(id, tenantId);
  return c.json(ok(data));
});

comprasRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = actualizarCompraSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de compra inválidos", 400, parsed.error.issues), 400);
  }
  const data = await ComprasService.actualizar(id, parsed.data, callerCtx(c));
  return c.json(ok(data));
});

comprasRouter.post("/:id/items", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = agregarItemCompraSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de ítem inválidos", 400, parsed.error.issues), 400);
  }
  const data = await ComprasService.agregarItem(id, parsed.data, callerCtx(c));
  return c.json(ok(data), 201);
});

comprasRouter.put("/:id/items/:itemId", async (c) => {
  const id = c.req.param("id");
  const itemId = c.req.param("itemId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = actualizarItemCompraSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de ítem inválidos", 400, parsed.error.issues), 400);
  }
  const data = await ComprasService.actualizarItem(id, itemId, parsed.data, callerCtx(c));
  return c.json(ok(data));
});

comprasRouter.delete("/:id/items/:itemId", async (c) => {
  const id = c.req.param("id");
  const itemId = c.req.param("itemId");
  const data = await ComprasService.quitarItem(id, itemId, callerCtx(c));
  return c.json(ok(data));
});

comprasRouter.post("/:id/confirmar", async (c) => {
  const id = c.req.param("id");
  const data = await ComprasService.confirmar(id, callerCtx(c));
  return c.json(ok(data));
});

comprasRouter.post("/:id/anular", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = anularCompraSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Motivo inválido", 400, parsed.error.issues), 400);
  }
  const data = await ComprasService.anular(id, parsed.data.motivo, callerCtx(c));
  return c.json(ok(data));
});
