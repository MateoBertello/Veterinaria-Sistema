/**
 * Tests unitarios del controller de Dashboard (Etapa 12A).
 *
 * El controller solo resuelve auth/contexto, delega y serializa: acá se verifica
 * el envelope, la cadena de middlewares (JWT + tenant activo) y —sobre todo— la
 * regla 1: el tenant_id SIEMPRE sale del JWT, nunca del request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/modules/dashboard/dashboard.service.ts", () => ({
  DashboardService: { resumen: vi.fn() },
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { DashboardService } from "../../supabase/functions/api/src/modules/dashboard/dashboard.service.ts";
import { dashboardRouter } from "../../supabase/functions/api/src/modules/dashboard/dashboard.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, mockDbSequence, tenantActiveResult } from "./_helpers/permissionMock.ts";

const mockGetDb   = vi.mocked(getDb);
const mockResumen = vi.mocked(DashboardService.resumen);

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTRO_TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID   = "user-1";

const JWT        = makeJwt({ sub: USER_ID, app_metadata: { tenant_id: TENANT_ID } });
const JWT_SIN_TENANT = makeJwt({ sub: USER_ID, app_metadata: {} });

const RESUMEN = {
  fecha:              "2026-07-25",
  clientes:           12,
  mascotasActivas:    30,
  turnosHoy:          4,
  estadiasHoy:        2,
  vacunasProximas30d: 7,
};

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/dashboard", dashboardRouter);
  return app;
}

function get(jwt: string | null, query = "") {
  const headers: Record<string, string> = {};
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  return buildApp().request(`http://localhost/dashboard/resumen${query}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResumen.mockResolvedValue(RESUMEN);
  mockDbSequence(mockGetDb, [tenantActiveResult(true)]);
});

describe("GET /dashboard/resumen — envelope y contexto", () => {
  it("responde 200 con el envelope estándar y sin meta (no es un listado)", async () => {
    const res  = await get(JWT);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(RESUMEN);
    expect(body.meta).toBeUndefined();
  });

  it("pasa al Service el tenantId y el userId del JWT", async () => {
    await get(JWT);

    expect(mockResumen).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, callerUserId: USER_ID }),
    );
  });

  it("propaga el Authorization header para que el Service lea con RLS activa", async () => {
    await get(JWT);

    expect(mockResumen).toHaveBeenCalledWith(
      expect.objectContaining({ authHeader: `Bearer ${JWT}` }),
    );
  });
});

describe("regla 1: el tenant_id nunca viene del request", () => {
  it("ignora un tenant_id en el query string y usa el del JWT", async () => {
    await get(JWT, `?tenant_id=${OTRO_TENANT}&tenantId=${OTRO_TENANT}`);

    expect(mockResumen).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });
});

describe("cadena de middlewares", () => {
  it("sin Authorization → 401 UNAUTHORIZED y el Service no se ejecuta", async () => {
    const res  = await get(null);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockResumen).not.toHaveBeenCalled();
  });

  it("JWT sin tenant_id → 401 UNAUTHORIZED", async () => {
    const res  = await get(JWT_SIN_TENANT);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockResumen).not.toHaveBeenCalled();
  });

  it("RN-SA3: tenant suspendido → 403 TENANT_SUSPENDED y el Service no se ejecuta", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(false)]);

    const res  = await get(JWT);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("TENANT_SUSPENDED");
    expect(mockResumen).not.toHaveBeenCalled();
  });

  it("cualquier usuario autenticado del tenant puede pedir el resumen (el gate es por métrica)", async () => {
    // Sin requirePermission en la ruta: no hay consulta de permisos en la cadena
    // del controller; el filtrado ocurre dentro del Service.
    mockResumen.mockResolvedValue({ ...RESUMEN, turnosHoy: null, estadiasHoy: null });

    const res  = await get(JWT);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.turnosHoy).toBeNull();
    expect(body.data.clientes).toBe(12);
  });
});
