import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, makeJwtAlgNone, makeJwtForjado } from "./_helpers/permissionMock.ts";

// JWT de prueba: header.payload.signature
// payload: { sub: "user-123", app_metadata: { tenant_id: "tenant-abc" } }
const TENANT_ID = "tenant-abc";
const USER_ID   = "user-123";


const VALID_JWT = makeJwt({
  sub: USER_ID,
  app_metadata: { tenant_id: TENANT_ID },
});

const JWT_SIN_TENANT = makeJwt({ sub: USER_ID, app_metadata: {} });
const JWT_SIN_SUB    = makeJwt({ app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/test", tenantContext, (c) =>
    c.json({ tenantId: c.get("tenantId"), userId: c.get("userId") }),
  );
  return app;
}

async function req(
  app: Hono,
  opts: { auth?: string; queryTenantId?: string; bodyTenantId?: string } = {},
) {
  const url = opts.queryTenantId
    ? `http://localhost/test?tenant_id=${opts.queryTenantId}`
    : "http://localhost/test";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth) headers["Authorization"] = opts.auth;

  const body = opts.bodyTenantId
    ? JSON.stringify({ tenant_id: opts.bodyTenantId })
    : undefined;

  return app.request(url, { method: "GET", headers, body });
}

describe("tenantContext middleware", () => {
  it("401 cuando no hay header Authorization", async () => {
    const app = buildApp();
    const res = await req(app);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 cuando Authorization no comienza con Bearer", async () => {
    const app = buildApp();
    const res = await req(app, { auth: "Basic dXNlcjpwYXNz" });
    expect(res.status).toBe(401);
  });

  it("401 cuando el JWT no tiene tenant_id en app_metadata", async () => {
    const app = buildApp();
    const res = await req(app, { auth: `Bearer ${JWT_SIN_TENANT}` });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 cuando el JWT no tiene sub (userId)", async () => {
    const app = buildApp();
    const res = await req(app, { auth: `Bearer ${JWT_SIN_SUB}` });
    expect(res.status).toBe(401);
  });

  it("401 con token malformado (no es JWT)", async () => {
    const app = buildApp();
    const res = await req(app, { auth: "Bearer esto-no-es-un-jwt" });
    expect(res.status).toBe(401);
  });

  it("resuelve tenantId y userId desde el JWT válido", async () => {
    const app = buildApp();
    const res = await req(app, { auth: `Bearer ${VALID_JWT}` });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; userId: string };
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.userId).toBe(USER_ID);
  });

  it("ignora tenant_id en query params (siempre usa JWT)", async () => {
    const app = buildApp();
    const res = await req(app, {
      auth: `Bearer ${VALID_JWT}`,
      queryTenantId: "otro-tenant-malicioso",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    // El tenantId resuelto es el del JWT, no el de la query
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.tenantId).not.toBe("otro-tenant-malicioso");
  });

  // ── Tokens forjados ────────────────────────────────────────────────────────
  // Acá la firma no es el único control (PostgREST la revalida en cada
  // consulta), pero un token inventado tiene que morir en la puerta y no
  // avanzar por la cadena de middlewares como si fuera una sesión real.

  it("firma inválida → 401 aunque traiga un tenant_id bien formado", async () => {
    const app = buildApp();
    const res = await req(app, {
      auth: `Bearer ${makeJwtForjado({ sub: USER_ID, app_metadata: { tenant_id: TENANT_ID } })}`,
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("`alg: none` → 401", async () => {
    const app = buildApp();
    const res = await req(app, {
      auth: `Bearer ${makeJwtAlgNone({ sub: USER_ID, app_metadata: { tenant_id: TENANT_ID } })}`,
    });

    expect(res.status).toBe(401);
  });

  it("token vencido → 401", async () => {
    const app = buildApp();
    const res = await req(app, {
      auth: `Bearer ${makeJwt({
        sub: USER_ID,
        app_metadata: { tenant_id: TENANT_ID },
        exp: Math.floor(Date.now() / 1000) - 60,
      })}`,
    });

    expect(res.status).toBe(401);
  });
});