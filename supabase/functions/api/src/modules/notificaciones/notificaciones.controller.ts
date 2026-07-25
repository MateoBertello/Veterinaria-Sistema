import { Hono, type Context } from "hono";
import { NotificacionService, type CallerContext } from "./notificaciones.service.ts";
import { ConfigNotificacionTurnosSchema } from "./notificaciones.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

// Notificaciones de turnos: módulo vendible 'turnos' (RN-G2) + permiso
// manage_appointments (RN-S2), igual que el resto de la agenda.
export const notificacionesRouter = new Hono();

notificacionesRouter.use(
  "/*",
  tenantContext,
  requireActiveTenant,
  requireModule("turnos"),
  requirePermission("manage_appointments"),
);

function callerCtx(c: Context): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

// GET /turnos/notificaciones/config — configuración de recordatorios (RN-NT1).
notificacionesRouter.get("/config", async (c) => {
  const { tenantId } = getTenantContext(c);
  const cfg = await NotificacionService.obtenerConfig(tenantId);
  return c.json(ok(cfg), 200);
});

// PUT /turnos/notificaciones/config — guardar configuración (merge en parametros_extra).
notificacionesRouter.put("/config", async (c) => {
  const parsed = ConfigNotificacionTurnosSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Configuración de notificaciones inválida",
      parsed.error.issues,
    );
  }
  const { tenantId } = getTenantContext(c);
  const cfg = await NotificacionService.guardarConfig(tenantId, parsed.data, callerCtx(c));
  return c.json(ok(cfg), 200);
});

// POST /turnos/notificaciones/procesar — disparo manual "Verificar" (RN-NT5).
// Procesa SOLO el tenant del JWT; el cron periódico (E9) barrerá todos los activos.
notificacionesRouter.post("/procesar", async (c) => {
  const { tenantId } = getTenantContext(c);
  const resumen = await NotificacionService.procesarRecordatoriosTurnos({ tenantId });
  return c.json(ok(resumen), 200);
});
