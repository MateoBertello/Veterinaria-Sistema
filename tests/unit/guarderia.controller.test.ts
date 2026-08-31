import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/guarderia/guarderia.service.ts", () => ({
  EstadiaService: {
    crear:        vi.fn().mockResolvedValue({ id: "e1", status: "Reservada" }),
    checkin:      vi.fn().mockResolvedValue({ id: "e1", status: "EnCurso" }),
    checkout:     vi.fn().mockResolvedValue({ id: "e1", status: "Finalizada" }),
    actualizar:   vi.fn().mockResolvedValue({ id: "e1", status: "Reservada" }),
    cancelar:     vi.fn().mockResolvedValue({ id: "e1", status: "Cancelada" }),
    cupo:         vi.fn().mockResolvedValue([]),
    listar:       vi.fn().mockResolvedValue([]),
    listarRango:  vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { EstadiaService } from "../../supabase/functions/api/src/modules/guarderia/guarderia.service.ts";
import { getDb, getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { guarderiaRouter } from "../../supabase/functions/api/src/modules/guarderia/guarderia.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { invalidateModuleCache } from "../../supabase/functions/api/src/middleware/requireModule.ts";
import {
  makeJwt,
  mockDbSequence,
  tenantActiveResult,
  moduleEnabledResult,
  permissionResult,
} from "./_helpers/permissionMock.ts";

const mockGetDb    = vi.mocked(getDb);
const mockGetServiceDb = vi.mocked(getServiceDb);
const mockCrear    = vi.mocked(EstadiaService.crear);
const mockCheckin  = vi.mocked(EstadiaService.checkin);
const mockActualizar = vi.mocked(EstadiaService.actualizar);

const TENANT_ID  = "tenant-1";
const VALID_JWT  = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/estadias", guarderiaRouter);
  return app;
}

function req(method: string, path: string, body?: unknown) {
  return buildApp().request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${VALID_JWT}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

describe("guarderiaRouter — permisos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "guarderia");
  });

  it("RN-CK5: checkin sin manage_daycare → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_clients"])]);
    const res  = await req("PATCH", "/estadias/e1/checkin");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCheckin).not.toHaveBeenCalled();
  });

  it("RN-CK5: checkin con manage_daycare → 200", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_daycare"])]);
    const res = await req("PATCH", "/estadias/11111111-1111-4111-8111-111111111111/checkin");

    expect(res.status).toBe(200);
    expect(mockCheckin).toHaveBeenCalled();
  });

  it("RN-GU6: crear estadía sin manage_daycare → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_clients"])]);
    const res = await req("POST", "/estadias", {
      clientId:     "11111111-1111-1111-1111-111111111111",
      petId:        "22222222-2222-2222-2222-222222222222",
      checkInDate:  "2026-08-01",
      checkOutDate: "2026-08-02",
      reason:       "Viaje del dueño",
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("RN-ME5: modificar estadía sin manage_daycare → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_clients"])]);
    const res = await req("PUT", "/estadias/11111111-1111-1111-1111-111111111111", { reason: "Nuevo motivo" });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockActualizar).not.toHaveBeenCalled();
  });
});

// ─── El controller no toca la base (regla 3: Controller → Service → DB) ───────
// PUT /estadias/:id pre-rellenaba acá los campos ausentes del body abriendo un
// cliente service_role: era la única lectura de negocio fuera de un Service.
// Ahora delega el DTO parcial tal cual y el pre-relleno vive en EstadiaService.

describe("PUT /estadias/:id — el pre-relleno es del Service, no del controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "guarderia");
  });

  it("no abre un cliente service_role: getServiceDb no se llama", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_daycare"])]);

    const res = await req("PUT", "/estadias/11111111-1111-4111-8111-111111111111", { reason: "Nuevo motivo" });

    expect(res.status).toBe(200);
    expect(mockGetServiceDb).not.toHaveBeenCalled();
  });

  it("delega el body parcial tal cual, sin completarlo", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_daycare"])]);

    await req("PUT", "/estadias/11111111-1111-4111-8111-111111111111", { reason: "Nuevo motivo" });

    expect(mockActualizar).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { reason: "Nuevo motivo" },
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("ID no UUID → 422 VALIDATION_ERROR antes de delegar", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_daycare"])]);

    const res  = await req("PUT", "/estadias/no-es-uuid", { reason: "Nuevo motivo" });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockActualizar).not.toHaveBeenCalled();
  });
});
