import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import { requireActiveTenant } from "../../supabase/functions/api/src/middleware/requireActiveTenant.ts";
import { requirePermission } from "../../supabase/functions/api/src/middleware/requirePermission.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { makeJwt } from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);

const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });

/**
 * Mockea la consulta consolidada. A diferencia del helper histórico, este mock
 * SÍ modela `usuarios.active`: es lo que hace que la verificación de usuario
 * activo sea observable desde un test (ver el caso de mutación más abajo).
 */
function mockAcceso(opts: {
  tenantExiste?: boolean;
  tenantActivo?: boolean;
  usuarioExiste?: boolean;
  usuarioActivo?: boolean;
  permisos?: string[];
}) {
  const {
    tenantExiste  = true,
    tenantActivo  = true,
    usuarioExiste = true,
    usuarioActivo = true,
    permisos      = [],
  } = opts;

  const usuarios = usuarioExiste
    ? [{
        active: usuarioActivo,
        roles: { rol_permiso: permisos.map((name) => ({ permisos: { name } })) },
      }]
    : [];

  const single = vi.fn().mockResolvedValue(
    tenantExiste
      ? { data: { activo: tenantActivo, usuarios }, error: null }
      : { data: null, error: { message: "not found" } },
  );

  const db = {
    from:   vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single,
  };
  mockGetDb.mockReturnValue(db as never);
  return { db, single };
}

function buildApp(permiso: string) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get(
    "/protegido",
    tenantContext,
    requireActiveTenant,
    requirePermission(permiso),
    (c) => c.json({ ok: true }),
  );
  return app;
}

async function req(permiso = "manage_clients") {
  return buildApp(permiso).request("http://localhost/protegido", {
    headers: { Authorization: `Bearer ${VALID_JWT}` },
  });
}

describe("consulta de acceso consolidada (tenant + usuario + permisos)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resuelve tenant activo y permisos con UNA sola consulta, no dos", async () => {
    const { db, single } = mockAcceso({ permisos: ["manage_clients"] });

    const res = await req();

    expect(res.status).toBe(200);
    // El punto de todo el cambio: un único viaje a la base para los dos guards.
    expect(single).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("el segundo guard reusa el resultado del primero sin volver a consultar", async () => {
    const { single } = mockAcceso({ permisos: ["manage_clients"] });
    await req();
    expect(single).toHaveBeenCalledTimes(1);
  });

  // ── Lo que no se puede romper ──────────────────────────────────────────────

  it("RN-SA3: tenant suspendido → 403 TENANT_SUSPENDED", async () => {
    mockAcceso({ tenantActivo: false, permisos: ["manage_clients"] });
    const res = await req();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("TENANT_SUSPENDED");
  });

  it("tenant inexistente → 404 TENANT_NOT_FOUND", async () => {
    mockAcceso({ tenantExiste: false });
    const res = await req();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TENANT_NOT_FOUND");
  });

  it("RN-S2: permiso faltante → 403 FORBIDDEN", async () => {
    mockAcceso({ permisos: ["view_audit"] });
    const res = await req();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("usuario inexistente en el tenant → 403 FORBIDDEN", async () => {
    mockAcceso({ usuarioExiste: false });
    const res = await req();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  /**
   * ESTE es el test que faltaba, y el que la mutación tiene que poner en rojo.
   *
   * El control "Desactivar deja afuera de verdad" de docs/DEPLOY.md §checklist
   * y el test de integración equivalente verifican el camino de PostgREST, que
   * lo corta `usuario_activo()` en RLS. Ninguno pasa por el middleware, así que
   * la verificación de `active` del camino de la API no estaba cubierta: podía
   * borrarse sin que ningún test se pusiera rojo.
   */
  it("usuario con active=false → 403 FORBIDDEN aunque el token siga vigente", async () => {
    mockAcceso({ usuarioActivo: false, permisos: ["manage_clients"] });
    const res = await req();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("la suspensión del tenant gana sobre la falta de permiso", async () => {
    // Precedencia histórica: requireActiveTenant corre antes que requirePermission.
    mockAcceso({ tenantActivo: false, permisos: [] });
    const res = await req();
    expect((await res.json()).error.code).toBe("TENANT_SUSPENDED");
  });
});
