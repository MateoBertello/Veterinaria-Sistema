import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireSuperAdmin } from "../../supabase/functions/api/src/middleware/requireSuperAdmin.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, makeJwtAlgNone, makeJwtForjado } from "./_helpers/permissionMock.ts";


function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/admin/ping", requireSuperAdmin, (c) =>
    c.json({ ok: true, superAdminId: c.get("superAdminId") }),
  );
  return app;
}

async function ping(jwt?: string) {
  const headers: Record<string, string> = {};
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  return buildApp().request("http://localhost/admin/ping", { headers });
}

describe("requireSuperAdmin middleware", () => {
  it("sin header Authorization → 401 UNAUTHORIZED", async () => {
    const res = await ping();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("JWT sin platform_role=super_admin → 403 FORBIDDEN", async () => {
    const jwt = makeJwt({ sub: "u1", app_metadata: { tenant_id: "t1" } });
    const res = await ping(jwt);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("platform_role distinto de super_admin → 403 FORBIDDEN", async () => {
    const jwt = makeJwt({ sub: "u1", app_metadata: { platform_role: "soporte" } });
    const res = await ping(jwt);
    expect(res.status).toBe(403);
  });

  it("JWT con platform_role=super_admin → next (200) y adjunta superAdminId", async () => {
    const jwt = makeJwt({ sub: "sa-1", app_metadata: { platform_role: "super_admin" } });
    const res = await ping(jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.superAdminId).toBe("sa-1");
  });

  // ── Tokens forjados ────────────────────────────────────────────────────────
  // Estos endpoints operan con `service_role` (RLS bypasseada), así que la
  // firma del token es el ÚNICO control: si no se verifica, cualquiera se
  // fabrica un super admin y se lleva la consola de plataforma entera.

  it("firma inválida con claims de super_admin → 401, NO 403", async () => {
    const res = await ping(makeJwtForjado({
      sub: "atacante",
      app_metadata: { platform_role: "super_admin" },
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("`alg: none` con claims de super_admin → 401", async () => {
    const res = await ping(makeJwtAlgNone({
      sub: "atacante",
      app_metadata: { platform_role: "super_admin" },
    }));

    expect(res.status).toBe(401);
  });

  it("token de super_admin vencido → 401", async () => {
    const res = await ping(makeJwt({
      sub: "sa-1",
      app_metadata: { platform_role: "super_admin" },
      exp: Math.floor(Date.now() / 1000) - 60,
    }));

    expect(res.status).toBe(401);
  });
});