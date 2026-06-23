import { Hono, type Context } from "hono";
import { DoctorService, type CallerContext } from "./doctores.service.ts";
import {
  ActualizarDoctorSchema,
  ListarDoctoresQuerySchema,
} from "./doctores.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

export const doctoresRouter = new Hono();

// Autenticación → tenant activo (RN-SA3) → permiso manage_users.
// Doctores es una extensión del usuario (RN-SEC5); su gestión va bajo manage_users.
doctoresRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_users"),
);

/** Contexto del llamante — tenant_id y userId siempre del JWT. */
function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
}

// ── GET /doctores ────────────────────────────────────────────────────────────
doctoresRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);

  const parsed = ListarDoctoresQuerySchema.safeParse({
    search:    c.req.query("search"),
    available: c.req.query("available"),
    page:      c.req.query("page"),
    limit:     c.req.query("limit"),
  });

  const opts = parsed.success
    ? parsed.data
    : { page: 1, limit: 20, search: undefined, available: undefined };

  const { items, total } = await DoctorService.buscarPaginado(opts, tenantId);
  return c.json(ok(items, { page: opts.page, limit: opts.limit, total }), 200);
});

// ── GET /doctores/:id ──────────────────────────────────────────────────────────
doctoresRouter.get("/:id", async (c) => {
  const { tenantId } = getTenantContext(c);
  const doctor = await DoctorService.obtenerPorId(c.req.param("id"), tenantId);

  if (!doctor) {
    throw new DomainError(ErrorCode.FORBIDDEN, 403, "Doctor no encontrado en este tenant");
  }
  return c.json(ok(doctor), 200);
});

// ── PATCH /doctores/:id ────────────────────────────────────────────────────────
// Editar perfil profesional; available=false es la baja lógica.
doctoresRouter.patch("/:id", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = ActualizarDoctorSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de doctor inválidos",
      parsed.error.issues,
    );
  }

  const doctor = await DoctorService.actualizar(c.req.param("id"), parsed.data, callerCtx(c));
  return c.json(ok(doctor), 200);
});
