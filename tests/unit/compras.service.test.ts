import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { ComprasService } from "../../supabase/functions/api/src/modules/compras/compras.service.ts";
import { ErrorCode, DomainError } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COMPRA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROV_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ctx = {
  tenantId: TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName: "Admin Commercial",
  callerRole: "admin",
};

describe("ComprasService — RN-CM2: una compra confirmada no se edita", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockCompraEstado(estado: "borrador" | "confirmada" | "anulada") {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: COMPRA_ID, estado, tenant_id: TENANT_ID },
      error: null,
    });
    chain.single = vi.fn().mockResolvedValue({
      data: { id: COMPRA_ID, estado, tenant_id: TENANT_ID },
      error: null,
    });
    mockGetServiceDb.mockReturnValue(chain as any);
    return chain;
  }

  it("RN-CM2: actualizar datos de compra confirmada lanza PURCHASE_ALREADY_CONFIRMED", async () => {
    mockCompraEstado("confirmada");

    await expect(
      ComprasService.actualizar(COMPRA_ID, { observaciones: "Nueva nota" }, ctx),
    ).rejects.toMatchObject({
      code: ErrorCode.PURCHASE_ALREADY_CONFIRMED,
      statusCode: 409,
    });
  });

  it("RN-CM2: agregarItem sobre compra confirmada lanza PURCHASE_ALREADY_CONFIRMED", async () => {
    mockCompraEstado("confirmada");

    await expect(
      ComprasService.agregarItem(
        COMPRA_ID,
        {
          productoId: PROD_ID,
          cantidad: 5,
          costoUnitarioNeto: 100,
          alicuotaIva: 21,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PURCHASE_ALREADY_CONFIRMED,
      statusCode: 409,
    });
  });

  it("RN-CM2: actualizarItem sobre compra confirmada lanza PURCHASE_ALREADY_CONFIRMED", async () => {
    mockCompraEstado("confirmada");

    await expect(
      ComprasService.actualizarItem(
        COMPRA_ID,
        ITEM_ID,
        {
          cantidad: 10,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PURCHASE_ALREADY_CONFIRMED,
      statusCode: 409,
    });
  });

  it("RN-CM2: quitarItem sobre compra confirmada lanza PURCHASE_ALREADY_CONFIRMED", async () => {
    mockCompraEstado("confirmada");

    await expect(ComprasService.quitarItem(COMPRA_ID, ITEM_ID, ctx)).rejects.toMatchObject({
      code: ErrorCode.PURCHASE_ALREADY_CONFIRMED,
      statusCode: 409,
    });
  });
});
