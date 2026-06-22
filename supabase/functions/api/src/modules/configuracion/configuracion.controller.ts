import { Hono, type Context } from "hono";
import { ConfiguracionService, type CallerContext } from "./configuracion.service.ts";
import { ActualizarConfiguracionSchema } from "./configuracion.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";

export const configuracionRouter = new Hono();

// RN-CF4: requiere manage_tenant_settings (rol Admin).
// Configuración es Core transversal: no pasa por requireModule.
configuracionRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requirePermission("manage_tenant_settings"),
);

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: "unknown", callerRole: "unknown" };
}

// ── GET /configuracion ────────────────────────────────────────────────────────
// RN-CF1: siempre devuelve el singleton; CONFIG_NOT_FOUND si el seeder falló.
configuracionRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);
  const cfg = await ConfiguracionService.obtener(tenantId);
  return c.json(ok(cfg), 200);
});

// ── PUT /configuracion ────────────────────────────────────────────────────────
// RN-CF2: validación de rangos; RN-CF3: efecto inmediato; RN-CF5: auditoría.
configuracionRouter.put("/", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = ActualizarConfiguracionSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de configuración inválidos",
      parsed.error.issues,
    );
  }

  const { tenantId } = getTenantContext(c);
  const cfg = await ConfiguracionService.actualizar(tenantId, parsed.data, callerCtx(c));
  return c.json(ok(cfg), 200);
});
