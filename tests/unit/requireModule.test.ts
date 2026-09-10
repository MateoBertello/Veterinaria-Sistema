import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import {
  requireModule,
  invalidateModuleCache,
} from "../../supabase/functions/api/src/middleware/requireModule.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";

// ─── Mock de getDb ─────────────────────────────────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { makeJwt } from "./_helpers/permissionMock.ts";
const mockGetDb = vi.mocked(getDb);


const TENANT_ID = "tenant-test-1";
const VALID_JWT  = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp(modulo: "historial_clinico" | "turnos" | "guarderia") {
  const app = new Hono();
  app.onError(errorHandler);
  app.get(
    "/protected",
    tenantContext,
    requireModule(modulo),
    (c) => c.json({ ok: true }),
  );
  return app;
}

function mockDb(opts: { habilitado: boolean }) {
  const db = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };

  // requireModule ya no consulta tenants (la suspensión la cubre requireActiveTenant):
  // única llamada → query de modulos_contratados.
  db.single.mockResolvedValue({
    data: opts.habilitado ? { habilitado: true } : null,
    error: opts.habilitado ? null : { message: "not found" },
  });

  mockGetDb.mockReturnValue(db as never);
  return db;
}

async function sendReq(app: Hono) {
  return app.request("http://localhost/protected", {
    method: "GET",
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("requireModule middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID);
  });

  it("RN-SM1: permite el acceso cuando el módulo está habilitado", async () => {
    mockDb({ habilitado: true });
    const app = buildApp("historial_clinico");
    const res = await sendReq(app);
    expect(res.status).toBe(200);
  });

  it("RN-SM1: rechaza con 403 MODULE_NOT_LICENSED cuando el módulo no está habilitado", async () => {
    mockDb({ habilitado: false });
    const app = buildApp("turnos");
    const res = await sendReq(app);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("MODULE_NOT_LICENSED");
  });

  it("consulta la base en cada llamada (sin caché en memoria, isolate efímero)", async () => {
    mockDb({ habilitado: true });
    mockDb({ habilitado: true });
    const app = buildApp("historial_clinico");

    // Primera llamada → hit DB
    await sendReq(app);
    expect(mockGetDb).toHaveBeenCalledTimes(1);

    // Segunda llamada → hit DB de nuevo (no hay caché en memoria)
    await sendReq(app);
    expect(mockGetDb).toHaveBeenCalledTimes(2);
  });

  it("invalidateModuleCache es un no-op seguro", () => {
    expect(() => invalidateModuleCache(TENANT_ID)).not.toThrow();
    expect(() => invalidateModuleCache(TENANT_ID, "historial_clinico")).not.toThrow();
  });
});
