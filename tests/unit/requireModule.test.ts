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
const mockGetDb = vi.mocked(getDb);

function makeJwt(payload: object): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.sig`;
}

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
  db.single.mockResolvedValueOnce({
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

  it("usa la caché en la segunda llamada (sin re-consultar DB)", async () => {
    mockDb({ habilitado: true });
    const app = buildApp("historial_clinico");

    // Primera llamada → hit DB
    await sendReq(app);
    const callsAfterFirst = mockGetDb.mock.calls.length;

    // Segunda llamada → hit caché (no llama a getDb de nuevo)
    await sendReq(app);
    const callsAfterSecond = mockGetDb.mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst); // sin nuevas llamadas
  });

  it("re-consulta DB después de invalidar la caché", async () => {
    // Setup: módulo habilitado, cachear
    mockDb({ habilitado: true });
    const app = buildApp("historial_clinico");
    await sendReq(app);

    // Invalidar e intentar de nuevo con módulo deshabilitado
    invalidateModuleCache(TENANT_ID, "historial_clinico");
    vi.clearAllMocks();
    mockDb({ habilitado: false });

    const res = await sendReq(app);
    expect(res.status).toBe(403);
    expect(mockGetDb).toHaveBeenCalled(); // sí llamó a DB de nuevo
  });

  it("re-consulta DB después de que el TTL expira", async () => {
    mockDb({ habilitado: true });
    const app = buildApp("historial_clinico");
    await sendReq(app);

    // Simular expiración del TTL adelantando Date.now 61 segundos
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);

    vi.clearAllMocks();
    mockDb({ habilitado: false });

    const res = await sendReq(app);
    expect(mockGetDb).toHaveBeenCalled(); // re-consultó DB
    expect(res.status).toBe(403);

    vi.restoreAllMocks();
  });
});
