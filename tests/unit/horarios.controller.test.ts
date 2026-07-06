import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/horarios/horarios.service.ts", () => ({
  HorarioService: {
    crearFranja:     vi.fn().mockResolvedValue({ id: "f1" }),
    alternarActivo:  vi.fn().mockResolvedValue({ id: "f1", active: false }),
    eliminar:        vi.fn().mockResolvedValue(undefined),
    resumen:         vi.fn().mockResolvedValue([]),
    listarPorDoctor: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

import { HorarioService } from "../../supabase/functions/api/src/modules/horarios/horarios.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { horariosDoctorRouter, horariosRouter } from "../../supabase/functions/api/src/modules/horarios/horarios.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, mockDbSequence, tenantActiveResult, permissionResult } from "./_helpers/permissionMock.ts";

const mockGetDb          = vi.mocked(getDb);
const mockCrearFranja    = vi.mocked(HorarioService.crearFranja);
const mockAlternarActivo = vi.mocked(HorarioService.alternarActivo);

const VALID_JWT = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });
const DOCTOR_ID = "44444444-4444-4444-8444-444444444444";

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/doctores", horariosDoctorRouter);
  app.route("/horarios", horariosRouter);
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

describe("horariosDoctorRouter/horariosRouter — permisos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RN-HOR5: crear franja (/doctores/:id/horarios) sin manage_schedules → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_users"])]);
    const res  = await req("POST", `/doctores/${DOCTOR_ID}/horarios`, {
      dayOfWeek: 1, startTime: "09:00", endTime: "12:00",
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCrearFranja).not.toHaveBeenCalled();
  });

  it("RN-HOR5: alternar activo (/horarios/:horarioId) sin manage_schedules → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_users"])]);
    const res  = await req("PATCH", "/horarios/f1", { active: false });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockAlternarActivo).not.toHaveBeenCalled();
  });

  it("RN-HOR5: crear franja con manage_schedules → 201", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_schedules"])]);
    const res = await req("POST", `/doctores/${DOCTOR_ID}/horarios`, {
      dayOfWeek: 1, startTime: "09:00", endTime: "12:00",
    });

    expect(res.status).toBe(201);
    expect(mockCrearFranja).toHaveBeenCalled();
  });
});
