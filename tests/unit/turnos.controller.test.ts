import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/turnos/turnos.service.ts", () => ({
  TurnoService: {
    crearTurno:    vi.fn().mockResolvedValue({ id: "t1", status: "Confirmado" }),
    cambiarEstado: vi.fn().mockResolvedValue({ id: "t1", status: "Confirmado" }),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { TurnoService } from "../../supabase/functions/api/src/modules/turnos/turnos.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { turnosRouter } from "../../supabase/functions/api/src/modules/turnos/turnos.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { invalidateModuleCache } from "../../supabase/functions/api/src/middleware/requireModule.ts";
import {
  makeJwt,
  mockDbSequence,
  tenantActiveResult,
  moduleEnabledResult,
  permissionResult,
} from "./_helpers/permissionMock.ts";

const mockGetDb          = vi.mocked(getDb);
const mockCrearTurno     = vi.mocked(TurnoService.crearTurno);
const mockCambiarEstado  = vi.mocked(TurnoService.cambiarEstado);

const TENANT_ID = "tenant-1";
const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: TENANT_ID } });

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/turnos", turnosRouter);
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

const turnoValido = {
  servicioId: "11111111-1111-4111-8111-111111111111",
  clientId:   "22222222-2222-4222-8222-222222222222",
  petId:      "33333333-3333-4333-8333-333333333333",
  date:       "2099-12-31",
  startTime:  "10:00",
  reason:     "Consulta de rutina",
};

describe("turnosRouter — permisos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModuleCache(TENANT_ID, "turnos");
  });

  it("RN-TU7: agendar turno sin manage_appointments → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_clients"])]);
    const res  = await req("POST", "/turnos", turnoValido);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCrearTurno).not.toHaveBeenCalled();
  });

  it("RN-ES4: cambiar estado sin manage_appointments → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_clients"])]);
    const res  = await req("PATCH", "/turnos/t1/estado", { status: "Confirmado" });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCambiarEstado).not.toHaveBeenCalled();
  });

  it("RN-TU7: agendar turno con manage_appointments → 201", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), moduleEnabledResult(true), permissionResult(["manage_appointments"])]);
    const res = await req("POST", "/turnos", turnoValido);

    expect(res.status).toBe(201);
    expect(mockCrearTurno).toHaveBeenCalled();
  });
});
