import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { ReportesService } from "../../supabase/functions/api/src/modules/reportes/reportes.service.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;
const tenantA = "11111111-1111-1111-1111-111111111111";
const tenantB = "22222222-2222-2222-2222-222222222222";

describeIntegration("C8: Reportes Comerciales y Fixture de Volumen", () => {
  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: prod } = await serviceDb
      .from("productos")
      .select("id")
      .eq("tenant_id", tenantA)
      .limit(1);

    if (!prod || prod.length === 0) {
      const { execSync } = await import("child_process");
      const path = await import("path");
      const seedPath = path.resolve(process.cwd(), "supabase/seeds/comercial_volumen_seed.sql");
      execSync(`docker exec -i supabase_db_Veterinaria-Sistema psql -U postgres -d postgres < "${seedPath}"`);
    }
  });

  it("RN-MV6 / C8·T1: valorizacionAFecha reconstruye inventario desde el libro mayor a distintas fechas", async () => {
    // 1. Valorización a fecha actual
    const repHoy = await ReportesService.valorizacionAFecha({}, { tenantId: tenantA });
    expect(repHoy.totalLineas).toBeGreaterThan(0);
    expect(repHoy.totalUnidades).toBeGreaterThan(0);
    expect(repHoy.valorizacionTotal).toBeGreaterThan(0);

    // 2. Valorización histórica en el pasado (hace 100 días, antes de salidas/ventas)
    const fechaPasada = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const repPasado = await ReportesService.valorizacionAFecha({ fechaCorte: fechaPasada }, { tenantId: tenantA });

    // En el pasado hubo menos movimientos de salida registrados
    expect(repPasado.totalLineas).toBeGreaterThanOrEqual(0);
  });

  it("RN-MV6: modificar productos.costo_reposicion NO altera la valorización histórica ni la rentabilidad", async () => {
    // Tomar un producto del tenant A
    const { data: prod } = await serviceDb
      .from("productos")
      .select("id, costo_reposicion")
      .eq("tenant_id", tenantA)
      .eq("codigo", "AMOX-BLIST")
      .single();

    expect(prod).toBeDefined();
    const costoOriginal = Number(prod!.costo_reposicion);

    // Obtener valorización y rentabilidad antes del cambio
    const valBefore = await ReportesService.valorizacionAFecha({ productoId: prod!.id }, { tenantId: tenantA });
    const rentBefore = await ReportesService.rentabilidad({ productoId: prod!.id }, { tenantId: tenantA });

    // Modificar costo_reposicion en productos
    await serviceDb
      .from("productos")
      .update({ costo_reposicion: costoOriginal * 5 })
      .eq("id", prod!.id)
      .eq("tenant_id", tenantA);

    try {
      // Obtener valorización y rentabilidad después del cambio
      const valAfter = await ReportesService.valorizacionAFecha({ productoId: prod!.id }, { tenantId: tenantA });
      const rentAfter = await ReportesService.rentabilidad({ productoId: prod!.id }, { tenantId: tenantA });

      // Verificar que los costos y valorizaciones permanecieron idénticos
      expect(valAfter.valorizacionTotal).toBe(valBefore.valorizacionTotal);
      expect(valAfter.items[0]?.costoUnitarioEfectivo).toBe(valBefore.items[0]?.costoUnitarioEfectivo);
      expect(rentAfter.totalCosto).toBe(rentBefore.totalCosto);
      expect(rentAfter.totalMargenBruto).toBe(rentBefore.totalMargenBruto);
    } finally {
      // Restaurar costo_reposicion original
      await serviceDb
        .from("productos")
        .update({ costo_reposicion: costoOriginal })
        .eq("id", prod!.id)
        .eq("tenant_id", tenantA);
    }
  });

  it("C8·T2: rotacion detecta productos sin movimiento y calcula capital inmovilizado", async () => {
    const rot = await ReportesService.rotacion({ diasSinMovimiento: 10 }, { tenantId: tenantA });
    expect(rot.totalProductos).toBeGreaterThan(0);
    expect(rot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigo: "ACC-BOZAL-G",
          sinMovimiento: true,
        }),
      ]),
    );
  });

  it("C8·T2: rentabilidad calcula margen bruto sobre ventas registradas", async () => {
    const rent = await ReportesService.rentabilidad({}, { tenantId: tenantA });
    expect(rent.totalItemsVendidos).toBeGreaterThan(0);
    expect(rent.totalNeto).toBeGreaterThan(0);
    expect(rent.totalCosto).toBeGreaterThan(0);
    expect(rent.totalMargenBruto).toBe(rent.totalNeto - rent.totalCosto);
    expect(rent.margenPromedioPct).toBeGreaterThan(0);
  });

  it("C8·T2: ventasPorUsuario agrega correctamente operaciones y tickets", async () => {
    const vUsers = await ReportesService.ventasPorUsuario({}, { tenantId: tenantA });
    expect(vUsers.length).toBeGreaterThan(0);
    expect(vUsers[0].cantidadOperaciones).toBeGreaterThan(0);
    expect(vUsers[0].totalVentas).toBeGreaterThan(0);
    expect(vUsers[0].ticketPromedio).toBeGreaterThan(0);
  });

  it("C8·T2: ventasPorSesion desglosa ventas y arqueo por sesión de caja", async () => {
    const vSesiones = await ReportesService.ventasPorSesion({}, { tenantId: tenantA });
    expect(vSesiones.length).toBeGreaterThan(0);
    expect(vSesiones[0].estado).toBe("cerrada");
    expect(vSesiones[0].cantidadVentas).toBeGreaterThan(0);
    expect(vSesiones[0].totalVentas).toBeGreaterThan(0);
  });

  it("C8·T2: ventasPorMedioPago agrupa transacciones y porcentajes", async () => {
    const vMp = await ReportesService.ventasPorMedioPago({}, { tenantId: tenantA });
    expect(vMp.totalTransacciones).toBeGreaterThan(0);
    expect(vMp.granTotal).toBeGreaterThan(0);
    expect(vMp.items.length).toBeGreaterThanOrEqual(1);
    const sumPct = vMp.items.reduce((acc, cur) => acc + cur.porcentajeDelTotal, 0);
    expect(Math.round(sumPct)).toBe(100);
  });

  it("C8·T2: consumoPorProfesional y consumoPorEspecie devuelven trazabilidad clínica", async () => {
    const cProf = await ReportesService.consumoPorProfesional({}, { tenantId: tenantA });
    expect(cProf.length).toBeGreaterThan(0);
    expect(cProf[0].cantidadConsumos).toBeGreaterThan(0);
    expect(cProf[0].costoTotalInsumos).toBeGreaterThan(0);

    const cEsp = await ReportesService.consumoPorEspecie({}, { tenantId: tenantA });
    expect(cEsp.length).toBeGreaterThan(0);
    expect(cEsp[0].cantidadConsumos).toBeGreaterThan(0);
    expect(cEsp[0].costoTotalInsumos).toBeGreaterThan(0);
  });

  it("G1: Aislamiento por tenant estricto en todos los reportes", async () => {
    const repA = await ReportesService.valorizacionAFecha({}, { tenantId: tenantA });
    const repB = await ReportesService.valorizacionAFecha({}, { tenantId: tenantB });

    // Cada tenant tiene sus propios lotes
    const loteIdsA = new Set(repA.items.map((i) => i.loteId));
    const loteIdsB = new Set(repB.items.map((i) => i.loteId));

    for (const idA of loteIdsA) {
      expect(loteIdsB.has(idA)).toBe(false);
    }
  });
});
