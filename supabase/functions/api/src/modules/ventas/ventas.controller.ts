import { Hono, type Context as HonoContext } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { ok, fail } from "../../shared/envelope.ts";
import { ErrorCode } from "../../shared/errors.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";
import { VentaService, type Context } from "./ventas.service.ts";
import {
  RegistrarVentaSchema,
  AnularVentaSchema,
  ListarVentasQuerySchema,
  ReporteMargenQuerySchema,
  ReporteItemsVendidosQuerySchema,
} from "./ventas.schemas.ts";

function callerCtx(c: HonoContext): Context {
  const { tenantId, userId } = getTenantContext(c);
  const permisos = c.get("permisos");
  return {
    tenantId,
    callerUserId: userId,
    callerName:    CALLER_UNRESOLVED,
    callerRole:    CALLER_UNRESOLVED,
    permisos,
  };
}

export const ventasRouter = new Hono();

ventasRouter.use("*", tenantContext);
ventasRouter.use("*", requireActiveTenant);
ventasRouter.use("*", requireModule("ventas"));
ventasRouter.use("*", requirePermission("manage_sales"));

// ─── Reportes (requieren view_sales) ──────────────────────────────────────────

ventasRouter.get("/reportes/margen", requirePermission("view_sales"), async (c) => {
  const query = ReporteMargenQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros de reporte inválidos", 400, query.error.issues), 400);
  }
  const ctx = callerCtx(c);
  const data = await VentaService.margenPorProducto(query.data, ctx);
  return c.json(ok(data));
});

ventasRouter.get("/reportes/items-vendidos", requirePermission("view_sales"), async (c) => {
  const query = ReporteItemsVendidosQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros de reporte inválidos", 400, query.error.issues), 400);
  }
  const ctx = callerCtx(c);
  const data = await VentaService.itemsVendidos(query.data, ctx);
  return c.json(ok(data));
});

// ─── Ventas CRUD / Operaciones ────────────────────────────────────────────────

ventasRouter.get("/", async (c) => {
  const query = ListarVentasQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros de búsqueda inválidos", 400, query.error.issues), 400);
  }
  const ctx = callerCtx(c);
  const result = await VentaService.buscarPaginado(query.data, ctx);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});

ventasRouter.get("/:id", async (c) => {
  const id = c.req.param("id") as string;
  const ctx = callerCtx(c);
  const data = await VentaService.obtenerPorId(id, ctx);
  return c.json(ok(data));
});

ventasRouter.post("/", async (c) => {
  let bodyJson: unknown;
  try {
    bodyJson = await c.req.json();
  } catch {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Body JSON inválido", 400), 400);
  }

  const parsed = RegistrarVentaSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de venta inválidos", 400, parsed.error.issues), 400);
  }

  const ctx = callerCtx(c);
  const data = await VentaService.registrar(parsed.data, ctx);
  return c.json(ok(data), 201);
});

ventasRouter.post("/:id/anular", requirePermission("void_sales"), async (c) => {
  const id = c.req.param("id") as string;
  let bodyJson: unknown;
  try {
    bodyJson = await c.req.json();
  } catch {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Body JSON inválido", 400), 400);
  }

  const parsed = AnularVentaSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de anulación inválidos", 400, parsed.error.issues), 400);
  }

  const ctx = callerCtx(c);
  const data = await VentaService.anular(id, parsed.data, ctx);
  return c.json(ok(data));
});
