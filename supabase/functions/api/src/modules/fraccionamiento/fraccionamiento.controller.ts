import { Hono, type Context as HonoContext } from "hono";
import { FraccionamientoService, type Context } from "./fraccionamiento.service.ts";
import {
  FraccionarLoteSchema,
  SugerirVencimientoQuerySchema,
  ListarFraccionamientosQuerySchema,
} from "./fraccionamiento.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("stock"),
];

const splitStock = requirePermission("split_stock");
const viewStock = requirePermission("view_stock");

function callerCtx(c: HonoContext): Context {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

export const fraccionamientoRouter = new Hono();
sharedMiddleware.forEach((mw) => fraccionamientoRouter.use("*", mw));

// POST /api/v1/fraccionamiento
fraccionamientoRouter.post("/", splitStock, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = FraccionarLoteSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de fraccionamiento inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await FraccionamientoService.fraccionar(parsed.data, callerCtx(c));
  return c.json(ok(resultado), 201);
});

// GET /api/v1/fraccionamiento/sugerir-vencimiento
fraccionamientoRouter.get("/sugerir-vencimiento", viewStock, async (c) => {
  const query = {
    loteOrigenId:      c.req.query("loteOrigenId"),
    productoDestinoId: c.req.query("productoDestinoId"),
  };
  const parsed = SugerirVencimientoQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros requeridos inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await FraccionamientoService.sugerirVencimiento(parsed.data, callerCtx(c));
  return c.json(ok(resultado), 200);
});

// GET /api/v1/fraccionamiento/historial
fraccionamientoRouter.get("/historial", viewStock, async (c) => {
  const query = {
    page:              c.req.query("page"),
    limit:             c.req.query("limit"),
    productoOrigenId:  c.req.query("productoOrigenId"),
    productoDestinoId: c.req.query("productoDestinoId"),
  };
  const parsed = ListarFraccionamientosQuerySchema.safeParse(query);
  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, productoOrigenId: undefined, productoDestinoId: undefined };

  const { items, total, page, limit } = await FraccionamientoService.listarHistorial(opts, callerCtx(c));
  return c.json(ok(items, { page, limit, total }), 200);
});
