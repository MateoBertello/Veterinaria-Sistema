import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/configuracion/configuracion.service.ts", () => ({
  ConfiguracionService: {
    obtener:   vi.fn().mockResolvedValue({ cupoMaximoDiario: 10, diasAvisoVacuna: 7, parametrosExtra: {}, updatedAt: "2026-01-01T00:00:00Z" }),
    actualizar: vi.fn().mockResolvedValue({ cupoMaximoDiario: 10, diasAvisoVacuna: 7, parametrosExtra: {}, updatedAt: "2026-01-01T00:00:00Z" }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { ConfiguracionService } from "../../supabase/functions/api/src/modules/configuracion/configuracion.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { configuracionRouter } from "../../supabase/functions/api/src/modules/configuracion/configuracion.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, mockDbSequence, tenantActiveResult, permissionResult } from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);
const mockObtener = vi.mocked(ConfiguracionService.obtener);

const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/configuracion", configuracionRouter);
  return app;
}

function get() {
  return buildApp().request("http://localhost/configuracion", {
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("configuracionRouter — permisos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-CF4: consultar configuración sin manage_tenant_settings → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_clients"])]);
    const res  = await get();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockObtener).not.toHaveBeenCalled();
  });

  it("RN-CF4: consultar configuración con manage_tenant_settings → 200", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_tenant_settings"])]);
    const res = await get();

    expect(res.status).toBe(200);
    expect(mockObtener).toHaveBeenCalled();
  });
});
