import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsumoService } from "../../supabase/functions/api/src/modules/consumo/consumo.service";
import { DomainError } from "../../supabase/functions/api/src/shared/errors";
import { getServiceDb } from "../../supabase/functions/api/src/shared/db";
import * as audit from "../../supabase/functions/api/src/shared/audit";

vi.mock("../../supabase/functions/api/src/shared/db", () => ({
  getServiceDb: vi.fn(),
  getDb: vi.fn()
}));

const mockDb = {
  rpc: vi.fn(),
  from: vi.fn(),
};

const mockCtx: any = {
  tenantId: "t-1",
  userId: "u-1",
  roles: ["admin"],
  db: mockDb as any,
  serviceDb: mockDb as any,
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
  requestId: "req-1",
};

describe("ConsumoService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RN-CC3: la bandera de receta cambia el comportamiento sin migración", async () => {
    // Si la bandera está en false, el RPC devuelve advertencias
    mockDb.rpc.mockResolvedValueOnce({
      data: [{
        operacion_id: "op-1", movimientos: 1, costo_total: 100,
        advertencias: [{ tipo: "producto_bajo_receta_sin_receta", productoId: "p1", nombre: "Vacuna" }]
      }],
      error: null
    });

    const resAdv = await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    expect(resAdv.data!.advertencias).toHaveLength(1);
    expect(resAdv.data!.advertencias[0].tipo).toBe("producto_bajo_receta_sin_receta");

    // Si la bandera está en true, el RPC falla con PRESCRIPTION_REQUIRED
    mockDb.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PRESCRIPTION_REQUIRED" }
    });

    let error: any;
    try {
      await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe("PRESCRIPTION_REQUIRED");
  });

  it("las advertencias del RPC se propagan sin filtrar", async () => {
    mockDb.rpc.mockResolvedValueOnce({
      data: [{
        operacion_id: "op-1", movimientos: 1, costo_total: 100,
        advertencias: [{ tipo: "w1" }, { tipo: "w2" }]
      }],
      error: null
    });

    const res = await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    expect(res.data!.advertencias).toHaveLength(2);
  });

  it("el Service no lee existencias para decidir", async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: [{ operacion_id: "op-1", movimientos: 1, costo_total: 10, advertencias: [] }], error: null });
    await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    
    // Solo debe haber llamado a rpc()
    expect(mockDb.from).not.toHaveBeenCalled();
    expect(mockDb.rpc).toHaveBeenCalledWith("registrar_consumo_clinico", expect.any(Object));
  });

  it("el tenantId sale del contexto", async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: [{ operacion_id: "op-1", movimientos: 1, costo_total: 10, advertencias: [] }], error: null });
    await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    
    expect(mockDb.rpc).toHaveBeenCalledWith("registrar_consumo_clinico", expect.objectContaining({
      p_tenant_id: "t-1",
      p_usuario_id: "u-1"
    }));
  });

  it("no se acepta mascotaId del body", async () => {
    // Es responsabilidad de schemas y de que el param no se pase.
    mockDb.rpc.mockResolvedValueOnce({ data: [{ operacion_id: "op-1", movimientos: 1, costo_total: 10, advertencias: [] }], error: null });
    await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    
    const callArgs = mockDb.rpc.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("p_mascota_id");
  });

  it("un error desconocido no filtra el mensaje interno", async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: null, error: { message: "violates check constraint chk_algo" } });
    let error: any;
    try {
      await ConsumoService.registrar(mockCtx, "h-1", [{ productoId: "p1", cantidad: 1, loteId: null }]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).not.toMatch(/chk_algo/); // el mensaje interno se oculta
  });

  it("no hay N+1 en porEvento", async () => {
    const mockEq2 = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    mockDb.from.mockReturnValue({ select: mockSelect });

    await ConsumoService.porEvento(mockCtx, "h-1");
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith("movimientos_stock");
    expect(mockSelect).toHaveBeenCalledWith("*, productos(id, codigo, nombre), lotes(id, codigo_lote)");
  });
  it("RN-MV6: el costo por atención usa el costo guardado", async () => {
    const mockDb = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          historial_id: "h-1",
          mascota_nombre: "Firulais",
          fecha_evento: "2023-01-01",
          profesional_id: "prof-1",
          cantidad: 1,
          costo_total: 100 // costo guardado (no importa si costo_reposicion es 130)
        }],
        error: null
      })
    };
    (getServiceDb as any).mockReturnValue(mockDb);

    const result = await ConsumoService.costoPorAtencion(mockCtx);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].costoTotal).toBe(100);
  });

  it("las atenciones sin consumo no se presentan como errores", async () => {
    const mockDb = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          historial_id: "h-2",
          mascota_nombre: "Luna",
          fecha_evento: "2023-01-02",
          event_type: "consulta",
          profesional_id: "prof-2"
        }],
        error: null
      })
    };
    (getServiceDb as any).mockReturnValue(mockDb);

    const result = await ConsumoService.consumosPendientesDeRegularizar(mockCtx);
    expect(result.data).toHaveLength(1);
    // El DTO no tiene campo error ni invalido
    expect(result.data[0]).not.toHaveProperty("error");
    expect(result.data[0]).not.toHaveProperty("invalido");
  });

  it("los cuatro métodos filtran por tenant", async () => {
    const mockDb = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    };
    (getServiceDb as any).mockReturnValue(mockDb);

    await ConsumoService.mascotasDeLote(mockCtx, "lote-1");
    expect(mockDb.eq).toHaveBeenCalledWith("tenant_id", "t-1");

    await ConsumoService.lotesDeMascota(mockCtx, "masc-1");
    expect(mockDb.eq).toHaveBeenCalledWith("tenant_id", "t-1");

    await ConsumoService.costoPorAtencion(mockCtx);
    expect(mockDb.eq).toHaveBeenCalledWith("tenant_id", "t-1");

    await ConsumoService.consumosPendientesDeRegularizar(mockCtx);
    expect(mockDb.eq).toHaveBeenCalledWith("tenant_id", "t-1");
  });
});
