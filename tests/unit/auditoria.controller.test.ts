import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/auditoria/auditoria.service.ts", () => ({
  AuditoriaService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    exportarCsv:     vi.fn().mockResolvedValue({ csv: "", truncated: false, totalMatching: 0 }),
  },
  EXPORT_LIMIT: 5000,
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { AuditoriaService } from "../../supabase/functions/api/src/modules/auditoria/auditoria.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { auditoriaRouter } from "../../supabase/functions/api/src/modules/auditoria/auditoria.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, mockDbSequence, tenantActiveResult, permissionResult } from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);
const mockBuscarPaginado = vi.mocked(AuditoriaService.buscarPaginado);

const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/auditoria", auditoriaRouter);
  return app;
}

function get(path: string) {
  return buildApp().request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("auditoriaRouter — permisos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-AUD3: consultar auditoría sin view_audit → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_clients"])]);
    const res  = await get("/auditoria");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockBuscarPaginado).not.toHaveBeenCalled();
  });

  it("RN-AUD3: consultar auditoría con view_audit → 200", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["view_audit"])]);
    const res = await get("/auditoria");

    expect(res.status).toBe(200);
    expect(mockBuscarPaginado).toHaveBeenCalled();
  });
});
