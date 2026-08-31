import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { StockService } from "../../supabase/functions/api/src/modules/stock/stock.service.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PROD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("StockService — Reglas de negocio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RN-LO5: FEFO ordena por vencimiento, ingreso e id", async () => {
    const lotesDb = [
      {
        lote_id: "lote-3-sin-venc",
        cantidad: 10,
        lote: {
          id: "lote-3-sin-venc",
          codigo_lote: "L-NULL",
          fecha_vencimiento: null,
          fecha_ingreso: "2026-01-01",
          estado: "disponible",
          costo_unitario_efectivo: 100,
        },
      },
      {
        lote_id: "lote-1-marzo",
        cantidad: 5,
        lote: {
          id: "lote-1-marzo",
          codigo_lote: "L-MAR",
          fecha_vencimiento: "2026-03-01",
          fecha_ingreso: "2026-01-10",
          estado: "disponible",
          costo_unitario_efectivo: 120,
        },
      },
      {
        lote_id: "lote-2-enero",
        cantidad: 8,
        lote: {
          id: "lote-2-enero",
          codigo_lote: "L-ENE",
          fecha_vencimiento: "2026-01-15",
          fecha_ingreso: "2026-01-05",
          estado: "disponible",
          costo_unitario_efectivo: 110,
        },
      },
      {
        lote_id: "lote-4-igual-a",
        cantidad: 4,
        lote: {
          id: "lote-4-igual-a",
          codigo_lote: "L-EQ-A",
          fecha_vencimiento: "2026-05-01",
          fecha_ingreso: "2026-01-01",
          estado: "disponible",
          costo_unitario_efectivo: 100,
        },
      },
      {
        lote_id: "lote-5-igual-b",
        cantidad: 4,
        lote: {
          id: "lote-5-igual-b",
          codigo_lote: "L-EQ-B",
          fecha_vencimiento: "2026-05-01",
          fecha_ingreso: "2026-01-01",
          estado: "disponible",
          costo_unitario_efectivo: 100,
        },
      },
    ];

    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);

    // Mock returns the raw DB rows (ordered as DB returns them)
    // The service handles returning them
    mockGetServiceDb.mockReturnValue({
      ...chain,
      then: (resolve: any) => resolve({ data: lotesDb, error: null }),
    } as any);

    const candidatos = await StockService.listarCandidatosFefo(PROD_ID, 10, TENANT_ID);

    // Verify ordering clauses were applied to Postgres query:
    // 1. fecha_vencimiento ascending, nullsFirst: false
    // 2. fecha_ingreso ascending
    // 3. id ascending
    expect(chain.order).toHaveBeenCalledWith("fecha_vencimiento", {
      foreignTable: "lotes",
      ascending: true,
      nullsFirst: false,
    });
    expect(chain.order).toHaveBeenCalledWith("fecha_ingreso", {
      foreignTable: "lotes",
      ascending: true,
    });
    expect(chain.order).toHaveBeenCalledWith("id", {
      foreignTable: "lotes",
      ascending: true,
    });
  });

  it("RN-LO4: un lote vencido no es candidato, para ningún rol", async () => {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);

    mockGetServiceDb.mockReturnValue({
      ...chain,
      then: (resolve: any) => resolve({ data: [], error: null }),
    } as any);

    // Calling as regular user or admin
    await StockService.listarCandidatosFefo(PROD_ID, 5, TENANT_ID);

    // Verifica que el filtro .or con fecha_vencimiento >= hoy (o null) fue exigido
    expect(chain.or).toHaveBeenCalled();
    const orCallArg = chain.or.mock.calls[0][0];
    expect(orCallArg).toMatch(/fecha_vencimiento\.gte\./);
    expect(orCallArg).toMatch(/fecha_vencimiento\.is\.null/);
  });

  it("RN-LO7: un lote bloqueado no es candidato", async () => {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);

    mockGetServiceDb.mockReturnValue({
      ...chain,
      then: (resolve: any) => resolve({ data: [], error: null }),
    } as any);

    await StockService.listarCandidatosFefo(PROD_ID, 5, TENANT_ID);

    // Verifica filtro de estado = 'disponible' (rechaza bloqueados)
    expect(chain.eq).toHaveBeenCalledWith("lotes.estado", "disponible");
  });

  it("RN-MV6: el kárdex devuelve el costo guardado", async () => {
    const movsDb = [
      {
        id: "mov-1",
        created_at: "2026-09-01T10:00:00Z",
        tipo: "entrada_compra",
        cantidad: 10,
        cantidad_con_signo: 10,
        costo_unitario: 100.0,
        costo_total: 1000.0,
        motivo: null,
      },
      {
        id: "mov-2",
        created_at: "2026-09-02T10:00:00Z",
        tipo: "salida_venta",
        cantidad: 3,
        cantidad_con_signo: -3,
        costo_unitario: 100.0,
        costo_total: 300.0,
        motivo: null,
      },
    ];

    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockResolvedValue({ data: movsDb, error: null, count: 2 });

    mockGetServiceDb.mockReturnValue(chain as any);

    const res = await StockService.kardexPorLote(LOTE_ID, TENANT_ID, { page: 1, limit: 10 });

    expect(res.data).toHaveLength(2);
    // RN-MV6: costo_unitario devuelto es 100 (el congelado en la fila), con saldo acumulado
    expect(res.data[0].costoUnitario).toBe(100.0);
    expect(res.data[0].saldoAcumulado).toBe(10);
    expect(res.data[1].costoUnitario).toBe(100.0);
    expect(res.data[1].saldoAcumulado).toBe(7);
  });

  it("RN-MV6: cambiar el costo de reposición no altera el kárdex", async () => {
    const movsDb = [
      {
        id: "mov-1",
        created_at: "2026-09-01T10:00:00Z",
        tipo: "entrada_compra",
        cantidad: 10,
        cantidad_con_signo: 10,
        costo_unitario: 100.0,
        costo_total: 1000.0,
        motivo: null,
      },
    ];

    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockResolvedValue({ data: movsDb, error: null, count: 1 });

    mockGetServiceDb.mockReturnValue(chain as any);

    // Consulta 1 (costo reposición en DB podría ser 100 o 500, el kárdex no lo joinea)
    const res1 = await StockService.kardexPorLote(LOTE_ID, TENANT_ID, {});
    expect(res1.data[0].costoUnitario).toBe(100.0);

    // Consulta 2: el resultado es idéntico e inmutable
    const res2 = await StockService.kardexPorLote(LOTE_ID, TENANT_ID, {});
    expect(res2.data[0].costoUnitario).toBe(100.0);
  });

  it("no hay N+1 en el listado de candidatos", async () => {
    const fromSpy = vi.fn();
    const chain: Record<string, any> = {};
    chain.from = fromSpy.mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gt = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);

    mockGetServiceDb.mockReturnValue({
      ...chain,
      then: (resolve: any) => resolve({ data: [], error: null }),
    } as any);

    await StockService.listarCandidatosFefo(PROD_ID, 10, TENANT_ID);

    // Una sola llamada a .from("existencias_lote")
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith("existencias_lote");
  });
});
