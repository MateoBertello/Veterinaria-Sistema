import { Hono, type Context } from "hono";
import { TenantService } from "./tenants.service.ts";
import {
  CrearTenantSchema,
  EditarTenantSchema,
  CambiarEstadoSchema,
  CrearAdminTenantSchema,
  ListarTenantsQuerySchema,
} from "./tenants.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.ts";
import { ModuloService } from "../modulos/modulos.service.ts";
import { ModuloVendibleEnum, ToggleModuloSchema } from "../modulos/modulos.schemas.ts";

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

// ── POST /admin/tenants/:id/admin (usuario inicial de la clínica) ───────────────
// El tenant destino sale del `:id` de la ruta y de ningún otro lado: un
// `tenantId` en el body no lo redirige (el schema lo descarta).
tenantsRouter.post("/:id/admin", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearAdminTenantSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de administrador inválidos",
      parsed.error.issues ?? [],
    );
  }

  // El asiento de auditoría se etiqueta con el email del token YA VERIFICADO
  // (requireSuperAdmin), nunca con algo que mande el cliente.
  const { usuario, created } = await TenantService.crearAdmin(
    c.req.param("id"),
    parsed.data,
    {
      superAdminId:   c.get("superAdminId"),
      superAdminName: c.get("superAdminEmail") ?? undefined,
    },
  );

  // 201 si se creó, 200 si ya existía: el alta es idempotente y quien la corre
  // dos veces tiene que poder distinguir un caso del otro.
  return c.json(ok(usuario), created ? 201 : 200);
});

// ── GET /admin/tenants/:id/modulos (estado de módulos del tenant) ────────────────
tenantsRouter.get("/:id/modulos", async (c) => {
  const modulos = await ModuloService.listarPorTenant(c.req.param("id"));
  return c.json(ok(modulos), 200);
});

// ── PUT /admin/tenants/:id/modulos/:modulo (toggle de módulo, RN-SM1..SM4) ───────
tenantsRouter.put("/:id/modulos/:modulo", async (c) => {
  // El path param debe ser un módulo vendible conocido (RN: MODULE_UNKNOWN).
  const moduloParsed = ModuloVendibleEnum.safeParse(c.req.param("modulo"));
  if (!moduloParsed.success) {
    throw new DomainError(
      ErrorCode.MODULE_UNKNOWN,
      422,
      "Módulo desconocido",
    );
  }

  const body   = await c.req.json().catch(() => ({}));
  const parsed = ToggleModuloSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de módulo inválidos",
      parsed.error.issues ?? [],
    );
  }

  const modulo = await ModuloService.setModulo(
    c.req.param("id"),
    moduloParsed.data,
    parsed.data.habilitado,
    ctx(c),
  );
  return c.json(ok(modulo), 200);
});
