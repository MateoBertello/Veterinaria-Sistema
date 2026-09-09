import { Hono, type Context as HonoContext } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { ok, fail } from "../../shared/envelope.ts";
import { ErrorCode } from "../../shared/errors.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";
import { CajaService, type CallerContext } from "./caja.service.ts";
import {
  AbrirSesionSchema,
  RegistrarMovimientoSchema,
  CerrarSesionSchema,
  ListarSesionesQuerySchema,
} from "./caja.schemas.ts";

function callerCtx(c: HonoContext): CallerContext {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

export const cajaRouter = new Hono();

cajaRouter.use("*", tenantContext);
cajaRouter.use("*", requireActiveTenant);
cajaRouter.use("*", requireModule("ventas"));
cajaRouter.use("*", requirePermission("manage_cash"));

// ─── Cajas ────────────────────────────────────────────────────────────

cajaRouter.get("/cajas", async (c) => {
  const { tenantId } = getTenantContext(c);
  const data = await CajaService.listarCajas(tenantId);
  return c.json(ok(data));
});

// ─── Sesiones ─────────────────────────────────────────────────────────

cajaRouter.get("/sesiones", async (c) => {
  const query = ListarSesionesQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await CajaService.listarSesiones(tenantId, query.data);
  return c.json(ok(result.items, { total: result.total, page: result.page, limit: result.limit }));
});

cajaRouter.get("/sesiones/actual", async (c) => {
  const { tenantId } = getTenantContext(c);
  const cajaId = c.req.query("cajaId");
  const data = await CajaService.sesionAbierta(tenantId, cajaId);
  return c.json(ok(data));
});

cajaRouter.get("/sesiones/:id", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const data = await CajaService.obtenerSesion(id, tenantId);
  return c.json(ok(data));
});

cajaRouter.get("/sesiones/:id/resumen", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const data = await CajaService.resumenSesion(id, tenantId);
  return c.json(ok(data));
});

cajaRouter.post("/sesiones", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AbrirSesionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de apertura inválidos", 400, parsed.error.issues), 400);
  }
  const data = await CajaService.abrirSesion(parsed.data, callerCtx(c));
  return c.json(ok(data), 201);
});

cajaRouter.post("/sesiones/:id/movimientos", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = RegistrarMovimientoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de movimiento inválidos", 400, parsed.error.issues), 400);
  }
  const data = await CajaService.registrarMovimiento(id, parsed.data, callerCtx(c));
  return c.json(ok(data), 201);
});

cajaRouter.post("/sesiones/:id/cerrar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = CerrarSesionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de cierre inválidos", 400, parsed.error.issues), 400);
  }
  const data = await CajaService.cerrarSesion(id, parsed.data, callerCtx(c));
  return c.json(ok(data), 200);
});
