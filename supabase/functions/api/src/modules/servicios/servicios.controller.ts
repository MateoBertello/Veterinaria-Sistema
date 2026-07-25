import { Hono, type Context } from "hono";
import { ServicioService, type CallerContext } from "./servicios.service.ts";
import {
  CrearServicioSchema,
  ActualizarServicioSchema,
  CambiarEstadoServicioSchema,
  ListarServiciosQuerySchema,
} from "./servicios.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

export const serviciosRouter = new Hono();

// Autenticación → tenant activo (RN-SA3) → permiso manage_services (RN-SV6).
// Servicios es módulo Core transversal: no pasa por requireModule.
serviciosRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_services"),
);

/** Contexto del llamante — tenant_id y userId siempre del JWT. */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// ── GET /servicios ─────────────────────────────────────────────────────────────
serviciosRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const parsed = ListarServiciosQuerySchema.safeParse({
    search: c.req.query("search"),
    tipo:   c.req.query("tipo"),
    activo: c.req.query("activo"),
    page:   c.req.query("page"),
    limit:  c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, search: undefined, tipo: undefined, activo: undefined };

  const { items, total } = await ServicioService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

// ── GET /servicios/:id ─────────────────────────────────────────────────────────
serviciosRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const servicio = await ServicioService.obtenerPorId(c.req.param("id"), tenantId);

  if (!servicio) {
    throw new DomainError(ErrorCode.SERVICE_NOT_FOUND, 404, "Servicio no encontrado en este tenant");
  }
  return c.json(ok(servicio), 200);
});

// ── POST /servicios ────────────────────────────────────────────────────────────
serviciosRouter.post("/", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CrearServicioSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de servicio inválidos",
      parsed.error.issues,
    );
  }

  const servicio = await ServicioService.crear(parsed.data, callerCtx(c));
  return c.json(ok(servicio), 201);
});

// ── PUT /servicios/:id ─────────────────────────────────────────────────────────
serviciosRouter.put("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = ActualizarServicioSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de servicio inválidos",
      parsed.error.issues,
    );
  }

  const servicio = await ServicioService.actualizar(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(servicio), 200);
});

// ── PATCH /servicios/:id/estado ────────────────────────────────────────────────
// RN-SV3: baja lógica protegida; la validación de turnos futuros vive en el Service.
serviciosRouter.patch("/:id/estado", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = CambiarEstadoServicioSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "El campo 'activo' (boolean) es requerido",
      parsed.error.issues,
    );
  }

  const servicio = await ServicioService.cambiarEstado(
    c.req.param("id"),
    parsed.data.activo,
    callerCtx(c),
  );
  return c.json(ok(servicio), 200);
});
