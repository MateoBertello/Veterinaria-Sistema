import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/historial/historial.service.ts", () => ({
  HistorialService: {
    crearRegistro:        vi.fn().mockResolvedValue({ id: "ev1" }),
    exportarHistorial:    vi.fn().mockResolvedValue({
      buffer:      new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      filename:    "historial.pdf",
    }),
    obtenerEventoPorId:   vi.fn().mockResolvedValue({ id: "ev1" }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { HistorialService } from "../../supabase/functions/api/src/modules/historial/historial.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { historialMascotaRouter, historialRouter } from "../../supabase/functions/api/src/modules/historial/historial.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { invalidateModuleCache } from "../../supabase/functions/api/src/middleware/requireModule.ts";
import {
  makeJwt,
  mockDbSequence,
  tenantActiveResult,
  moduleEnabledResult,
  permissionResult,
} from "./_helpers/permissionMock.ts";

const mockGetDb             = vi.mocked(getDb);
const mockCrearRegistro     = vi.mocked(HistorialService.crearRegistro);
const mockExportar          = vi.mocked(HistorialService.exportarHistorial);
const mockObtenerPorId      = vi.mocked(HistorialService.obtenerEventoPorId);

const TENANT_ID = "tenant-1";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });
const PET_ID    = "22222222-2222-4222-8222-222222222222";

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/mascotas", historialMascotaRouter);
  return app;
}

function req(method: string, path: string, body?: unknown) {
  return buildApp().request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${VALID_JWT}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function buildAppHistorial() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/historial", historialRouter);
  return app;
}

function reqHistorial(method: string, path: string) {
  return buildAppHistorial().request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

const eventoValido = {
  date:           "2026-01-01",
  eventType:      "Consulta",
  professionalId: "33333333-3333-4333-8333-333333333333",
  description:    "Control de rutina",
};

describe("historialMascotaRouter — permisos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "historial_clinico");
  });

  it("RN-EC7: crear evento clínico con view_medical_history pero sin manage_medical_history → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_medical_history"]), // sharedMiddleware: pasa
      permissionResult(["view_medical_history"]), // manageMedicalHistory: falla
    ]);
    const res  = await req("POST", `/mascotas/${PET_ID}/historial`, eventoValido);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCrearRegistro).not.toHaveBeenCalled();
  });

  it("RN-EC7: crear evento clínico con manage_medical_history → 201", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_medical_history"]),
      permissionResult(["view_medical_history", "manage_medical_history"]),
    ]);
    const res = await req("POST", `/mascotas/${PET_ID}/historial`, eventoValido);

    expect(res.status).toBe(201);
    expect(mockCrearRegistro).toHaveBeenCalled();
  });

  it("RN-EX5: exportar historial sin view_medical_history → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_clients"]),
    ]);
    const res  = await req("GET", `/mascotas/${PET_ID}/historial/export`);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockExportar).not.toHaveBeenCalled();
  });

  it("RN-EX5: exportar historial con view_medical_history alcanza, sin manage_medical_history → 200 (no exige el permiso de gestión)", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_medical_history"]),
    ]);
    const res = await req("GET", `/mascotas/${PET_ID}/historial/export`);

    expect(res.status).toBe(200);
    expect(mockExportar).toHaveBeenCalled();
  });
});

describe("historialRouter — GET /:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "historial_clinico");
  });

  it("id malformado → 422 VALIDATION_ERROR (no 500), y no llega al Service", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_medical_history"]),
    ]);
    const res  = await reqHistorial("GET", "/historial/no-es-un-uuid");
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockObtenerPorId).not.toHaveBeenCalled();
  });

  it("id con formato UUID válido → 200, delega en el Service", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_medical_history"]),
    ]);
    const eventoId = "44444444-4444-4444-8444-444444444444";
    const res = await reqHistorial("GET", `/historial/${eventoId}`);

    expect(res.status).toBe(200);
    expect(mockObtenerPorId).toHaveBeenCalledWith(eventoId, TENANT_ID);
  });
});
