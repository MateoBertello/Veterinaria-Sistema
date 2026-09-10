import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantContext } from "../../supabase/functions/api/src/middleware/tenantContext.ts";
import {
  getUserPermissions,
  requireAnyPermission,
  requirePermission,
} from "../../supabase/functions/api/src/middleware/requirePermission.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import {
  makeJwt,
  mockDbSequence,
  mockDbSequenceRaw,
  permissionResult,
} from "./_helpers/permissionMock.ts";

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

// ─── getUserPermissions ──────────────────────────────────────────────────────
// Helper para endpoints que evalúan VARIOS permisos (p. ej. el resumen del
// dashboard): resuelve el set completo en una sola consulta.

describe("getUserPermissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-S2: devuelve el set de permisos del rol del usuario", async () => {
    mockDbSequenceRaw(mockGetDb, [permissionResult(["manage_clients", "manage_pets"])]);

    const permisos = await getUserPermissions("user-1", "Bearer x");

    expect(permisos.has("manage_clients")).toBe(true);
    expect(permisos.has("manage_pets")).toBe(true);
    expect(permisos.has("view_audit")).toBe(false);
    expect(permisos.size).toBe(2);
  });

  it("resuelve todos los permisos en UNA sola consulta (sin N+1 por permiso)", async () => {
    const db = mockDbSequenceRaw(mockGetDb, [permissionResult(["manage_clients", "manage_pets"])]);

    await getUserPermissions("user-1", "Bearer x");

    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("usuarios");
    expect(db.single).toHaveBeenCalledTimes(1);
  });

  it("usuario inexistente o inactivo → set vacío (no lanza)", async () => {
    mockDbSequenceRaw(mockGetDb, [permissionResult(null)]);

    const permisos = await getUserPermissions("user-1", "Bearer x");

    expect(permisos.size).toBe(0);
  });

  it("rol sin permisos asignados → set vacío", async () => {
    mockDbSequenceRaw(mockGetDb, [permissionResult([])]);

    expect((await getUserPermissions("user-1", "Bearer x")).size).toBe(0);
  });

  it("solo considera usuarios activos (filtra active=true)", async () => {
    const db = mockDbSequenceRaw(mockGetDb, [permissionResult(["manage_clients"])]);

    await getUserPermissions("user-1", "Bearer x");

    expect(db.eq).toHaveBeenCalledWith("id", "user-1");
    expect(db.eq).toHaveBeenCalledWith("active", true);
  });
});

// ─── requireAnyPermission ────────────────────────────────────────────────────
// Leer el listado de profesionales lo necesitan varios roles (horarios, turnos,
// historial) aunque su gestión siga siendo de manage_users.

function buildAppAny(permisos: string[]) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/protected", tenantContext, requireAnyPermission(permisos), (c) => c.json({ ok: true }));
  return app;
}

describe("requireAnyPermission middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("alcanza con UNO de los permisos de la lista", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["manage_schedules"])]);

    const res = await sendReq(buildAppAny(["manage_users", "manage_schedules"]));

    expect(res.status).toBe(200);
  });

  it("el veterinario (manage_medical_history) puede leer aunque no tenga manage_users", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["manage_pets", "manage_medical_history"])]);

    const res = await sendReq(buildAppAny(["manage_users", "manage_medical_history"]));

    expect(res.status).toBe(200);
  });

  it("sin ninguno de los permisos → 403 FORBIDDEN con el envelope estándar", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["manage_daycare"])]);

    const res  = await sendReq(buildAppAny(["manage_users", "manage_schedules"]));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("manage_users");
  });

  it("usuario inexistente o inactivo → 403 (getUserPermissions devuelve vacío)", async () => {
    mockDbSequence(mockGetDb, [{ data: null, error: { message: "no rows" } }]);

    const res = await sendReq(buildAppAny(["manage_users"]));

    expect(res.status).toBe(403);
  });

  it("deja los permisos efectivos en el contexto para el handler (sin repetir la consulta)", async () => {
    mockDbSequence(mockGetDb, [permissionResult(["manage_schedules", "manage_users"])]);

    const app = new Hono();
    app.onError(errorHandler);
    app.get("/protected", tenantContext, requireAnyPermission(["manage_schedules"]), (c) =>
      c.json({ admin: c.get("permisos").has("manage_users") }),
    );

    const res  = await sendReq(app);
    const body = await res.json();

    expect(body.admin).toBe(true);
    // Una sola consulta: la del middleware.
    expect(mockGetDb).toHaveBeenCalledTimes(1);
  });
});
