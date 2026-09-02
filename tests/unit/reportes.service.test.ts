import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReportesService } from "../../supabase/functions/api/src/modules/reportes/reportes.service.ts";
import * as dbModule from "../../supabase/functions/api/src/shared/db.ts";

describe("ReportesService", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const ctx = { tenantId };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("valorizacionAFecha", () => {
    it("reconstruye valorización desde movimientos_stock multiplicando por costo_unitario_efectivo", async () => {
      const mockLoteId = "lote-123";
      const mockProdId = "prod-456";

      const mockMovimientos = [
        { lote_id: mockLoteId, producto_id: mockProdId, cantidad_con_signo: 100, created_at: "2026-06-01T10:00:00Z" },
        { lote_id: mockLoteId, producto_id: mockProdId, cantidad_con_signo: -20, created_at: "2026-06-02T10:00:00Z" },
      ];

      const mockLotes = [
        { id: mockLoteId, codigo_lote: "L-001", fecha_vencimiento: "2027-01-01", costo_unitario_efectivo: "50.0000", producto_id: mockProdId },
      ];

      const mockProductos = [
        {
          id: mockProdId,
          codigo: "MED-01",
          nombre: "Antibiótico Test",
          familia_id: "fam-789",
          unidades_medida: { id: "u-1", nombre: "Comprimido", abreviatura: "comp" },
          familias_producto: { id: "fam-789", nombre: "Farmacia" },
        },
      ];

      const mockDb: any = {
        from: vi.fn((table: string) => {
          if (table === "movimientos_stock") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({ data: mockMovimientos, error: null }),
            };
          }
          if (table === "lotes") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockLotes, error: null }),
            };
          }
          if (table === "productos") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockProductos, error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }),
      };

      vi.spyOn(dbModule, "getServiceDb").mockReturnValue(mockDb);

      const res = await ReportesService.valorizacionAFecha(
        { fechaCorte: "2026-06-05T00:00:00Z" },
        ctx,
      );

      expect(res.totalLineas).toBe(1);
      expect(res.totalUnidades).toBe(80); // 100 - 20 = 80
      expect(res.valorizacionTotal).toBe(4000); // 80 * 50 = 4000
      expect(res.items[0].productoNombre).toBe("Antibiótico Test");
      expect(res.items[0].cantidadAFecha).toBe(80);
      expect(res.items[0].costoUnitarioEfectivo).toBe(50);
      expect(res.items[0].valorTotal).toBe(4000);
    });

    it("devuelve total 0 si no hay existencias positivas a la fecha de corte", async () => {
      const mockDb: any = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };

      vi.spyOn(dbModule, "getServiceDb").mockReturnValue(mockDb);

      const res = await ReportesService.valorizacionAFecha(
        { fechaCorte: "2026-01-01T00:00:00Z" },
        ctx,
      );

      expect(res.totalLineas).toBe(0);
      expect(res.totalUnidades).toBe(0);
      expect(res.valorizacionTotal).toBe(0);
      expect(res.items).toEqual([]);
    });
  });

  describe("rentabilidad", () => {
    it("calcula rentabilidad agrupando por ítem con margen y porcentaje correctos", async () => {
      const mockMargenRows = [
        {
          tenant_id: tenantId,
          venta_id: "v-1",
          vendido_at: "2026-08-01T12:00:00Z",
          tipo_item: "producto",
          item_id: "prod-1",
          item_nombre: "Vacuna Canina",
          cantidad: 2,
          neto_total: 2000,
          costo_total: 1200,
          margen: 800,
        },
        {
          tenant_id: tenantId,
          venta_id: "v-2",
          vendido_at: "2026-08-02T12:00:00Z",
          tipo_item: "producto",
          item_id: "prod-1",
          item_nombre: "Vacuna Canina",
          cantidad: 3,
          neto_total: 3000,
          costo_total: 1800,
          margen: 1200,
        },
      ];

      const mockDb: any = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockMargenRows, error: null }),
        })),
      };

      vi.spyOn(dbModule, "getServiceDb").mockReturnValue(mockDb);

      const res = await ReportesService.rentabilidad({}, ctx);

      expect(res.totalItemsVendidos).toBe(1);
      expect(res.totalNeto).toBe(5000);
      expect(res.totalCosto).toBe(3000);
      expect(res.totalMargenBruto).toBe(2000);
      expect(res.margenPromedioPct).toBe(40); // 2000 / 5000 * 100 = 40%
      expect(res.items[0].cantidadVendida).toBe(5);
      expect(res.items[0].margenPct).toBe(40);
    });
  });

  describe("rotacion", () => {
    it("identifica productos sin movimiento y calcula capital inmovilizado", async () => {
      const mockProductos = [
        { id: "p-1", codigo: "P1", nombre: "Shampoo Canino", costo_reposicion: 500, precio_venta: 1000, familia_id: "f1", familias_producto: { id: "f1", nombre: "Estética" } },
      ];
      const mockExistencias = [
        { producto_id: "p-1", cantidad: 10 },
      ];
      const mockMovimientos = [
        { producto_id: "p-1", tipo: "entrada_inicial", cantidad: 10, created_at: "2026-01-01T00:00:00Z" },
      ];

      const mockDb: any = {
        from: vi.fn((table: string) => {
          if (table === "productos") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              then: (fn: any) => Promise.resolve({ data: mockProductos, error: null }).then(fn),
            };
          }
          if (table === "existencias_lote") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: mockExistencias, error: null }),
            };
          }
          if (table === "movimientos_stock") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: mockMovimientos, error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }),
      };

      vi.spyOn(dbModule, "getServiceDb").mockReturnValue(mockDb);

      const res = await ReportesService.rotacion({ diasSinMovimiento: 30 }, ctx);

      expect(res.totalProductos).toBe(1);
      expect(res.totalSinMovimiento).toBe(1);
      expect(res.capitalInmovilizadoTotal).toBe(5000); // 10 * 500 = 5000
      expect(res.items[0].sinMovimiento).toBe(true);
    });
  });
});
