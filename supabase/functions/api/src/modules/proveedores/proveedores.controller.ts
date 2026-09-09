import { Hono, type Context as HonoContext } from "hono";
import { ProveedorService, type Context } from "./proveedores.service.ts";
import {
  CrearProveedorSchema,
  ActualizarProveedorSchema,
  CambiarEstadoProveedorSchema,
  ListarProveedoresQuerySchema,
  type ListarProveedoresQuery,
} from "./proveedores.schemas.ts";
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
  requirePermission("manage_suppliers"),
];

function callerCtx(c: HonoContext): Context {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

export const proveedoresRouter = new Hono();
proveedoresRouter.use("/*", ...sharedMiddleware);

proveedoresRouter.get("/", async (c) => {
  const parsed = ListarProveedoresQuerySchema.safeParse({
    search: c.req.query("search"),
    activo: c.req.query("activo"),
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
  });

  const opts: ListarProveedoresQuery = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, activo: undefined, search: undefined };

  const { items, total, page, limit } = await ProveedorService.buscarPaginado(opts, callerCtx(c));
  return c.json(ok(items, { page, limit, total }), 200);
});

proveedoresRouter.get("/:id", async (c) => {
  const proveedor = await ProveedorService.obtenerPorId(c.req.param("id")!, callerCtx(c));
  return c.json(ok(proveedor), 200);
});

proveedoresRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CrearProveedorSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de proveedor inválidos",
      parsed.error.issues,
    );
  }

  const proveedor = await ProveedorService.crear(parsed.data, callerCtx(c));
  return c.json(ok(proveedor), 201);
});

proveedoresRouter.put("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ActualizarProveedorSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de proveedor inválidos",
      parsed.error.issues,
    );
  }

  const proveedor = await ProveedorService.actualizar(c.req.param("id")!, parsed.data, callerCtx(c));
  return c.json(ok(proveedor), 200);
});

proveedoresRouter.patch("/:id/estado", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoProveedorSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'activo' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const proveedor = await ProveedorService.cambiarEstado(
    c.req.param("id")!,
    parsed.data.activo,
    callerCtx(c),
  );
  return c.json(ok(proveedor), 200);
});
