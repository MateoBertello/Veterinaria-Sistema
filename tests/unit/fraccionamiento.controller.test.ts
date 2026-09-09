import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.service.ts", () => ({
  FraccionamientoService: {
    fraccionar:          vi.fn().mockResolvedValue({
      operacionId:       "11111111-1111-4111-8111-111111111111",
      loteDestinoId:     "22222222-2222-4222-8222-222222222222",
      cantidadTeorica:   15,
      cantidadObtenida:  14.2,
      desvioPorcentaje:  5.33,
      costoUnitarioHijo: 3169.0141,
      mermaRegistrada:   0.8,
    }),
    sugerirVencimiento:  vi.fn().mockResolvedValue({
      vencimientoSugerido: "2026-11-05",
    }),
    listarHistorial:     vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

import { FraccionamientoService } from "../../supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { fraccionamientoRouter } from "../../supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.controller.ts";
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
const mockFraccionar = vi.mocked(FraccionamientoService.fraccionar);
const mockSugerir = vi.mocked(FraccionamientoService.sugerirVencimiento);
const mockListar = vi.mocked(FraccionamientoService.listarHistorial);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/fraccionamiento", fraccionamientoRouter);
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

describe("fraccionamientoRouter — permisos y endpoints (C6·T4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID);
  });

  describe("POST /fraccionamiento", () => {
    const payload = {
      loteOrigenId:      "33333333-3333-4333-8333-333333333333",
      productoDestinoId: "44444444-4444-4444-8444-444444444444",
      cantidadOrigen:    1,
      cantidadObtenida:  14.2,
      codigoLoteDestino: "LOTE-HIJO-001",
    };

    it("sin split_stock → 403 FORBIDDEN", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);

      const res = await req("POST", "/fraccionamiento", payload);

      expect(res.status).toBe(403);
      expect(mockFraccionar).not.toHaveBeenCalled();
    });

    it("con split_stock → 201 CREATED", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["split_stock"]),
      ]);

      const res = await req("POST", "/fraccionamiento", payload);

      expect(res.status).toBe(201);
      expect(mockFraccionar).toHaveBeenCalled();
    });
  });

  describe("GET /fraccionamiento/sugerir-vencimiento", () => {
    it("sin view_stock → 403 FORBIDDEN", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);

      const res = await req(
        "GET",
        "/fraccionamiento/sugerir-vencimiento?loteOrigenId=33333333-3333-4333-8333-333333333333&productoDestinoId=44444444-4444-4444-8444-444444444444",
      );

      expect(res.status).toBe(403);
      expect(mockSugerir).not.toHaveBeenCalled();
    });

    it("con view_stock → 200 OK", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["view_stock"]),
      ]);

      const res = await req(
        "GET",
        "/fraccionamiento/sugerir-vencimiento?loteOrigenId=33333333-3333-4333-8333-333333333333&productoDestinoId=44444444-4444-4444-8444-444444444444",
      );

      expect(res.status).toBe(200);
      expect(mockSugerir).toHaveBeenCalled();
    });
  });

  describe("GET /fraccionamiento/historial", () => {
    it("sin view_stock → 403 FORBIDDEN", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);

      const res = await req("GET", "/fraccionamiento/historial");

      expect(res.status).toBe(403);
      expect(mockListar).not.toHaveBeenCalled();
    });

    it("con view_stock → 200 OK", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["view_stock"]),
      ]);

      const res = await req("GET", "/fraccionamiento/historial");

      expect(res.status).toBe(200);
      expect(mockListar).toHaveBeenCalled();
    });
  });
});
