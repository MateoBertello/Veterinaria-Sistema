import { Hono } from "hono";
import { UsuariosService } from "./usuarios.service.ts";
import {
  CrearUsuarioSchema,
  EditarUsuarioSchema,
  ListarUsuariosQuerySchema,
} from "./usuarios.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

export const usuariosRouter = new Hono();

// Todas las rutas requieren autenticación + permiso manage_users (RN-S2)
usuariosRouter.use("/*", tenantContext, requirePermission("manage_users"));

// ── GET /usuarios ─────────────────────────────────────────────────────────────
usuariosRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const queryParsed = ListarUsuariosQuerySchema.safeParse({
    page:  c.req.query("page"),
    limit: c.req.query("limit"),
  });

  const { page, limit } = queryParsed.success
    ? queryParsed.data
    : { page: 1, limit: 20 };

  const { items, total } = await UsuariosService.listar(tenantId, page, limit);
  return c.json(ok(items, { page, limit, total }), 200);
});

// ── POST /usuarios ────────────────────────────────────────────────────────────
usuariosRouter.post("/", async (c) => {
  const { tenantId, userId } = getTenantContext(c);
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearUsuarioSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de usuario inválidos",
      parsed.error.issues ?? [],
    );
  }

  const usuario = await UsuariosService.crear(parsed.data, {
    tenantId,
    callerUserId: userId,
    callerName:   "unknown",
    callerRole:   "unknown",
    authHeader:   c.req.header("Authorization") ?? "",
  });

  return c.json(ok(usuario), 201);
});

// ── PUT /usuarios/:id ─────────────────────────────────────────────────────────
usuariosRouter.put("/:id", async (c) => {
  const { tenantId, userId } = getTenantContext(c);
  const id     = c.req.param("id");
  const body   = await c.req.json().catch(() => ({}));
  const parsed = EditarUsuarioSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos inválidos",
      parsed.error.issues ?? [],
    );
  }

  const usuario = await UsuariosService.editar(id, parsed.data, {
    tenantId,
    callerUserId: userId,
    callerName:   "unknown",
    callerRole:   "unknown",
    authHeader:   c.req.header("Authorization") ?? "",
  });

  return c.json(ok(usuario), 200);
});

// ── GET /roles ────────────────────────────────────────────────────────────────
usuariosRouter.get("/roles", async (c) => {
  const { tenantId } = getTenantContext(c);
  const roles = await UsuariosService.obtenerRoles(tenantId);
  return c.json(ok(roles), 200);
});
