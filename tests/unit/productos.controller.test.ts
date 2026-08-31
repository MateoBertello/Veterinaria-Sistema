import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/productos/productos.service.ts", () => ({
  ProductoService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "prod-1", codigo: "SKU-1", nombre: "Prod 1" }),
    crear:          vi.fn().mockResolvedValue({ id: "prod-1", codigo: "SKU-1", nombre: "Prod 1" }),
    actualizar:     vi.fn().mockResolvedValue({ id: "prod-1", codigo: "SKU-1", nombre: "Prod 1" }),
    cambiarEstado:  vi.fn().mockResolvedValue({ id: "prod-1", codigo: "SKU-1", nombre: "Prod 1", activo: false }),
  },
  FamiliaService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "fam-1", nombre: "Fam 1" }),
    crear:          vi.fn().mockResolvedValue({ id: "fam-1", nombre: "Fam 1" }),
    actualizar:     vi.fn().mockResolvedValue({ id: "fam-1", nombre: "Fam 1" }),
    cambiarEstado:  vi.fn().mockResolvedValue({ id: "fam-1", nombre: "Fam 1", activo: false }),
  },
  ConversionService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "conv-1", factorTeorico: 10 }),
    crear:          vi.fn().mockResolvedValue({ id: "conv-1", factorTeorico: 10 }),
    actualizar:     vi.fn().mockResolvedValue({ id: "conv-1", factorTeorico: 10 }),
    cambiarEstado:  vi.fn().mockResolvedValue({ id: "conv-1", factorTeorico: 10, activo: false }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { ProductoService } from "../../supabase/functions/api/src/modules/productos/productos.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import {
  productosRouter,
  familiasRouter,
  conversionesRouter,
} from "../../supabase/functions/api/src/modules/productos/productos.controller.ts";
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
const mockCrear = vi.mocked(ProductoService.crear);
const mockBuscar = vi.mocked(ProductoService.buscarPaginado);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/productos", productosRouter);
  app.route("/familias-producto", familiasRouter);
  app.route("/producto-conversiones", conversionesRouter);
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
  codigo: "SKU-TEST-1",
  nombre: "Alimento Test 15kg",
  unidadMedidaId: "22222222-2222-4222-8222-222222222222",
  alicuotaIva: 21,
  precioVenta: 1000,
  esVendible: true,
};

describe("productosRouter — permisos y aislamiento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "stock");
  });

  it("RN-SC1: el tenantId del body se ignora", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock", "manage_products"]),
      permissionResult(["view_stock", "manage_products"]),
    ]);

    const res = await req("POST", "/productos", {
      ...dtoValido,
      tenantId: "99999999-9999-4999-8999-999999999999", // intento de inyectar tenant ajeno
    });

    expect(res.status).toBe(201);
    expect(mockCrear).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: "99999999-9999-4999-8999-999999999999" }),
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("RN-SC7: las lecturas exigen view_stock", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_clients"]), // no tiene view_stock
    ]);

    const res = await req("GET", "/productos");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockBuscar).not.toHaveBeenCalled();
  });

  it("RN-SC7: las escrituras exigen manage_products", async () => {
    // 1. Con view_stock pero sin manage_products: GET 200, POST 403
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock"]),
    ]);
    const resGet = await req("GET", "/productos");
    expect(resGet.status).toBe(200);

    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["view_stock"]),
      permissionResult(["view_stock"]), // falta manage_products
    ]);
    const resPost = await req("POST", "/productos", dtoValido);
    const bodyPost = await resPost.json();
    expect(resPost.status).toBe(403);
    expect(bodyPost.error.code).toBe("FORBIDDEN");
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("RN-SC7: sin el módulo stock contratado, 403 MODULE_NOT_LICENSED", async () => {
    // GET sin módulo
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(false), // stock no contratado
    ]);
    const resGet = await req("GET", "/productos");
    const bodyGet = await resGet.json();
    expect(resGet.status).toBe(403);
    expect(bodyGet.error.code).toBe("MODULE_NOT_LICENSED");

    // POST sin módulo
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(false), // stock no contratado
    ]);
    const resPost = await req("POST", "/productos", dtoValido);
    const bodyPost = await resPost.json();
    expect(resPost.status).toBe(403);
    expect(bodyPost.error.code).toBe("MODULE_NOT_LICENSED");
  });
});
