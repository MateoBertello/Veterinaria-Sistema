import { Hono } from "hono";
import { DashboardService } from "./dashboard.service.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";

// ─── /dashboard ──────────────────────────────────────────────────────────────
// Montado en /api/v1/dashboard
//
// Permisos (documentado, ver docs/PLAN_ETAPA10-13_Y_CIERRE_MVP.md §5):
// el resumen lo puede pedir CUALQUIER usuario autenticado y activo del tenant —
// es la pantalla de inicio, y exigir un permiso concreto dejaría sin home a los
// roles acotados. Lo que se filtra es el CONTENIDO: cada métrica exige el mismo
// permiso (RN-S2) y el mismo módulo licenciado (regla 4) que el endpoint dueño
// del dato, y vuelve como `null` si el usuario no la puede ver. Así el endpoint
// nunca entrega un agregado que su dueño negaría, y tampoco responde 403 en
// bloque por una sola métrica ajena al rol.
//
// NO se aplica requireModule acá: el resumen cruza los tres módulos vendibles y
// gatearlo por uno solo dejaría fuera a tenants que tienen los otros.
export const dashboardRouter = new Hono();

// requireActiveTenant bloquea tenants suspendidos (RN-SA3) antes de servir datos.
dashboardRouter.use("/*", tenantContext, requireActiveTenant);

// GET /dashboard/resumen — métricas agregadas del tenant (Etapa 12A).
dashboardRouter.get("/resumen", async (c) => {
  const { tenantId, userId } = getTenantContext(c);
  const resumen = await DashboardService.resumen({
    tenantId,
    callerUserId: userId,
    authHeader:   c.req.header("Authorization") ?? "",
  });
  return c.json(ok(resumen), 200);
});
