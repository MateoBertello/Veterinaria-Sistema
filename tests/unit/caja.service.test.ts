import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { CajaService } from "../../supabase/functions/api/src/modules/caja/caja.service.ts";
import { ErrorCode, DomainError } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit = vi.mocked(recordAudit);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CAJA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MP_TRANSFERENCIA_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MP_EFECTIVO_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ctx = {
  tenantId: TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName: "Admin Caja",
  callerRole: "admin",
};

describe("CajaService — Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockDb() {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.lte = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockGetServiceDb.mockReturnValue(chain as any);
    return chain;
  }

  it("RN-CJ9: la referencia obligatoria se valida antes de llamar al RPC", async () => {
    const db = createMockDb();
    // Mock medio de pago que requiere referencia
    db.maybeSingle.mockResolvedValueOnce({
      data: { id: MP_TRANSFERENCIA_ID, activo: true, requiere_referencia: true },
      error: null,
    });

    await expect(
      CajaService.registrarMovimiento(
        SESION_ID,
        {
          tipo: "ingreso_venta",
          medioPagoId: MP_TRANSFERENCIA_ID,
          importe: 1000,
          referencia: "",
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_REFERENCE_REQUIRED,
      statusCode: 422,
    });

    // El RPC no se llamó
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("RN-CJ5: los errores del RPC se traducen a DomainError", async () => {
    const db = createMockDb();
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CASH_SESSION_CLOSED" },
    });

    await expect(
      CajaService.cerrarSesion(
        SESION_ID,
        { efectivoContado: 500 },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CASH_SESSION_CLOSED,
      statusCode: 409,
    });
  });

  it("un error desconocido del RPC no filtra el mensaje interno", async () => {
    const db = createMockDb();
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "idx_secreto"' },
    });

    await expect(
      CajaService.cerrarSesion(
        SESION_ID,
        { efectivoContado: 500 },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: 500,
    });

    try {
      await CajaService.cerrarSesion(SESION_ID, { efectivoContado: 500 }, ctx);
    } catch (err: any) {
      expect(err.message).not.toContain("idx_secreto");
    }
  });

  it("el tenantId siempre sale del contexto", async () => {
    const db = createMockDb();

    // 1. abrirSesion
    db.rpc.mockResolvedValueOnce({
      data: [{ sesion_id: SESION_ID, caja_id: CAJA_ID, apertura_at: new Date().toISOString(), saldo_inicial: 1000 }],
      error: null,
    });
    await CajaService.abrirSesion({ cajaId: CAJA_ID, saldoInicial: 1000 }, ctx);
    expect(db.rpc).toHaveBeenLastCalledWith("abrir_sesion_caja", expect.objectContaining({
      p_tenant_id: TENANT_ID,
    }));

    // 2. registrarMovimiento
    db.maybeSingle.mockResolvedValueOnce({
      data: { id: MP_EFECTIVO_ID, activo: true, requiere_referencia: false },
      error: null,
    });
    db.rpc.mockResolvedValueOnce({
      data: [{ movimiento_id: "mov-123", sesion_id: SESION_ID }],
      error: null,
    });
    await CajaService.registrarMovimiento(SESION_ID, {
      tipo: "ingreso_venta",
      medioPagoId: MP_EFECTIVO_ID,
      importe: 500,
    }, ctx);
    expect(db.rpc).toHaveBeenLastCalledWith("registrar_movimiento_caja", expect.objectContaining({
      p_tenant_id: TENANT_ID,
    }));

    // 3. cerrarSesion
    db.rpc.mockResolvedValueOnce({
      data: [{ sesion_id: SESION_ID, saldo_teorico_efectivo: 1500, efectivo_contado: 1500, diferencia: 0 }],
      error: null,
    });
    await CajaService.cerrarSesion(SESION_ID, { efectivoContado: 1500 }, ctx);
    expect(db.rpc).toHaveBeenLastCalledWith("cerrar_sesion_caja", expect.objectContaining({
      p_tenant_id: TENANT_ID,
    }));
  });

  it("asegurarCajaPrincipal es idempotente", async () => {
    const db = createMockDb();

    // 1. Con una caja existente -> no llama a insert ni a recordAudit
    db.maybeSingle.mockResolvedValueOnce({
      data: { id: CAJA_ID, tenant_id: TENANT_ID, nombre: "Caja principal", activa: true, created_at: new Date().toISOString() },
      error: null,
    });
    const resExistente = await CajaService.asegurarCajaPrincipal(ctx);
    expect(resExistente.id).toBe(CAJA_ID);
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();

    // 2. Sin caja existente -> llama a insert y a recordAudit
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    db.single.mockResolvedValueOnce({
      data: { id: "caja-creada-id", tenant_id: TENANT_ID, nombre: "Caja principal", activa: true, created_at: new Date().toISOString() },
      error: null,
    });

    const resNueva = await CajaService.asegurarCajaPrincipal(ctx);
    expect(resNueva.id).toBe("caja-creada-id");
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: TENANT_ID,
      nombre: "Caja principal",
      activa: true,
    }));
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "CREATE",
        module: "cash_register",
        entityId: "caja-creada-id",
      }),
    );
  });

  it("no hay N+1 en el resumen de sesión", async () => {
    const chainSesion: any = {};
    chainSesion.eq = vi.fn().mockReturnValue(chainSesion);
    chainSesion.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: SESION_ID,
        estado: "abierta",
        saldo_inicial: 1000,
        saldo_teorico_efectivo: null,
        efectivo_contado: null,
        diferencia: null,
      },
      error: null,
    });

    const chainMovs: any = {};
    chainMovs.eq = vi.fn().mockImplementation((col: string) => {
      if (col === "tenant_id") {
        return Promise.resolve({
          data: [
            { tipo: "ingreso_venta", importe: 500, medio_pago: { id: "mp-1", codigo: "efectivo", nombre: "Efectivo", afecta_arqueo: true } },
            { tipo: "ingreso_venta", importe: 300, medio_pago: { id: "mp-2", codigo: "transferencia", nombre: "Transferencia", afecta_arqueo: false } },
            { tipo: "egreso_retiro", importe: 100, medio_pago: { id: "mp-1", codigo: "efectivo", nombre: "Efectivo", afecta_arqueo: true } },
          ],
          error: null,
        });
      }
      return chainMovs;
    });

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        return { select: vi.fn().mockReturnValue(chainSesion) };
      }
      if (table === "movimientos_caja") {
        return { select: vi.fn().mockReturnValue(chainMovs) };
      }
      return {};
    });

    mockGetServiceDb.mockReturnValue({ from: mockFrom } as any);

    const resumen = await CajaService.resumenSesion(SESION_ID, TENANT_ID);
    expect(resumen.sesionId).toBe(SESION_ID);
    expect(mockFrom).toHaveBeenCalledTimes(2); // 1 for sesiones_caja, 1 for movimientos_caja
    expect(mockFrom).toHaveBeenNthCalledWith(1, "sesiones_caja");
    expect(mockFrom).toHaveBeenNthCalledWith(2, "movimientos_caja");
    expect(resumen.totalesPorMedioPago).toHaveLength(2);
  });

  it("RN-CJ3: una venta en cuenta corriente no altera el arqueo", async () => {
    const chainSesion: any = {};
    chainSesion.eq = vi.fn().mockReturnValue(chainSesion);
    chainSesion.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: SESION_ID,
        estado: "abierta",
        saldo_inicial: 1000,
        saldo_teorico_efectivo: null,
        efectivo_contado: null,
        diferencia: null,
      },
      error: null,
    });

    const chainMovs: any = {};
    chainMovs.eq = vi.fn().mockImplementation((col: string) => {
      if (col === "tenant_id") {
        return Promise.resolve({
          data: [
            {
              tipo: "ingreso_venta",
              importe: 5000,
              medio_pago: { id: "mp-cc", codigo: "cuenta_corriente", nombre: "Cuenta Corriente", afecta_arqueo: false },
            },
          ],
          error: null,
        });
      }
      return chainMovs;
    });

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        return { select: vi.fn().mockReturnValue(chainSesion) };
      }
      if (table === "movimientos_caja") {
        return { select: vi.fn().mockReturnValue(chainMovs) };
      }
      return {};
    });

    mockGetServiceDb.mockReturnValue({ from: mockFrom } as any);

    const resumen = await CajaService.resumenSesion(SESION_ID, TENANT_ID);
    expect(resumen.saldoInicial).toBe(1000);
    expect(resumen.saldoTeoricoEfectivo).toBe(1000);
  });
});
