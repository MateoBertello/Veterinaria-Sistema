import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/compras/compras.service.ts", () => ({
  ComprasService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "compra-1", estado: "borrador", total: 0 }),
    crear:          vi.fn().mockResolvedValue({ id: "compra-1", estado: "borrador" }),
    actualizar:     vi.fn().mockResolvedValue({ id: "compra-1", estado: "borrador" }),
    agregarItem:    vi.fn().mockResolvedValue({ id: "item-1", cantidad: 10 }),
    actualizarItem: vi.fn().mockResolvedValue({ id: "item-1", cantidad: 20 }),
    quitarItem:     vi.fn().mockResolvedValue({ deleted: true }),
    confirmar:      vi.fn().mockResolvedValue({ compraId: "compra-1", lotesCreados: 1, total: 100 }),
    anular:         vi.fn().mockResolvedValue({ compraId: "compra-1", movimientosGenerados: 1 }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { ComprasService } from "../../supabase/functions/api/src/modules/compras/compras.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { comprasRouter } from "../../supabase/functions/api/src/modules/compras/compras.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { invalidateModuleCache } from "../../supabase/functions/api/src/middleware/requireModule.ts";
import {
  makeJwt,
  mockDbSequence,
  tenantActiveResult,
  moduleEnabledResult,
  permissionResult,
} from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);
const mockConfirmar = vi.mocked(ComprasService.confirmar);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/compras", comprasRouter);
  return app;
}

function req(method: string, path: string, body?: unknown) {
  return buildApp().request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${VALID_JWT}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

describe("comprasRouter — Permisos y Envelopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "stock");
  });

  it("POST /compras/:id/confirmar sin manage_suppliers → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult([]),
    ]);

    const res = await req("POST", "/compras/11111111-1111-4111-8111-111111111111/confirmar");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("POST /compras/:id/confirmar con manage_suppliers → 200 ok()", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_suppliers"]),
    ]);

    const res = await req("POST", "/compras/11111111-1111-4111-8111-111111111111/confirmar");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockConfirmar).toHaveBeenCalled();
  });

  it("POST /compras/:id/anular sin motivo → 400 VALIDATION_ERROR", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_suppliers"]),
    ]);

    const res = await req("POST", "/compras/11111111-1111-4111-8111-111111111111/anular", {
      motivo: "corto",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
