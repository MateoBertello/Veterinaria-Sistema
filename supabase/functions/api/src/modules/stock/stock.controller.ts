import { Hono } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { ok, fail } from "../../shared/envelope.ts";
import { ErrorCode } from "../../shared/errors.ts";
import { StockService } from "./stock.service.ts";
import {
  listarLotesQuerySchema,
  candidatosFefoQuerySchema,
  kardexQuerySchema,
  listarMovimientosQuerySchema,
  listarExistenciasQuerySchema,
} from "./stock.schemas.ts";

const stockMiddlewares = [
  tenantContext,
  requireActiveTenant,
  requireModule("stock"),
  requirePermission("view_stock"),
];

// ---------------------------------------------------------------------
// Lotes Router
// ---------------------------------------------------------------------
export const lotesRouter = new Hono();
stockMiddlewares.forEach((mw) => lotesRouter.use("*", mw));

lotesRouter.get("/candidatos", async (c) => {
  const query = candidatosFefoQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const data = await StockService.listarCandidatosFefo(query.data.productoId, query.data.cantidad, tenantId);
  return c.json(ok(data));
});

lotesRouter.get("/:id/kardex", async (c) => {
  const id = c.req.param("id");
  const query = kardexQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await StockService.kardexPorLote(id, tenantId, query.data);
  return c.json(ok(result.data, result.meta));
});

lotesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const data = await StockService.obtenerLotePorId(id, tenantId);
  return c.json(ok(data));
});

lotesRouter.get("/", async (c) => {
  const query = listarLotesQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await StockService.listarLotes(tenantId, query.data);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});

// ---------------------------------------------------------------------
// Movimientos Stock Router
// ---------------------------------------------------------------------
export const movimientosRouter = new Hono();
stockMiddlewares.forEach((mw) => movimientosRouter.use("*", mw));

movimientosRouter.get("/", async (c) => {
  const query = listarMovimientosQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await StockService.listarMovimientos(tenantId, query.data);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});

// ---------------------------------------------------------------------
// Existencias Router
// ---------------------------------------------------------------------
export const existenciasRouter = new Hono();
stockMiddlewares.forEach((mw) => existenciasRouter.use("*", mw));

existenciasRouter.get("/valorizacion", async (c) => {
  const { tenantId } = getTenantContext(c);
  const data = await StockService.valorizacionInventario(tenantId);
  return c.json(ok(data));
});

existenciasRouter.get("/", async (c) => {
  const query = listarExistenciasQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await StockService.existenciaPorProducto(tenantId, query.data);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});
