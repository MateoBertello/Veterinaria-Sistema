import { Hono } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { ModuloService } from "./modulos.service.ts";
import { ok } from "../../shared/envelope.ts";

export const modulosRouter = new Hono();

// GET /api/v1/modulos-habilitados — módulos del tenant del JWT (sidebar dinámico, RN-G2).
// requireActiveTenant bloquea tenants suspendidos (RN-SA3) antes de servir datos.
modulosRouter.use("/*", tenantContext, requireActiveTenant);

modulosRouter.get("/", async (c) => {
  const { tenantId } = getTenantContext(c);
  const authHeader   = c.req.header("Authorization") ?? "";
  const modulos      = await ModuloService.habilitadosDelTenant(tenantId, authHeader);
  return c.json(ok(modulos), 200);
});
