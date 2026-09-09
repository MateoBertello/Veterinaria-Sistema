import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/ajustes/ajustes.service.ts", () => ({
  AjustesService: {
    ajustarExistencia:       vi.fn().mockResolvedValue({ operacionId: "op-1", movimientoId: "mov-1", existenciaFinal: 10 }),
    bloquearLote:            vi.fn().mockResolvedValue({ id: "lote-1", estado: "bloqueado", motivoBloqueo: "Lote observado" }),
    desbloquearLote:         vi.fn().mockResolvedValue({ id: "lote-1", estado: "disponible", motivoBloqueo: "Lote observado" }),
    crearRecuento:           vi.fn().mockResolvedValue({ id: "rec-1", numero: 1, estado: "borrador" }),
    listarRecuentos:         vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
    obtenerRecuento:         vi.fn().mockResolvedValue({ id: "rec-1", estado: "borrador", detalles: [] }),
    guardarDetallesRecuento: vi.fn().mockResolvedValue({ recuentoId: "rec-1", itemsCount: 1 }),
    aplicarRecuento:         vi.fn().mockResolvedValue({ recuentoId: "rec-1", operacionId: "op-1", ajustesGenerados: 1 }),
    eliminarRecuento:        vi.fn().mockResolvedValue({ id: "rec-1", deleted: true }),
    registrarDevolucion:     vi.fn().mockResolvedValue({ devolucionId: "dev-1", operacionId: "op-1", itemsDevueltos: 1, reintegroTotal: 500 }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

import { AjustesService } from "../../supabase/functions/api/src/modules/ajustes/ajustes.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import {
  ajustesRouter,
  lotesAjustesRouter,
  recuentosRouter,
  devolucionesRouter,
} from "../../supabase/functions/api/src/modules/ajustes/ajustes.controller.ts";
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
const mockAjustar = vi.mocked(AjustesService.ajustarExistencia);
const mockBloquear = vi.mocked(AjustesService.bloquearLote);
const mockDesbloquear = vi.mocked(AjustesService.desbloquearLote);
const mockCrearRecuento = vi.mocked(AjustesService.crearRecuento);
const mockListarRecuentos = vi.mocked(AjustesService.listarRecuentos);
const mockObtenerRecuento = vi.mocked(AjustesService.obtenerRecuento);
const mockGuardarDetalles = vi.mocked(AjustesService.guardarDetallesRecuento);
const mockAplicarRecuento = vi.mocked(AjustesService.aplicarRecuento);
const mockEliminarRecuento = vi.mocked(AjustesService.eliminarRecuento);
const mockRegistrarDevolucion = vi.mocked(AjustesService.registrarDevolucion);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/ajustes", ajustesRouter);
  app.route("/lotes", lotesAjustesRouter);
  app.route("/recuentos", recuentosRouter);
  app.route("/devoluciones", devolucionesRouter);
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

describe("Ajustes, Recuentos y Devoluciones Controllers — Permisos y Validación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID);
  });

  describe("POST /ajustes", () => {
    it("con manage_stock y módulo stock: retorna 201", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/ajustes", {
        loteId: "33333333-3333-4333-8333-333333333333",
        tipo: "salida_ajuste",
        cantidad: 2,
        motivo: "Merma en depósito por rotura",
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.operacionId).toBe("op-1");
      expect(mockAjustar).toHaveBeenCalled();
    });

    it("sin permiso manage_stock: retorna 403", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);

      const res = await req("POST", "/ajustes", {
        loteId: "33333333-3333-4333-8333-333333333333",
        tipo: "salida_ajuste",
        cantidad: 2,
        motivo: "Merma en depósito por rotura",
      });

      expect(res.status).toBe(403);
    });

    it("con motivo menor a 10 caracteres: retorna 400 VALIDATION_ERROR", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/ajustes", {
        loteId: "33333333-3333-4333-8333-333333333333",
        tipo: "salida_ajuste",
        cantidad: 2,
        motivo: "corto",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /lotes/:id/bloquear y /desbloquear", () => {
    it("POST /lotes/:id/bloquear con motivo válido: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/lotes/33333333-3333-4333-8333-333333333333/bloquear", {
        motivo: "Lote observado por control de calidad",
      });

      expect(res.status).toBe(200);
      expect(mockBloquear).toHaveBeenCalled();
    });

    it("POST /lotes/:id/desbloquear con motivo válido: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/lotes/33333333-3333-4333-8333-333333333333/desbloquear", {
        motivo: "Lote verificado y aprobado para venta",
      });

      expect(res.status).toBe(200);
      expect(mockDesbloquear).toHaveBeenCalled();
    });
  });

  describe("Recuentos endpoints", () => {
    it("POST /recuentos crea borrador: retorna 201", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/recuentos", { observaciones: "Conteo mensual" });
      expect(res.status).toBe(201);
      expect(mockCrearRecuento).toHaveBeenCalled();
    });

    it("GET /recuentos lista con paginación: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("GET", "/recuentos?page=1&limit=10");
      expect(res.status).toBe(200);
      expect(mockListarRecuentos).toHaveBeenCalled();
    });

    it("GET /recuentos/:id obtiene detalle: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("GET", "/recuentos/44444444-4444-4444-8444-444444444444");
      expect(res.status).toBe(200);
      expect(mockObtenerRecuento).toHaveBeenCalled();
    });

    it("PUT /recuentos/:id/detalles guarda filas: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("PUT", "/recuentos/44444444-4444-4444-8444-444444444444/detalles", {
        items: [{ loteId: "33333333-3333-4333-8333-333333333333", cantidadContada: 10 }],
      });
      expect(res.status).toBe(200);
      expect(mockGuardarDetalles).toHaveBeenCalled();
    });

    it("POST /recuentos/:id/aplicar aplica recuento: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("POST", "/recuentos/44444444-4444-4444-8444-444444444444/aplicar", {
        confirmarDesvios: true,
      });
      expect(res.status).toBe(200);
      expect(mockAplicarRecuento).toHaveBeenCalled();
    });

    it("DELETE /recuentos/:id elimina borrador: retorna 200", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_stock"]),
      ]);

      const res = await req("DELETE", "/recuentos/44444444-4444-4444-8444-444444444444");
      expect(res.status).toBe(200);
      expect(mockEliminarRecuento).toHaveBeenCalled();
    });
  });

  describe("POST /devoluciones", () => {
    it("con manage_sales y módulo ventas: retorna 201", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_sales"]),
      ]);

      const res = await req("POST", "/devoluciones", {
        ventaId: "55555555-5555-4555-8555-555555555555",
        items: [
          {
            ventaItemId: "66666666-6666-4666-8666-666666666666",
            cantidad: 1,
            revendible: true,
          },
        ],
        motivo: "Cliente devuelve producto cerrado",
      });

      expect(res.status).toBe(201);
      expect(mockRegistrarDevolucion).toHaveBeenCalled();
    });

    it("sin permiso manage_sales: retorna 403", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);

      const res = await req("POST", "/devoluciones", {
        ventaId: "55555555-5555-4555-8555-555555555555",
        items: [
          {
            ventaItemId: "66666666-6666-4666-8666-666666666666",
            cantidad: 1,
            revendible: true,
          },
        ],
        motivo: "Cliente devuelve producto cerrado",
      });

      expect(res.status).toBe(403);
    });
  });
});
