import { Hono, type Context } from "hono";
import { MascotasService, type CallerContext } from "./mascotas.service.ts";
import {
  CrearMascotaSchema,
  EditarMascotaSchema,
  ListarMascotasQuerySchema,
} from "./mascotas.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

export const mascotasRouter = new Hono();

// Autenticación → tenant activo (RN-SA3) → permiso manage_pets (RN-S2).
// Mascotas es módulo Core (no vendible): no pasa por requireModule.
mascotasRouter.use("/*", tenantContext, requireActiveTenant, requirePermission("manage_pets"));

/** Construye el contexto del llamante. tenant_id y userId salen SIEMPRE del JWT. */
function callerContext(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
}

// ── GET /mascotas ─────────────────────────────────────────────────────────────
mascotasRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const parsed = ListarMascotasQuerySchema.safeParse({
    search:   c.req.query("search"),
    clientId: c.req.query("clientId"),
    page:     c.req.query("page"),
    limit:    c.req.query("limit"),
  });
  const { page, limit, search, clientId } = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, search: undefined, clientId: undefined };

  const { items, total } = await MascotasService.listar(tenantId, { page, limit, search, clientId });
  return c.json(ok(items, { page, limit, total }), 200);
});

// ── GET /mascotas/:id ─────────────────────────────────────────────────────────
mascotasRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const mascota = await MascotasService.obtenerPorId(c.req.param("id"), tenantId);

  if (!mascota) {
    throw new DomainError(ErrorCode.MASCOTA_NOT_FOUND, 404, "Mascota no encontrada en este tenant");
  }
  return c.json(ok(mascota), 200);
});

// ── POST /mascotas ────────────────────────────────────────────────────────────
mascotasRouter.post("/", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearMascotaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de mascota inválidos", parsed.error.issues ?? []);
  }

  const mascota = await MascotasService.crear(parsed.data, callerContext(c));
  return c.json(ok(mascota), 201);
});

// ── PUT /mascotas/:id ─────────────────────────────────────────────────────────
mascotasRouter.put("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = EditarMascotaSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Datos de mascota inválidos", parsed.error.issues ?? []);
  }

  const mascota = await MascotasService.editar(c.req.param("id"), parsed.data, callerContext(c));
  return c.json(ok(mascota), 200);
});

// ── DELETE /mascotas/:id ──────────────────────────────────────────────────────
mascotasRouter.delete("/:id", async (c) => {
  const resultado = await MascotasService.eliminar(c.req.param("id"), callerContext(c));
  return c.json(ok(resultado), 200);
});
