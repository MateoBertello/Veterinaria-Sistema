import { Hono, type Context } from "hono";
import { ClientesService, type CallerContext } from "./clientes.service.ts";
import {
  CrearClienteSchema,
  EditarClienteSchema,
  ListarClientesQuerySchema,
} from "./clientes.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

export const clientesRouter = new Hono();

// Autenticación → tenant activo (RN-SA3) → permiso manage_clients (RN-S2).
// Clientes es módulo Core (no vendible): no pasa por requireModule.
clientesRouter.use("/*", tenantContext, requireActiveTenant, requirePermission("manage_clients"));

/** Construye el contexto del llamante. tenant_id y userId salen SIEMPRE del JWT. */
function callerContext(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ── GET /clientes ───────────────────────────────────────────────────────────
clientesRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const parsed = ListarClientesQuerySchema.safeParse({
    search: c.req.query("search"),
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
  });
  const { page, limit, search } = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, search: undefined };

  const { items, total } = await ClientesService.listar(tenantId, { page, limit, search });
  return c.json(ok(items, { page, limit, total }), 200);
});

// ── GET /clientes/:id ─────────────────────────────────────────────────────────
clientesRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const cliente = await ClientesService.obtenerPorId(c.req.param("id"), tenantId);

  if (!cliente) {
    throw new DomainError(ErrorCode.FORBIDDEN, 403, "Cliente no encontrado en este tenant");
  }
  return c.json(ok(cliente), 200);
});

// ── POST /clientes ────────────────────────────────────────────────────────────
clientesRouter.post("/", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearClienteSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de cliente inválidos", parsed.error.issues ?? []);
  }

  const cliente = await ClientesService.crear(parsed.data, callerContext(c));
  return c.json(ok(cliente), 201);
});

// ── PUT /clientes/:id ─────────────────────────────────────────────────────────
clientesRouter.put("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = EditarClienteSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de cliente inválidos", parsed.error.issues ?? []);
  }

  const cliente = await ClientesService.editar(c.req.param("id"), parsed.data, callerContext(c));
  return c.json(ok(cliente), 200);
});

// ── DELETE /clientes/:id ──────────────────────────────────────────────────────
clientesRouter.delete("/:id", async (c) => {
  const resultado = await ClientesService.eliminar(c.req.param("id"), callerContext(c));
  return c.json(ok(resultado), 200);
});
