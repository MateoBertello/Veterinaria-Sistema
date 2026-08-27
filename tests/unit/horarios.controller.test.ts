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

vi.mock("../../supabase/functions/api/src/modules/doctores/doctores.service.ts", () => ({
  DoctorService: {
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    obtenerPorId:   vi.fn().mockResolvedValue({ id: "d1" }),
    actualizar:     vi.fn().mockResolvedValue({ id: "d1" }),
  },
}));

import { HorarioService } from "../../supabase/functions/api/src/modules/horarios/horarios.service.ts";
import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { horariosDoctorRouter, horariosRouter } from "../../supabase/functions/api/src/modules/horarios/horarios.controller.ts";
import { doctoresRouter } from "../../supabase/functions/api/src/modules/doctores/doctores.controller.ts";
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

// ─── Alcance del middleware entre routers montados en el mismo prefijo ────────
// Ambos routers cuelgan de /doctores (ver main.ts). Un `use("/*")` en el router
// de horarios le aplicaba manage_schedules a TODO /doctores, así que la
// recepcionista —que necesita el listado de profesionales para agendar— recibía
// 403 en `GET /doctores` aunque ese endpoint sea del otro router.

/** Monta los dos routers en /doctores en el MISMO orden que main.ts. */
function buildAppMontajeReal() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/doctores", horariosDoctorRouter);
  app.route("/doctores", doctoresRouter);
  return app;
}

function reqEn(app: Hono, method: string, path: string) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${VALID_JWT}`, "Content-Type": "application/json" },
  });
}

describe("montaje de /doctores — el gate de horarios no invade el listado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /doctores con manage_appointments (sin manage_schedules) → 200", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      permissionResult(["manage_appointments", "manage_clients"]),
    ]);

    const res = await reqEn(buildAppMontajeReal(), "GET", "/doctores");

    expect(res.status).toBe(200);
  });

  it("GET /doctores con manage_medical_history (veterinario) → 200", async () => {
    mockDbSequence(mockGetDb, [
      tenantActiveResult(),
      permissionResult(["manage_medical_history", "manage_pets"]),
    ]);

    const res = await reqEn(buildAppMontajeReal(), "GET", "/doctores");

    expect(res.status).toBe(200);
  });

  it("GET /doctores sin ninguno de los permisos de lectura → 403", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_daycare"])]);

    const res  = await reqEn(buildAppMontajeReal(), "GET", "/doctores");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /doctores/:id sigue exigiendo manage_users (gestión, RN-SEC5)", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_schedules"])]);

    const res = await buildAppMontajeReal().request(
      `http://localhost/doctores/${DOCTOR_ID}`,
      {
        method:  "PATCH",
        headers: { Authorization: `Bearer ${VALID_JWT}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ available: false }),
      },
    );

    expect(res.status).toBe(403);
  });
});

// ─── Guard: ninguna ruta de horariosDoctorRouter puede quedar sin autenticación ─
// Este router comparte el prefijo /doctores con el de profesionales, así que no
// puede gatearse con un `use("/*")` (le devolvería 403 a la recepcionista en
// GET /doctores). El gate va adosado a cada ruta, y este test es lo que impide
// que una ruta nueva se declare sin él: recorre las rutas REALMENTE registradas
// —no una lista escrita a mano— y exige que todas rechacen al anónimo.

/** Rutas declaradas por el router, sin las entradas de middleware (method ALL). */
const rutasDeHorariosDoctor = [
  ...new Map(
    horariosDoctorRouter.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => [`${r.method} ${r.path}`, { method: r.method, path: r.path }]),
  ).values(),
];

describe("horariosDoctorRouter — toda ruta declarada exige autenticación", () => {
  it("el router declara rutas (si no, el guard de abajo no probaría nada)", () => {
    expect(rutasDeHorariosDoctor.length).toBeGreaterThan(0);
  });

  it.each(rutasDeHorariosDoctor)(
    "$method $path sin Authorization → 401 UNAUTHORIZED",
    async ({ method, path }) => {
      // Se monta SOLO este router: si una ruta quedara sin gate, no queremos que
      // la tape el middleware del router de doctores montado en el mismo prefijo.
      const app = new Hono();
      app.onError(errorHandler);
      app.route("/doctores", horariosDoctorRouter);

      const concreta = path.replace(/:[A-Za-z0-9_]+/g, DOCTOR_ID);
      const res  = await app.request(`http://localhost/doctores${concreta}`, { method });
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
    },
  );
});
