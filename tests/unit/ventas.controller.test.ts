import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../supabase/functions/api/src/modules/ventas/ventas.service.ts", () => ({
  VentaService: {
    buscarPaginado:    vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    obtenerPorId:      vi.fn().mockResolvedValue({ id: "venta-1", estado: "registrada", total: 100 }),
    registrar:         vi.fn().mockResolvedValue({ ventaId: "venta-1", total: 1000 }),
    anular:            vi.fn().mockResolvedValue({ ventaId: "venta-1", estado: "anulada" }),
    margenPorProducto: vi.fn().mockResolvedValue([]),
    itemsVendidos:     vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

import { VentaService } from "../../supabase/functions/api/src/modules/ventas/ventas.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { ventasRouter } from "../../supabase/functions/api/src/modules/ventas/ventas.controller.ts";
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
const mockRegistrar = vi.mocked(VentaService.registrar);
const mockAnular = vi.mocked(VentaService.anular);
const mockMargen = vi.mocked(VentaService.margenPorProducto);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/ventas", ventasRouter);
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

const SESION_ID = "22222222-2222-4222-8222-222222222222";
const PROD_ID = "33333333-3333-4333-8333-333333333333";
const MP_ID = "44444444-4444-4444-8444-444444444444";

const VENTA_PAYLOAD = {
  sesionCajaId: SESION_ID,
  condicionPago: "contado",
  items: [
    {
      tipoItem: "producto",
      productoId: PROD_ID,
      cantidad: 1,
      precioUnitario: 1000,
    },
  ],
  pagos: [
    {
      medioPagoId: MP_ID,
      importe: 1000,
    },
  ],
};

describe("ventasRouter — Matriz de Permisos y Roles (RN-SC7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "ventas");
  });

  // ─── 1. Sin módulo ventas licenciado → 403 MODULE_NOT_LICENSED ─────────────
  it("Cualquier endpoint sin módulo ventas habilitado → 403 MODULE_NOT_LICENSED", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(false), // Módulo ventas no contratado
    ]);

    const res = await req("GET", "/ventas");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("MODULE_NOT_LICENSED");
  });

  // ─── 2. GET /ventas ────────────────────────────────────────────────────────
  it.each([
    ["admin", ["manage_sales", "view_sales", "void_sales"]],
    ["veterinario", ["manage_sales"]],
    ["recepcionista", ["manage_sales"]],
  ])("GET /ventas con rol %s → 200 ok", async (rol, permisos) => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(permisos),
    ]);

    const res = await req("GET", "/ventas");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // ─── 3. POST /ventas ───────────────────────────────────────────────────────
  it.each([
    ["admin", ["manage_sales", "view_sales", "void_sales"]],
    ["veterinario", ["manage_sales"]],
    ["recepcionista", ["manage_sales"]],
  ])("POST /ventas con rol %s → 201 ok", async (rol, permisos) => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(permisos),
    ]);

    const res = await req("POST", "/ventas", VENTA_PAYLOAD);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRegistrar).toHaveBeenCalled();
  });

  // ─── 4. POST /ventas/:id/anular (exige void_sales, solo admin) ────────────
  it("POST /ventas/:id/anular con admin (void_sales) → 200 ok", async () => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_sales", "void_sales"]), // 1er check (manage_sales)
      permissionResult(["manage_sales", "void_sales"]), // 2do check (void_sales)
    ]);

    const res = await req("POST", "/ventas/11111111-1111-4111-8111-111111111111/anular", {
      sesionCajaId: SESION_ID,
      motivo: "Anulación por error de facturación solicitada por cliente",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockAnular).toHaveBeenCalled();
  });

  it.each([
    ["veterinario", ["manage_sales"]],
    ["recepcionista", ["manage_sales"]],
  ])("POST /ventas/:id/anular con rol %s (sin void_sales) → 403 FORBIDDEN", async (rol, permisos) => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(permisos), // 1er check (manage_sales -> pasa)
      permissionResult(permisos), // 2do check (void_sales -> rechaza con 403)
    ]);

    const res = await req("POST", "/ventas/11111111-1111-4111-8111-111111111111/anular", {
      sesionCajaId: SESION_ID,
      motivo: "Anulación por error de facturación solicitada por cliente",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // ─── 5. GET /ventas/reportes/margen (exige view_sales) ─────────────────────
  it("GET /ventas/reportes/margen con admin (view_sales) → 200 ok", async () => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_sales", "view_sales"]), // 1er check (manage_sales)
      permissionResult(["manage_sales", "view_sales"]), // 2do check (view_sales)
    ]);

    const res = await req("GET", "/ventas/reportes/margen");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockMargen).toHaveBeenCalled();
  });

  it.each([
    ["veterinario", ["manage_sales"]],
    ["recepcionista", ["manage_sales"]],
  ])("GET /ventas/reportes/margen con rol %s (sin view_sales) → 403 FORBIDDEN", async (rol, permisos) => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(permisos), // 1er check (manage_sales -> pasa)
      permissionResult(permisos), // 2do check (view_sales -> rechaza con 403)
    ]);

    const res = await req("GET", "/ventas/reportes/margen");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // ─── 6. RN-SC1: el tenantId del body se ignora ────────────────────────────
  it("RN-SC1: el tenantId del body se ignora y el context usa el del token", async () => {
    invalidateModuleCache(TENANT_ID, "ventas");
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      moduleEnabledResult(true),
      permissionResult(["manage_sales"]),
    ]);

    const bodyConHackerTenant = {
      ...VENTA_PAYLOAD,
      tenantId: "hacker-tenant-9999",
      tenant_id: "hacker-tenant-9999",
    };

    const res = await req("POST", "/ventas", bodyConHackerTenant);
    expect(res.status).toBe(201);

    expect(mockRegistrar).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: "hacker-tenant-9999" }),
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  // ─── 7. Inmutabilidad estructural: sin PUT, PATCH ni DELETE ──────────────
  it("Inmutabilidad: ventas.controller.ts no contiene rutas PUT, PATCH ni DELETE", () => {
    const controllerPath = join(
      process.cwd(),
      "supabase/functions/api/src/modules/ventas/ventas.controller.ts"
    );
    const content = readFileSync(controllerPath, "utf-8");
    expect(content).not.toMatch(/\.(put|patch|delete)\(/i);
  });
});
