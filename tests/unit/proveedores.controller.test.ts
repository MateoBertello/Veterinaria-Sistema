import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/proveedores/proveedores.service.ts", () => ({
  ProveedorService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "prov-1", razonSocial: "VetSur S.A." }),
    crear:          vi.fn().mockResolvedValue({ id: "prov-1", razonSocial: "VetSur S.A." }),
    actualizar:     vi.fn().mockResolvedValue({ id: "prov-1", razonSocial: "VetSur S.A." }),
    cambiarEstado:  vi.fn().mockResolvedValue({ id: "prov-1", razonSocial: "VetSur S.A.", activo: false }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { ProveedorService } from "../../supabase/functions/api/src/modules/proveedores/proveedores.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { proveedoresRouter } from "../../supabase/functions/api/src/modules/proveedores/proveedores.controller.ts";
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
const mockCrear = vi.mocked(ProveedorService.crear);
const mockBuscar = vi.mocked(ProveedorService.buscarPaginado);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/proveedores", proveedoresRouter);
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

const dtoValido = {
  razonSocial: "Distribuidora Sur",
  cuit: "30-11111111-1",
};

describe("proveedoresRouter — permisos y aislamiento (RN-SC1, RN-SC7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "stock");
  });

  it("RN-SC1: el tenantId del body se ignora", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_suppliers"]),
    ]);

    const res = await req("POST", "/proveedores", {
      ...dtoValido,
      tenantId: "99999999-9999-4999-8999-999999999999",
    });

    expect(res.status).toBe(201);
    expect(mockCrear).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: "99999999-9999-4999-8999-999999999999" }),
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("RN-SC7: admin tiene acceso a GET /proveedores (200)", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "manage_products", "manage_suppliers"]),
    ]);
    const resGet = await req("GET", "/proveedores");
    expect(resGet.status).toBe(200);
  });

  it("RN-SC7: admin tiene acceso a POST /proveedores (201)", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "manage_products", "manage_suppliers"]),
    ]);
    const resPost = await req("POST", "/proveedores", dtoValido);
    expect(resPost.status).toBe(201);
  });

  it("RN-SC7: veterinario no ve proveedores ni puede crearlos (GET 403, POST 403)", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    // Veterinario: view_stock, view_medical_history, manage_medical_history, view_schedules (no tiene manage_suppliers)
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "view_medical_history", "manage_medical_history"]),
    ]);
    const resGet = await req("GET", "/proveedores");
    expect(resGet.status).toBe(403);

    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "view_medical_history", "manage_medical_history"]),
    ]);
    const resPost = await req("POST", "/proveedores", dtoValido);
    expect(resPost.status).toBe(403);
  });

  it("RN-SC7: recepcionista puede listar y crear proveedores (GET 200, POST 201)", async () => {
    invalidateModuleCache(TENANT_ID, "stock");
    // Recepcionista: view_stock, manage_suppliers, view_schedules
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "manage_suppliers"]),
    ]);
    const resGet = await req("GET", "/proveedores");
    expect(resGet.status).toBe(200);

    invalidateModuleCache(TENANT_ID, "stock");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "manage_suppliers"]),
    ]);
    const resPost = await req("POST", "/proveedores", dtoValido);
    expect(resPost.status).toBe(201);
  });

  it("RN-SC7: sin módulo stock contratado → 403 MODULE_NOT_LICENSED", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(false), // stock no contratado
    ]);
    const resGet = await req("GET", "/proveedores");
    const bodyGet = await resGet.json();
    expect(resGet.status).toBe(403);
    expect(bodyGet.error.code).toBe("MODULE_NOT_LICENSED");

    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(false), // stock no contratado
    ]);
    const resPost = await req("POST", "/proveedores", dtoValido);
    const bodyPost = await resPost.json();
    expect(resPost.status).toBe(403);
    expect(bodyPost.error.code).toBe("MODULE_NOT_LICENSED");
  });
});
