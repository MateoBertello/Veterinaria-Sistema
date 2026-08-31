import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../supabase/functions/api/src/modules/catalogos/catalogos.service.ts", () => {
  const stub = (extra: Record<string, unknown> = {}) => ({
    buscarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    crear:          vi.fn().mockResolvedValue({ id: "c1", ...extra }),
    actualizar:     vi.fn().mockResolvedValue({ id: "c1", ...extra }),
    cambiarEstado:  vi.fn().mockResolvedValue({ id: "c1", active: false, ...extra }),
  });
  return {
    EspeciesService:    stub(),
    RazasService:       stub(),
    TiposVacunaService: stub(),
  };
});

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

import { getDb } from "../../supabase/functions/api/src/shared/db.ts";
import { EspeciesService } from "../../supabase/functions/api/src/modules/catalogos/catalogos.service.ts";
import {
  especiesRouter,
  razasRouter,
  tiposVacunaRouter,
} from "../../supabase/functions/api/src/modules/catalogos/catalogos.controller.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { makeJwt, mockDbSequence, tenantActiveResult, permissionResult } from "./_helpers/permissionMock.ts";

const mockGetDb = vi.mocked(getDb);

const VALID_JWT  = makeJwt({ sub: "user-1", app_metadata: { tenant_id: "tenant-1" } });
const ESPECIE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ROUTERS = [
  { nombre: "especies",     prefijo: "/especies",     router: especiesRouter },
  { nombre: "razas",        prefijo: "/razas",        router: razasRouter },
  { nombre: "tipos-vacuna", prefijo: "/tipos-vacuna", router: tiposVacunaRouter },
] as const;

function montar(prefijo: string, router: Hono) {
  const app = new Hono();
  app.onError(errorHandler);
  app.route(prefijo, router);
  return app;
}

/** Rutas realmente registradas por un router, sin las entradas de middleware. */
function rutasDe(router: Hono) {
  return [
    ...new Map(
      router.routes
        .filter((r) => r.method !== "ALL")
        .map((r) => [`${r.method} ${r.path}`, { method: r.method, path: r.path }]),
    ).values(),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Guard de autenticación ───────────────────────────────────────────────────
//
// Los tres routers se gatean con `use("/*")`, que es seguro porque cada uno es
// dueño de su prefijo. Pero un `use()` puede desfasarse de las rutas reales (un
// `basePath` mal puesto, una ruta declarada fuera del patrón), y el síntoma
// sería una ruta de ESCRITURA sin autenticación. Este guard recorre las rutas
// REALMENTE registradas —no una lista escrita a mano— y exige que todas
// rechacen al anónimo.

describe.each(ROUTERS)("$nombre — toda ruta declarada exige autenticación", ({ prefijo, router }) => {
  it("el router declara rutas (si no, el guard de abajo no probaría nada)", () => {
    expect(rutasDe(router).length).toBeGreaterThan(0);
  });

  it.each(rutasDe(router))("$method $path sin Authorization → 401 UNAUTHORIZED", async ({ method, path }) => {
    const app      = montar(prefijo, router);
    const concreta = path.replace(/:[A-Za-z0-9_]+/g, ESPECIE_ID);

    const res  = await app.request(`http://localhost${prefijo}${concreta}`.replace(/\/$/, "") || prefijo, {
      method,
      headers: { "Content-Type": "application/json" },
      body:    method === "GET" ? undefined : JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ─── Permiso ──────────────────────────────────────────────────────────────────

describe("catálogos — gate de permiso manage_catalogs", () => {
  it("sin manage_catalogs → 403 FORBIDDEN", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_pets"])]);

    const app = montar("/especies", especiesRouter);
    const res = await app.request("http://localhost/especies", {
      headers: { Authorization: `Bearer ${VALID_JWT}` },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("con manage_catalogs → 200", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_catalogs"])]);

    const app = montar("/especies", especiesRouter);
    const res = await app.request("http://localhost/especies", {
      headers: { Authorization: `Bearer ${VALID_JWT}` },
    });

    expect(res.status).toBe(200);
  });
});

// ─── Validación del :id ───────────────────────────────────────────────────────

describe("catálogos — el :id se valida como UUID antes de llegar al Service", () => {
  it("PUT /especies/no-es-uuid → 422 VALIDATION_ERROR (sin tocar el Service)", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_catalogs"])]);

    const app = montar("/especies", especiesRouter);
    const res = await app.request("http://localhost/especies/no-es-uuid", {
      method:  "PUT",
      headers: { Authorization: `Bearer ${VALID_JWT}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ name: "Perro" }),
    });

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(EspeciesService.actualizar).not.toHaveBeenCalled();
  });

  it("PATCH /especies/:id/estado sin el campo 'active' → 422 (sin tocar el Service)", async () => {
    mockDbSequence(mockGetDb, [tenantActiveResult(), permissionResult(["manage_catalogs"])]);

    const app = montar("/especies", especiesRouter);
    const res = await app.request(`http://localhost/especies/${ESPECIE_ID}/estado`, {
      method:  "PATCH",
      headers: { Authorization: `Bearer ${VALID_JWT}`, "Content-Type": "application/json" },
      body:    JSON.stringify({}),
    });

    expect(res.status).toBe(422);
    expect(EspeciesService.cambiarEstado).not.toHaveBeenCalled();
  });
});
