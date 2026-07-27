import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock del Service: el controller solo valida/serializa/delega (no toca DB).
vi.mock("../../supabase/functions/api/src/modules/modulos/modulos.service.ts", () => ({
  ModuloService: {
    setModulo:            vi.fn().mockResolvedValue({ modulo: "turnos", habilitado: false, fechaAlta: null }),
    listarPorTenant:      vi.fn().mockResolvedValue([]),
    habilitadosDelTenant: vi.fn(),
  },
}));

// TenantService no se ejerce aquí; se mockea para evitar su carga de DB/auth.
vi.mock("../../supabase/functions/api/src/modules/admin/tenants.service.ts", () => ({
  TenantService: {},
}));

import { ModuloService } from "../../supabase/functions/api/src/modules/modulos/modulos.service.ts";
import { tenantsRouter } from "../../supabase/functions/api/src/modules/admin/tenants.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt } from "./_helpers/permissionMock.ts";

const mockSetModulo = vi.mocked(ModuloService.setModulo);


const SUPER_ADMIN_JWT = makeJwt({ sub: "sa-1", app_metadata: { platform_role: "super_admin" } });
const NORMAL_JWT      = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/admin/tenants", tenantsRouter);
  return app;
}

function put(jwt: string | null, modulo: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  return buildApp().request(`http://localhost/admin/tenants/${TENANT_ID}/modulos/${modulo}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── Aislamiento ──────────────────────────────────────────────────────────────

describe("Aislamiento: solo super_admin puede togglear", () => {
  it("usuario normal (sin platform_role) → 403 FORBIDDEN", async () => {
    const res  = await put(NORMAL_JWT, "turnos", { habilitado: false });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockSetModulo).not.toHaveBeenCalled();
  });

  it("sin Authorization → 401 UNAUTHORIZED", async () => {
    const res  = await put(null, "turnos", { habilitado: false });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ─── MODULE_UNKNOWN ─────────────────────────────────────────────────────────────

describe("Validación del path param :modulo", () => {
  it("módulo desconocido → 422 MODULE_UNKNOWN", async () => {
    const res  = await put(SUPER_ADMIN_JWT, "inexistente", { habilitado: true });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("MODULE_UNKNOWN");
    expect(mockSetModulo).not.toHaveBeenCalled();
  });

  it("body inválido (sin habilitado) → 422 VALIDATION_ERROR", async () => {
    const res  = await put(SUPER_ADMIN_JWT, "turnos", {});
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockSetModulo).not.toHaveBeenCalled();
  });
});

// ─── Happy path ─────────────────────────────────────────────────────────────────

describe("Toggle válido por super_admin", () => {
  it("PUT válido → 200 y delega en ModuloService.setModulo", async () => {
    const res  = await put(SUPER_ADMIN_JWT, "turnos", { habilitado: false });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSetModulo).toHaveBeenCalledWith(
      TENANT_ID,
      "turnos",
      false,
      expect.objectContaining({ superAdminId: "sa-1" }),
    );
  });
});
