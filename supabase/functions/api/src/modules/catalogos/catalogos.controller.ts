import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  EspeciesService,
  RazasService,
  TiposVacunaService,
  type CallerContext,
} from "./catalogos.service.ts";
import {
  CrearEspecieSchema,
  ActualizarEspecieSchema,
  CrearRazaSchema,
  ActualizarRazaSchema,
  CrearTipoVacunaSchema,
  ActualizarTipoVacunaSchema,
  AsociarEspeciesSchema,
  CambiarEstadoSchema,
  ListarCatalogoQuerySchema,
  ListarRazasQuerySchema,
} from "./catalogos.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

/**
 * Controllers del módulo Catálogos. Solo validan (Zod), resuelven auth/permiso,
 * delegan en el Service y serializan: ninguna regla RN-CAT vive acá.
 *
 * Cada router se monta en su propio prefijo (`/especies`, `/razas`,
 * `/tipos-vacuna`) y por lo tanto puede gatear con `use("/*")` sin pisarle las
 * rutas a nadie — a diferencia de los de horarios, que comparten el mount con
 * `/doctores` y tuvieron que adosar el gate ruta por ruta. Lo que impide que un
 * `use()` se desfase de las rutas reales es el guard de
 * `tests/unit/catalogos.controller.test.ts`, que recorre las rutas registradas
 * y exige que TODAS rechacen al anónimo.
 */

/** Contexto del llamante — tenantId y userId siempre del JWT (RN-CAT1). */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return {
    tenantId,
    callerUserId: userId,
    callerName:   CALLER_UNRESOLVED,
    callerRole:   CALLER_UNRESOLVED,
  };
}

/** El `:id` de la URL se valida como UUID → 422, nunca llega crudo al Service. */
function idParam(c: Context, que: string): string {
  const parsed = z.string().uuid().safeParse(c.req.param("id"));
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, `ID de ${que} inválido`);
  }
  return parsed.data;
}

function parseBody<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } },
  body: unknown,
  mensaje: string,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, mensaje, parsed.error?.issues ?? []);
  }
  return parsed.data as T;
}

/** Query de listado: si no parsea, se cae a los defaults en vez de romper la pantalla. */
const QUERY_DEFAULTS = { page: 1, limit: 20, search: undefined, active: undefined } as const;

function leerQuery(c: Context) {
  const parsed = ListarCatalogoQuerySchema.safeParse({
    search: c.req.query("search"),
    active: c.req.query("active"),
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
  });
  return parsed.success ? parsed.data : { ...QUERY_DEFAULTS };
}

// ══════════════════════════════════════════════════════════════════════════════
// /api/v1/especies
// ══════════════════════════════════════════════════════════════════════════════

export const especiesRouter = new Hono();

especiesRouter.use("/*", tenantContext, requireActiveTenant, requirePermission("manage_catalogs"));

especiesRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);
  const opts = leerQuery(c);
  const { items, total } = await EspeciesService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

especiesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CrearEspecieSchema, body, "Datos de especie inválidos");
  return c.json(ok(await EspeciesService.crear(dto, callerCtx(c))), 201);
});

especiesRouter.put("/:id", async (c) => {
  const id   = idParam(c, "especie");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(ActualizarEspecieSchema, body, "Datos de especie inválidos");
  return c.json(ok(await EspeciesService.actualizar(id, dto, callerCtx(c))), 200);
});

// Baja/alta lógica: el único camino para sacar de circulación (RN-CAT4).
especiesRouter.patch("/:id/estado", async (c) => {
  const id   = idParam(c, "especie");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CambiarEstadoSchema, body, "El campo 'active' (boolean) es requerido");
  return c.json(ok(await EspeciesService.cambiarEstado(id, dto.active, callerCtx(c))), 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// /api/v1/razas
// ══════════════════════════════════════════════════════════════════════════════

export const razasRouter = new Hono();

razasRouter.use("/*", tenantContext, requireActiveTenant, requirePermission("manage_catalogs"));

razasRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);
  const parsed = ListarRazasQuerySchema.safeParse({
    search:    c.req.query("search"),
    active:    c.req.query("active"),
    especieId: c.req.query("especieId"),
    page:      c.req.query("page"),
    limit:     c.req.query("limit"),
  });
  const opts = parsed.success ? parsed.data : { ...QUERY_DEFAULTS, especieId: undefined };

  const { items, total } = await RazasService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

razasRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CrearRazaSchema, body, "Datos de raza inválidos");
  return c.json(ok(await RazasService.crear(dto, callerCtx(c))), 201);
});

razasRouter.put("/:id", async (c) => {
  const id   = idParam(c, "raza");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(ActualizarRazaSchema, body, "Datos de raza inválidos");
  return c.json(ok(await RazasService.actualizar(id, dto, callerCtx(c))), 200);
});

razasRouter.patch("/:id/estado", async (c) => {
  const id   = idParam(c, "raza");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CambiarEstadoSchema, body, "El campo 'active' (boolean) es requerido");
  return c.json(ok(await RazasService.cambiarEstado(id, dto.active, callerCtx(c))), 200);
});

// ══════════════════════════════════════════════════════════════════════════════
// /api/v1/tipos-vacuna
// ══════════════════════════════════════════════════════════════════════════════

export const tiposVacunaRouter = new Hono();

tiposVacunaRouter.use("/*", tenantContext, requireActiveTenant, requirePermission("manage_catalogs"));

tiposVacunaRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);
  const opts = leerQuery(c);
  const { items, total } = await TiposVacunaService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

tiposVacunaRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CrearTipoVacunaSchema, body, "Datos de tipo de vacuna inválidos");
  return c.json(ok(await TiposVacunaService.crear(dto, callerCtx(c))), 201);
});

tiposVacunaRouter.put("/:id", async (c) => {
  const id   = idParam(c, "tipo de vacuna");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(ActualizarTipoVacunaSchema, body, "Datos de tipo de vacuna inválidos");
  return c.json(ok(await TiposVacunaService.actualizar(id, dto, callerCtx(c))), 200);
});

/**
 * PUT /tipos-vacuna/:id/especies — reemplaza las especies a las que aplica
 * (RN-CAT10). PUT y no PATCH porque el body trae el conjunto COMPLETO: lo que
 * no está en `especieIds` deja de estar asociado.
 */
tiposVacunaRouter.put("/:id/especies", async (c) => {
  const id   = idParam(c, "tipo de vacuna");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(AsociarEspeciesSchema, body, "Especies aplicables inválidas");
  return c.json(ok(await TiposVacunaService.asociarEspecies(id, dto, callerCtx(c))), 200);
});

tiposVacunaRouter.patch("/:id/estado", async (c) => {
  const id   = idParam(c, "tipo de vacuna");
  const body = await c.req.json().catch(() => ({}));
  const dto  = parseBody(CambiarEstadoSchema, body, "El campo 'active' (boolean) es requerido");
  return c.json(ok(await TiposVacunaService.cambiarEstado(id, dto.active, callerCtx(c))), 200);
});
