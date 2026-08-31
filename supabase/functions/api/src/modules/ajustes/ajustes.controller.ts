import { Hono } from "hono";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { ok, fail } from "../../shared/envelope.ts";
import { ErrorCode } from "../../shared/errors.ts";
import { AjustesService } from "./ajustes.service.ts";
import {
  AjustarExistenciaSchema,
  BloquearLoteSchema,
  DesbloquearLoteSchema,
  CrearRecuentoSchema,
  GuardarDetallesRecuentoSchema,
  AplicarRecuentoSchema,
  ListarRecuentosQuerySchema,
  RegistrarDevolucionSchema,
} from "./ajustes.schemas.ts";

// ─── Ajustes Router ─────────────────────────────────────────────────────────
export const ajustesRouter = new Hono();

ajustesRouter.use("*", tenantContext);
ajustesRouter.use("*", requireActiveTenant);
ajustesRouter.use("*", requireModule("stock"));
ajustesRouter.use("*", requirePermission("manage_stock"));

ajustesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AjustarExistenciaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de ajuste inválidos", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.ajustarExistencia(parsed.data, tenantId, userId);
  return c.json(ok(result), 201);
});

// ─── Lotes Bloqueo/Desbloqueo Router (aditivo en /lotes) ────────────────────
export const lotesAjustesRouter = new Hono();

lotesAjustesRouter.use("*", tenantContext);
lotesAjustesRouter.use("*", requireActiveTenant);
lotesAjustesRouter.use("*", requireModule("stock"));
lotesAjustesRouter.use("*", requirePermission("manage_stock"));

lotesAjustesRouter.post("/:id/bloquear", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = BloquearLoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Motivo de bloqueo inválido", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.bloquearLote(id, parsed.data, tenantId, userId);
  return c.json(ok(result));
});

lotesAjustesRouter.post("/:id/desbloquear", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = DesbloquearLoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Motivo de desbloqueo inválido", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.desbloquearLote(id, parsed.data, tenantId, userId);
  return c.json(ok(result));
});

// ─── Recuentos Router ───────────────────────────────────────────────────────
export const recuentosRouter = new Hono();

recuentosRouter.use("*", tenantContext);
recuentosRouter.use("*", requireActiveTenant);
recuentosRouter.use("*", requireModule("stock"));
recuentosRouter.use("*", requirePermission("manage_stock"));

recuentosRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CrearRecuentoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de recuento inválidos", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.crearRecuento(parsed.data, tenantId, userId);
  return c.json(ok(result), 201);
});

recuentosRouter.get("/", async (c) => {
  const query = ListarRecuentosQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros de consulta inválidos", 400, query.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await AjustesService.listarRecuentos(query.data, tenantId);
  return c.json(ok(result.data, result.meta));
});

recuentosRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const result = await AjustesService.obtenerRecuento(id, tenantId);
  return c.json(ok(result));
});

recuentosRouter.put("/:id/detalles", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = GuardarDetallesRecuentoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Detalles de recuento inválidos", 400, parsed.error.issues), 400);
  }
  const { tenantId } = getTenantContext(c);
  const result = await AjustesService.guardarDetallesRecuento(id, parsed.data, tenantId);
  return c.json(ok(result));
});

recuentosRouter.post("/:id/aplicar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = AplicarRecuentoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Parámetros de aplicación inválidos", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.aplicarRecuento(id, parsed.data, tenantId, userId);
  return c.json(ok(result));
});

recuentosRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const { tenantId } = getTenantContext(c);
  const result = await AjustesService.eliminarRecuento(id, tenantId);
  return c.json(ok(result));
});

// ─── Devoluciones Router ────────────────────────────────────────────────────
export const devolucionesRouter = new Hono();

devolucionesRouter.use("*", tenantContext);
devolucionesRouter.use("*", requireActiveTenant);
devolucionesRouter.use("*", requireModule("ventas"));
devolucionesRouter.use("*", requirePermission("manage_sales"));

devolucionesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RegistrarDevolucionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(fail(ErrorCode.VALIDATION_ERROR, "Datos de devolución inválidos", 400, parsed.error.issues), 400);
  }
  const { tenantId, userId } = getTenantContext(c);
  const result = await AjustesService.registrarDevolucion(parsed.data, tenantId, userId);
  return c.json(ok(result), 201);
});
