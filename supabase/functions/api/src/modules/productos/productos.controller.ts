import { Hono, type Context as HonoContext } from "hono";
import {
  ProductoService,
  FamiliaService,
  ConversionService,
  type Context,
} from "./productos.service.ts";
import {
  CrearProductoSchema,
  ActualizarProductoSchema,
  CambiarEstadoProductoSchema,
  ListarProductosQuerySchema,
  CrearFamiliaSchema,
  ActualizarFamiliaSchema,
  ListarFamiliasQuerySchema,
  CrearConversionSchema,
  ActualizarConversionSchema,
  ListarConversionesQuerySchema,
} from "./productos.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

// Lectura: view_stock. Veterinario, recepcionista y admin lo tienen.
const sharedMiddleware = [
  tenantContext,
  requireActiveTenant,
  requireModule("stock"),
  requirePermission("view_stock"),
];

// Escritura: manage_products, que solo tiene el admin (§8.2).
const manageProducts = requirePermission("manage_products");

function callerCtx(c: HonoContext): Context {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ─── Router: Productos ────────────────────────────────────────────────────────

export const productosRouter = new Hono();
productosRouter.use("/*", ...sharedMiddleware);

productosRouter.get("/", async (c) => {
  const parsed = ListarProductosQuerySchema.safeParse({
    search:    c.req.query("search"),
    familiaId: c.req.query("familiaId"),
    activo:    c.req.query("activo"),
    vendible:  c.req.query("vendible"),
    page:      c.req.query("page"),
    limit:     c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, activo: undefined, vendible: undefined, search: undefined, familiaId: undefined };

  const { items, total, page, limit } = await ProductoService.buscarPaginado(opts, callerCtx(c));
  return c.json(ok(items, { page, limit, total }), 200);
});

productosRouter.get("/:id", async (c) => {
  const producto = await ProductoService.obtenerPorId(c.req.param("id")!, callerCtx(c));
  return c.json(ok(producto), 200);
});

productosRouter.post("/", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CrearProductoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de producto inválidos",
      parsed.error.issues,
    );
  }

  const producto = await ProductoService.crear(parsed.data, callerCtx(c));
  return c.json(ok(producto), 201);
});

productosRouter.put("/:id", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ActualizarProductoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de producto inválidos",
      parsed.error.issues,
    );
  }

  const producto = await ProductoService.actualizar(c.req.param("id")!, parsed.data, callerCtx(c));
  return c.json(ok(producto), 200);
});

productosRouter.patch("/:id/estado", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoProductoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'activo' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const producto = await ProductoService.cambiarEstado(
    c.req.param("id")!,
    parsed.data.activo,
    callerCtx(c),
  );
  return c.json(ok(producto), 200);
});

// ─── Router: Familias ─────────────────────────────────────────────────────────

export const familiasRouter = new Hono();
familiasRouter.use("/*", ...sharedMiddleware);

familiasRouter.get("/", async (c) => {
  const parsed = ListarFamiliasQuerySchema.safeParse({
    search: c.req.query("search"),
    activo: c.req.query("activo"),
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, activo: undefined, search: undefined };
  const { items, total, page, limit } = await FamiliaService.buscarPaginado(opts, callerCtx(c));
  return c.json(ok(items, { page, limit, total }), 200);
});

familiasRouter.get("/:id", async (c) => {
  const familia = await FamiliaService.obtenerPorId(c.req.param("id")!, callerCtx(c));
  return c.json(ok(familia), 200);
});

familiasRouter.post("/", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CrearFamiliaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de familia inválidos",
      parsed.error.issues,
    );
  }

  const familia = await FamiliaService.crear(parsed.data, callerCtx(c));
  return c.json(ok(familia), 201);
});

familiasRouter.put("/:id", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ActualizarFamiliaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de familia inválidos",
      parsed.error.issues,
    );
  }

  const familia = await FamiliaService.actualizar(c.req.param("id")!, parsed.data, callerCtx(c));
  return c.json(ok(familia), 200);
});

familiasRouter.patch("/:id/estado", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoProductoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'activo' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const familia = await FamiliaService.cambiarEstado(
    c.req.param("id")!,
    parsed.data.activo,
    callerCtx(c),
  );
  return c.json(ok(familia), 200);
});

// ─── Router: Conversiones ─────────────────────────────────────────────────────

export const conversionesRouter = new Hono();
conversionesRouter.use("/*", ...sharedMiddleware);

conversionesRouter.get("/", async (c) => {
  const parsed = ListarConversionesQuerySchema.safeParse({
    productoOrigenId: c.req.query("productoOrigenId"),
    activo:           c.req.query("activo"),
    page:             c.req.query("page"),
    limit:            c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, activo: undefined, productoOrigenId: undefined };
  const { items, total, page, limit } = await ConversionService.buscarPaginado(opts, callerCtx(c));
  return c.json(ok(items, { page, limit, total }), 200);
});

conversionesRouter.get("/:id", async (c) => {
  const conv = await ConversionService.obtenerPorId(c.req.param("id")!, callerCtx(c));
  return c.json(ok(conv), 200);
});

conversionesRouter.post("/", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CrearConversionSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de conversión inválidos",
      parsed.error.issues,
    );
  }

  const conv = await ConversionService.crear(parsed.data, callerCtx(c));
  return c.json(ok(conv), 201);
});

conversionesRouter.put("/:id", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ActualizarConversionSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de conversión inválidos",
      parsed.error.issues,
    );
  }

  const conv = await ConversionService.actualizar(c.req.param("id")!, parsed.data, callerCtx(c));
  return c.json(ok(conv), 200);
});

conversionesRouter.patch("/:id/estado", manageProducts, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoProductoSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'activo' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const conv = await ConversionService.cambiarEstado(
    c.req.param("id")!,
    parsed.data.activo,
    callerCtx(c),
  );
  return c.json(ok(conv), 200);
});
