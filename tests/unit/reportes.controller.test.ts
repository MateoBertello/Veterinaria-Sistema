import { describe, expect, it, vi, beforeEach } from "vitest";
import { reportesRouter } from "../../supabase/functions/api/src/modules/reportes/reportes.controller.ts";
import { ReportesService } from "../../supabase/functions/api/src/modules/reportes/reportes.service.ts";
import { Hono } from "hono";

// Mock middlewares
vi.mock("../../supabase/functions/api/src/middleware/tenantContext.ts", () => ({
  tenantContext: async (c: any, next: any) => {
    c.set("tenantId", "11111111-1111-1111-1111-111111111111");
    c.set("userId", "00000000-0000-0000-0000-000000000001");
    await next();
  },
  getTenantContext: () => ({
    tenantId: "11111111-1111-1111-1111-111111111111",
    userId: "00000000-0000-0000-0000-000000000001",
  }),
}));

vi.mock("../../supabase/functions/api/src/middleware/requireActiveTenant.ts", () => ({
  requireActiveTenant: async (_c: any, next: any) => next(),
}));

vi.mock("../../supabase/functions/api/src/middleware/requireModule.ts", () => ({
  requireModule: () => async (_c: any, next: any) => next(),
}));

vi.mock("../../supabase/functions/api/src/middleware/requirePermission.ts", () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}));

describe("Reportes Controller", () => {
  const app = new Hono().route("/reportes", reportesRouter);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /reportes/valorizacion-fecha devuelve 200 con reporte de valorización", async () => {
    const mockRes = {
      fechaCorte: "2026-08-31T00:00:00.000Z",
      totalLineas: 1,
      totalUnidades: 50,
      valorizacionTotal: 2500,
      items: [],
    };
    vi.spyOn(ReportesService, "valorizacionAFecha").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/valorizacion-fecha?fechaCorte=2026-08-31T00:00:00.000Z");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/rotacion devuelve 200 con reporte de rotación", async () => {
    const mockRes = {
      diasLimite: 30,
      totalProductos: 5,
      totalSinMovimiento: 1,
      capitalInmovilizadoTotal: 4000,
      items: [],
    };
    vi.spyOn(ReportesService, "rotacion").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/rotacion?diasSinMovimiento=30");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/rentabilidad devuelve 200 con reporte de rentabilidad", async () => {
    const mockRes = {
      totalItemsVendidos: 2,
      totalNeto: 10000,
      totalCosto: 6000,
      totalMargenBruto: 4000,
      margenPromedioPct: 40,
      items: [],
    };
    vi.spyOn(ReportesService, "rentabilidad").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/rentabilidad");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/fraccionamiento devuelve 200 con reporte de fraccionamiento", async () => {
    const mockRes = [
      { operacion_id: "op-1", producto_origen_nombre: "Caja", producto_destino_nombre: "Blíster", merma: 0 },
    ];
    vi.spyOn(ReportesService, "costoFraccionamiento").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/fraccionamiento");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/ventas-usuario devuelve 200", async () => {
    const mockRes = [
      { usuarioId: "u-1", usuarioNombre: "Admin", cantidadOperaciones: 10, totalVentas: 50000 },
    ];
    vi.spyOn(ReportesService, "ventasPorUsuario").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/ventas-usuario");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/ventas-sesion devuelve 200", async () => {
    const mockRes = [
      { sesionId: "s-1", cajaNombre: "Caja 1", estado: "cerrada", totalVentas: 25000 },
    ];
    vi.spyOn(ReportesService, "ventasPorSesion").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/ventas-sesion");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/ventas-medio-pago devuelve 200", async () => {
    const mockRes = {
      granTotal: 50000,
      totalTransacciones: 10,
      items: [{ medioPagoNombre: "Efectivo", totalRecaudado: 50000, porcentajeDelTotal: 100 }],
    };
    vi.spyOn(ReportesService, "ventasPorMedioPago").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/ventas-medio-pago");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/consumo-profesional devuelve 200", async () => {
    const mockRes = [
      { profesionalNombre: "Dr. García", cantidadConsumos: 5, costoTotalInsumos: 6000 },
    ];
    vi.spyOn(ReportesService, "consumoPorProfesional").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/consumo-profesional");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });

  it("GET /reportes/consumo-especie devuelve 200", async () => {
    const mockRes = [
      { especieNombre: "Canino", cantidadConsumos: 5, costoTotalInsumos: 6000 },
    ];
    vi.spyOn(ReportesService, "consumoPorEspecie").mockResolvedValue(mockRes as any);

    const res = await app.request("/reportes/consumo-especie");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(mockRes);
  });
});
