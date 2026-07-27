import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import { requireActiveTenant } from "../../supabase/functions/api/src/middleware/requireActiveTenant.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { makeJwt } from "./_helpers/permissionMock.ts";
const mockGetDb = vi.mocked(getDb);


const VALID_JWT = makeJwt({ sub: "u1", app_metadata: { tenant_id: "tenant-1" } });

function mockTenant(result: { data: unknown; error: unknown }) {
  const db = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  mockGetDb.mockReturnValue(db as never);
}

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/data", tenantContext, requireActiveTenant, (c) => c.json({ ok: true }));
  return app;
}

async function req() {
  return buildApp().request("http://localhost/data", {
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("requireActiveTenant middleware (RN-SA3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-SA3: tenant suspendido (activo=false) → 403 TENANT_SUSPENDED", async () => {
    mockTenant({ data: { activo: false }, error: null });
    const res = await req();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("TENANT_SUSPENDED");
  });

  it("tenant activo → next (200)", async () => {
    mockTenant({ data: { activo: true }, error: null });
    const res = await req();
    expect(res.status).toBe(200);
  });

  it("tenant inexistente → 404 TENANT_NOT_FOUND", async () => {
    mockTenant({ data: null, error: { message: "not found" } });
    const res = await req();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("TENANT_NOT_FOUND");
  });
});
