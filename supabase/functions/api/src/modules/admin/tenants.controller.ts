import { Hono, type Context } from "hono";
import { TenantService } from "./tenants.service.ts";
import {
  CrearTenantSchema,
  EditarTenantSchema,
  CambiarEstadoSchema,
  ListarTenantsQuerySchema,
} from "./tenants.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.ts";

export const tenantsRouter = new Hono();

// Todas las rutas /admin/tenants/* requieren rol de plataforma super_admin.
// El aislamiento se valida ANTES de llegar al service (RN-SA4 / aislamiento).
tenantsRouter.use("/*", requireSuperAdmin);

function ctx(c: Context) {
  return { superAdminId: c.get("superAdminId") };
}

// ── GET /admin/tenants ────────────────────────────────────────────────────────
tenantsRouter.get("/", async (c) => {
  const parsed = ListarTenantsQuerySchema.safeParse({
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
    q:      c.req.query("q"),
    plan:   c.req.query("plan"),
    estado: c.req.query("estado"),
  });

  const filtros = parsed.success
    ? parsed.data
    : ListarTenantsQuerySchema.parse({});

  const { items, total } = await TenantService.buscarPaginado(filtros);
  return c.json(ok(items, { page: filtros.page, limit: filtros.limit, total }), 200);
});

// ── GET /admin/tenants/:id ──────────────────────────────────────────────────────
tenantsRouter.get("/:id", async (c) => {
  const tenant = await TenantService.obtenerPorId(c.req.param("id"));
  return c.json(ok(tenant), 200);
});

// ── POST /admin/tenants ─────────────────────────────────────────────────────────
tenantsRouter.post("/", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearTenantSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de tenant inválidos",
      parsed.error.issues ?? [],
    );
  }

  const tenant = await TenantService.crear(parsed.data, ctx(c));
  return c.json(ok(tenant), 201);
});

// ── PUT /admin/tenants/:id ──────────────────────────────────────────────────────
tenantsRouter.put("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = EditarTenantSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de tenant inválidos",
      parsed.error.issues ?? [],
    );
  }

  const tenant = await TenantService.actualizar(c.req.param("id"), parsed.data, ctx(c));
  return c.json(ok(tenant), 200);
});

// ── PATCH /admin/tenants/:id/estado ─────────────────────────────────────────────
tenantsRouter.patch("/:id/estado", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Estado inválido",
      parsed.error.issues ?? [],
    );
  }

  const tenant = await TenantService.cambiarEstado(c.req.param("id"), parsed.data.activo, ctx(c));
  return c.json(ok(tenant), 200);
});

// ── POST /admin/tenants/:id/invitar-admin (reintento idempotente, RN-SA2) ───────
tenantsRouter.post("/:id/invitar-admin", async (c) => {
  const tenant = await TenantService.invitarAdmin(c.req.param("id"));
  return c.json(ok(tenant), 200);
});
