import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/caja/caja.service.ts", () => ({
  CajaService: {
    listarCajas:         vi.fn().mockResolvedValue([{ id: "caja-1", nombre: "Caja principal", activa: true }]),
    listarSesiones:      vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    sesionAbierta:       vi.fn().mockResolvedValue({ id: "sesion-1", estado: "abierta" }),
    obtenerSesion:       vi.fn().mockResolvedValue({ id: "sesion-1", estado: "abierta", movimientos: [] }),
    resumenSesion:       vi.fn().mockResolvedValue({ sesionId: "sesion-1", saldoInicial: 1000, totalesPorMedioPago: [] }),
    abrirSesion:         vi.fn().mockResolvedValue({ id: "sesion-1", cajaId: "caja-1", saldoInicial: 1000 }),
    registrarMovimiento: vi.fn().mockResolvedValue({ id: "mov-1", sesionCajaId: "sesion-1" }),
    cerrarSesion:        vi.fn().mockResolvedValue({ id: "sesion-1", saldoTeoricoEfectivo: 1000, efectivoContado: 1000, diferencia: 0 }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { CajaService } from "../../supabase/functions/api/src/modules/caja/caja.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { cajaRouter } from "../../supabase/functions/api/src/modules/caja/caja.controller.ts";
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
const mockAbrirSesion = vi.mocked(CajaService.abrirSesion);
const mockRegistrarMovimiento = vi.mocked(CajaService.registrarMovimiento);
const mockCerrarSesion = vi.mocked(CajaService.cerrarSesion);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/caja", cajaRouter);
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

describe("cajaRouter — Matriz Rol × Endpoint y Validaciones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "ventas");
  });

  // ─── Matriz Rol × Endpoint ───────────────────────────────────────────

  describe("Matriz Rol × Endpoint", () => {
    it("GET /caja/sesiones/actual — admin (200)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_cash"]),
      ]);
      const res = await req("GET", "/caja/sesiones/actual");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("GET /caja/sesiones/actual — veterinario sin manage_cash (403 FORBIDDEN)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_patients", "view_medical_records"]),
      ]);
      const res = await req("GET", "/caja/sesiones/actual");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("GET /caja/sesiones/actual — recepcionista con manage_cash (200)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_cash", "manage_appointments"]),
      ]);
      const res = await req("GET", "/caja/sesiones/actual");
      expect(res.status).toBe(200);
    });

    it("GET /caja/sesiones/actual — sin módulo ventas (403 MODULE_NOT_LICENSED)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(false),
      ]);
      const res = await req("GET", "/caja/sesiones/actual");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("MODULE_NOT_LICENSED");
    });

    it("POST /caja/sesiones — abrir sesión: admin (201)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_cash"]),
      ]);
      const res = await req("POST", "/caja/sesiones", { saldoInicial: 1000 });
      expect(res.status).toBe(201);
    });

    it("POST /caja/sesiones — abrir sesión: veterinario (403 FORBIDDEN)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult([]),
      ]);
      const res = await req("POST", "/caja/sesiones", { saldoInicial: 1000 });
      expect(res.status).toBe(403);
    });

    it("POST /caja/sesiones/:id/movimientos — registrar movimiento: recepcionista (201)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_cash"]),
      ]);
      const res = await req("POST", "/caja/sesiones/11111111-1111-4111-8111-111111111111/movimientos", {
        tipo: "ingreso_venta",
        medioPagoId: "22222222-2222-4222-8222-222222222222",
        importe: 500,
      });
      expect(res.status).toBe(201);
    });

    it("POST /caja/sesiones/:id/cerrar — cerrar sesión: admin (200)", async () => {
      mockDbSequence(mockGetDb, [
        tenantActiveResult(),
        moduleEnabledResult(true),
        permissionResult(["manage_cash"]),
      ]);
      const res = await req("POST", "/caja/sesiones/11111111-1111-4111-8111-111111111111/cerrar", {
        efectivoContado: 1000,
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── RN-SC1: Aislamiento por Tenant en Controller ────────────────────

  it("RN-SC1: el tenantId del body se ignora en POST /caja/sesiones", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_cash"]),
    ]);

    const res = await req("POST", "/caja/sesiones", {
      saldoInicial: 500,
      tenantId: "00000000-0000-0000-0000-000000000000",
    });

    expect(res.status).toBe(201);
    expect(mockAbrirSesion).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: "00000000-0000-0000-0000-000000000000" }),
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  // ─── RN-CJ5: Inmutabilidad estructural del router ────────────────────

  it("no existe ninguna ruta que edite una sesión o un movimiento", () => {
    const rutasMutables = cajaRouter.routes.filter((r) =>
      ["PUT", "PATCH", "DELETE"].includes(r.method.toUpperCase())
    );
    expect(rutasMutables).toHaveLength(0);
  });
});
