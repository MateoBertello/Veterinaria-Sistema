import { Hono, type Context as HonoContext } from "hono";
import { ReportesService, type Context } from "./reportes.service.ts";
import {
  ValorizacionAFechaQuerySchema,
  ReporteRotacionQuerySchema,
  ReporteRentabilidadQuerySchema,
  ReporteFraccionamientoQuerySchema,
  ReporteVentasUsuarioQuerySchema,
  ReporteVentasSesionQuerySchema,
  ReporteVentasMedioPagoQuerySchema,
  ReporteConsumoProfesionalQuerySchema,
  ReporteConsumoEspecieQuerySchema,
} from "./reportes.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { requireActiveTenant } from "../../middleware/requireActiveTenant.ts";
import { requireModule } from "../../middleware/requireModule.ts";
import { requirePermission } from "../../middleware/requirePermission.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";

function callerCtx(c: HonoContext): Context {
  const { tenantId, userId } = getTenantContext(c);
  return { tenantId, callerUserId: userId, callerName: CALLER_UNRESOLVED, callerRole: CALLER_UNRESOLVED };
}

export const reportesRouter = new Hono();

// Middleware base de tenant
reportesRouter.use("*", tenantContext);
reportesRouter.use("*", requireActiveTenant);

// Permisos y módulos
const stockModule = requireModule("stock");
const ventasModule = requireModule("ventas");
const viewStock = requirePermission("view_stock");
const viewSales = requirePermission("view_sales");

// ─── 1. Reportes de Stock e Inventario ────────────────────────────────────────

// GET /api/v1/reportes/valorizacion-fecha
reportesRouter.get("/valorizacion-fecha", stockModule, viewStock, async (c) => {
  const query = {
    fechaCorte: c.req.query("fechaCorte"),
    productoId: c.req.query("productoId"),
    familiaId: c.req.query("familiaId"),
  };
  const parsed = ValorizacionAFechaQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.valorizacionAFecha(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/rotacion
reportesRouter.get("/rotacion", stockModule, viewStock, async (c) => {
  const query = {
    diasSinMovimiento: c.req.query("diasSinMovimiento"),
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    familiaId: c.req.query("familiaId"),
  };
  const parsed = ReporteRotacionQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.rotacion(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/fraccionamiento
reportesRouter.get("/fraccionamiento", stockModule, viewStock, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    productoOrigenId: c.req.query("productoOrigenId"),
    productoDestinoId: c.req.query("productoDestinoId"),
  };
  const parsed = ReporteFraccionamientoQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.costoFraccionamiento(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/consumo-profesional
reportesRouter.get("/consumo-profesional", stockModule, viewStock, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    profesionalId: c.req.query("profesionalId"),
  };
  const parsed = ReporteConsumoProfesionalQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.consumoPorProfesional(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/consumo-especie
reportesRouter.get("/consumo-especie", stockModule, viewStock, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    especieId: c.req.query("especieId"),
  };
  const parsed = ReporteConsumoEspecieQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.consumoPorEspecie(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// ─── 2. Reportes de Ventas y Finanzas ─────────────────────────────────────────

// GET /api/v1/reportes/rentabilidad
reportesRouter.get("/rentabilidad", ventasModule, viewSales, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    familiaId: c.req.query("familiaId"),
    productoId: c.req.query("productoId"),
  };
  const parsed = ReporteRentabilidadQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.rentabilidad(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/ventas-usuario
reportesRouter.get("/ventas-usuario", ventasModule, viewSales, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    usuarioId: c.req.query("usuarioId"),
  };
  const parsed = ReporteVentasUsuarioQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.ventasPorUsuario(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/ventas-sesion
reportesRouter.get("/ventas-sesion", ventasModule, viewSales, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    cajaId: c.req.query("cajaId"),
    sesionId: c.req.query("sesionId"),
  };
  const parsed = ReporteVentasSesionQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.ventasPorSesion(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});

// GET /api/v1/reportes/ventas-medio-pago
reportesRouter.get("/ventas-medio-pago", ventasModule, viewSales, async (c) => {
  const query = {
    desde: c.req.query("desde"),
    hasta: c.req.query("hasta"),
    medioPagoId: c.req.query("medioPagoId"),
  };
  const parsed = ReporteVentasMedioPagoQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      400,
      "Parámetros de consulta inválidos",
      parsed.error.issues,
    );
  }

  const resultado = await ReportesService.ventasPorMedioPago(parsed.data, callerCtx(c));
  return c.json(ok(resultado));
});
