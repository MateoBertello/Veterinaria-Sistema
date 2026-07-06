import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import { requirePermission } from "../../supabase/functions/api/src/middleware/requirePermission.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { makeJwt, mockDbSequence, permissionResult } from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);

const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-test-1" } });

function buildApp(permiso: string) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/protected", tenantContext, requirePermission(permiso), (c) => c.json({ ok: true }));
  return app;
}

async function sendReq(app: Hono) {
  return app.request("http://localhost/protected", {
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("requirePermission middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-S2: permite el acceso cuando el rol del usuario tiene el permiso requerido", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["manage_clients"])]);
    const res = await sendReq(buildApp("manage_clients"));
    expect(res.status).toBe(200);
  });

  it("RN-S2: rechaza con 403 FORBIDDEN cuando el rol no tiene el permiso requerido", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["view_audit"])]);
    const res = await sendReq(buildApp("manage_clients"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("RN-S2: rechaza con 403 FORBIDDEN cuando el usuario no existe o está inactivo", async () => {
    mockDbSequence(mockGetDb, [permissionResult(null)]);
    const res = await sendReq(buildApp("manage_clients"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("RN-S2: rechaza con 403 FORBIDDEN cuando el rol no tiene ningún permiso asignado", async () => {
    mockDbSequence(mockGetDb, [permissionResult([])]);
    const res = await sendReq(buildApp("manage_pets"));
    expect(res.status).toBe(403);
  });

  it("RN-S2: el mensaje de error cita el nombre del permiso requerido", async () => {
    mockDbSequence(mockGetDb, [permissionResult([])]);
    const res = await sendReq(buildApp("manage_pets"));
    const body = await res.json();
    expect(body.error.message).toContain("manage_pets");
  });
});
