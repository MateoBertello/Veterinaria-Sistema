/**
 * Tests unitarios del DashboardService (Etapa 12A).
 *
 * Cubre el contrato de GET /dashboard/resumen: conteos agregados por tenant,
 * gate por permiso (RN-S2) y por módulo licenciado (regla 4 del CLAUDE.md),
 * aislamiento multi-tenant y ausencia del patrón N+1 (una consulta por métrica,
 * con head:true, sin traer filas).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks de dependencias del Service ──────────────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/middleware/requirePermission.ts", () => ({
  getUserPermissions: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/modules/modulos/modulos.service.ts", () => ({
  ModuloService: { habilitadosDelTenant: vi.fn() },
}));

import { getDb, getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { getUserPermissions } from "../../supabase/functions/api/src/middleware/requirePermission.ts";
import { ModuloService } from "../../supabase/functions/api/src/modules/modulos/modulos.service.ts";
import { DashboardService } from "../../supabase/functions/api/src/modules/dashboard/dashboard.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetDb          = vi.mocked(getDb);
const mockGetServiceDb   = vi.mocked(getServiceDb);
const mockGetPermissions = vi.mocked(getUserPermissions);
const mockModulos        = vi.mocked(ModuloService.habilitadosDelTenant);

const TENANT_A   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID    = "user-1";
const AUTH       = "Bearer jwt-de-tenant-a";
const HOY        = new Date().toISOString().slice(0, 10);

const TODOS_LOS_PERMISOS = [
  "manage_clients",
  "manage_pets",
  "manage_appointments",
  "manage_daycare",
  "view_medical_history",
];

const TODOS_LOS_MODULOS = [
  { modulo: "historial_clinico" as const, habilitado: true,  fechaAlta: "2026-01-01" },
  { modulo: "turnos" as const,            habilitado: true,  fechaAlta: "2026-01-01" },
  { modulo: "guarderia" as const,         habilitado: true,  fechaAlta: "2026-01-01" },
];

// ─── Mock del query builder de conteo ────────────────────────────────────────

interface QueryCall {
  tabla:  string;
  select: unknown[];
  ops:    Array<[string, unknown[]]>;
}

/**
 * Falso cliente Supabase que registra cada consulta y resuelve `{ count }`.
 * El builder es "thenable": `await q` devuelve el resultado, igual que PostgREST.
 */
function buildCountDb(counts: Record<string, number>, errorEn?: string) {
  const calls: QueryCall[] = [];

  const from = vi.fn((tabla: string) => {
    const call: QueryCall = { tabla, select: [], ops: [] };
    calls.push(call);

    const resultado = () =>
      errorEn === tabla
        ? { count: null, error: { message: "boom" } }
        : { count: counts[tabla] ?? 0, error: null };

    const builder: Record<string, unknown> = {};
    builder["select"] = vi.fn((...args: unknown[]) => {
      call.select = args;
      return builder;
    });
    for (const op of ["eq", "neq", "in", "gte", "lte"]) {
      builder[op] = vi.fn((...args: unknown[]) => {
        call.ops.push([op, args]);
        return builder;
      });
    }
    builder["then"] = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resultado()).then(resolve, reject);

    return builder;
  });

  return { db: { from } as never, calls };
}

/** Operaciones registradas sobre una tabla (falla si no se consultó). */
function callDe(calls: QueryCall[], tabla: string): QueryCall {
  const call = calls.find((c) => c.tabla === tabla);
  if (!call) throw new Error(`No se consultó la tabla ${tabla}`);
  return call;
}

/** ¿Se aplicó `op(columna, …)` sobre esa tabla? */
function tieneFiltro(call: QueryCall, op: string, columna: string, valor?: unknown): boolean {
  return call.ops.some(
    ([o, args]) =>
      o === op &&
      args[0] === columna &&
      (valor === undefined || JSON.stringify(args[1]) === JSON.stringify(valor)),
  );
}

const ctx = (tenantId = TENANT_A) => ({
  tenantId,
  callerUserId: USER_ID,
  authHeader:   AUTH,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPermissions.mockResolvedValue(new Set(TODOS_LOS_PERMISOS));
  mockModulos.mockResolvedValue(TODOS_LOS_MODULOS);
});

// ─── Conteos y forma de la respuesta ─────────────────────────────────────────

describe("resumen: métricas agregadas del tenant", () => {
  it("devuelve todas las métricas cuando el rol tiene todos los permisos y los módulos están habilitados", async () => {
    const { db } = buildCountDb({
      clientes:        12,
      mascotas:        30,
      turnos:          4,
      estadias:        2,
      plan_vacunacion: 7,
    });
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen).toEqual({
      fecha:              HOY,
      clientes:           12,
      mascotasActivas:    30,
      turnosHoy:          4,
      estadiasHoy:        2,
      vacunasProximas30d: 7,
    });
  });

  it("cero es un valor legítimo: un tenant sin datos devuelve 0, nunca null", async () => {
    const { db } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.clientes).toBe(0);
    expect(resumen.mascotasActivas).toBe(0);
    expect(resumen.turnosHoy).toBe(0);
    expect(resumen.estadiasHoy).toBe(0);
    expect(resumen.vacunasProximas30d).toBe(0);
  });

  it("la fecha de referencia es el día de hoy en formato ISO", async () => {
    const { db } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.fecha).toBe(HOY);
    expect(resumen.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── Prohibición del patrón N+1 ──────────────────────────────────────────────

describe("rendimiento: conteos agregados, sin N+1", () => {
  it("resuelve cada métrica con UNA consulta agregada (5 métricas → 5 consultas)", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    expect(calls).toHaveLength(5);
    expect(calls.map((c) => c.tabla).sort()).toEqual(
      ["clientes", "estadias", "mascotas", "plan_vacunacion", "turnos"],
    );
  });

  it("cuenta con head:true — no descarga ni una fila para contar", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    for (const call of calls) {
      expect(call.select[1]).toEqual({ count: "exact", head: true });
    }
  });

  it("consulta los módulos contratados UNA sola vez, no una por métrica", async () => {
    const { db } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    expect(mockModulos).toHaveBeenCalledTimes(1);
    expect(mockGetPermissions).toHaveBeenCalledTimes(1);
  });

  it("no consulta módulos contratados si ninguna métrica permitida depende de un módulo vendible", async () => {
    mockGetPermissions.mockResolvedValue(new Set(["manage_clients", "manage_pets"]));
    const { db } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    expect(mockModulos).not.toHaveBeenCalled();
  });
});

// ─── Aislamiento multi-tenant ────────────────────────────────────────────────

describe("aislamiento multi-tenant", () => {
  it("toda consulta filtra por el tenant_id del contexto (que sale del JWT)", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx(TENANT_A));

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(tieneFiltro(call, "eq", "tenant_id", TENANT_A)).toBe(true);
      expect(tieneFiltro(call, "eq", "tenant_id", TENANT_B)).toBe(false);
    }
  });

  it("con el contexto de otro tenant, los conteos se piden para ESE tenant", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx(TENANT_B));

    for (const call of calls) {
      expect(tieneFiltro(call, "eq", "tenant_id", TENANT_B)).toBe(true);
    }
  });

  it("lee con el JWT del usuario (RLS activo), nunca con service role", async () => {
    const { db } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    expect(mockGetDb).toHaveBeenCalledWith(AUTH);
    expect(mockGetServiceDb).not.toHaveBeenCalled();
  });
});

// ─── RN-S2: gate por permiso ─────────────────────────────────────────────────

describe("RN-S2: cada métrica exige el permiso de su endpoint dueño", () => {
  it("RN-S2: sin manage_clients → clientes null y la tabla no se consulta", async () => {
    mockGetPermissions.mockResolvedValue(
      new Set(TODOS_LOS_PERMISOS.filter((p) => p !== "manage_clients")),
    );
    const { db, calls } = buildCountDb({ clientes: 99 });
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.clientes).toBeNull();
    expect(calls.some((c) => c.tabla === "clientes")).toBe(false);
  });

  it("RN-S2: sin manage_pets → mascotasActivas null", async () => {
    mockGetPermissions.mockResolvedValue(
      new Set(TODOS_LOS_PERMISOS.filter((p) => p !== "manage_pets")),
    );
    const { db } = buildCountDb({ mascotas: 99 });
    mockGetDb.mockReturnValue(db);

    expect((await DashboardService.resumen(ctx())).mascotasActivas).toBeNull();
  });

  it("RN-S2: sin manage_appointments → turnosHoy null aunque el módulo esté licenciado", async () => {
    mockGetPermissions.mockResolvedValue(
      new Set(TODOS_LOS_PERMISOS.filter((p) => p !== "manage_appointments")),
    );
    const { db } = buildCountDb({ turnos: 99 });
    mockGetDb.mockReturnValue(db);

    expect((await DashboardService.resumen(ctx())).turnosHoy).toBeNull();
  });

  it("RN-S2: sin view_medical_history → vacunasProximas30d null", async () => {
    mockGetPermissions.mockResolvedValue(
      new Set(TODOS_LOS_PERMISOS.filter((p) => p !== "view_medical_history")),
    );
    const { db } = buildCountDb({ plan_vacunacion: 99 });
    mockGetDb.mockReturnValue(db);

    expect((await DashboardService.resumen(ctx())).vacunasProximas30d).toBeNull();
  });

  it("RN-S2: usuario sin permisos (o inactivo) → todas las métricas null y ninguna consulta de conteo", async () => {
    mockGetPermissions.mockResolvedValue(new Set());
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen).toEqual({
      fecha:              HOY,
      clientes:           null,
      mascotasActivas:    null,
      turnosHoy:          null,
      estadiasHoy:        null,
      vacunasProximas30d: null,
    });
    expect(calls).toHaveLength(0);
  });
});

// ─── Regla 4: gate por módulo licenciado ─────────────────────────────────────

describe("licenciamiento: una métrica de módulo vendible exige el módulo habilitado", () => {
  it("módulo turnos no licenciado → turnosHoy null y la tabla no se consulta", async () => {
    mockModulos.mockResolvedValue(
      TODOS_LOS_MODULOS.map((m) => (m.modulo === "turnos" ? { ...m, habilitado: false } : m)),
    );
    const { db, calls } = buildCountDb({ turnos: 99 });
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.turnosHoy).toBeNull();
    expect(calls.some((c) => c.tabla === "turnos")).toBe(false);
    // Las métricas core (no vendibles) siguen visibles.
    expect(resumen.clientes).not.toBeNull();
  });

  it("módulo guarderia no licenciado → estadiasHoy null", async () => {
    mockModulos.mockResolvedValue(
      TODOS_LOS_MODULOS.map((m) => (m.modulo === "guarderia" ? { ...m, habilitado: false } : m)),
    );
    const { db, calls } = buildCountDb({ estadias: 99 });
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.estadiasHoy).toBeNull();
    expect(calls.some((c) => c.tabla === "estadias")).toBe(false);
  });

  it("módulo historial_clinico no licenciado → vacunasProximas30d null", async () => {
    mockModulos.mockResolvedValue(
      TODOS_LOS_MODULOS.map((m) =>
        m.modulo === "historial_clinico" ? { ...m, habilitado: false } : m,
      ),
    );
    const { db } = buildCountDb({ plan_vacunacion: 99 });
    mockGetDb.mockReturnValue(db);

    expect((await DashboardService.resumen(ctx())).vacunasProximas30d).toBeNull();
  });

  it("tenant sin ningún módulo contratado → solo métricas core", async () => {
    mockModulos.mockResolvedValue([]);
    const { db } = buildCountDb({ clientes: 5, mascotas: 8 });
    mockGetDb.mockReturnValue(db);

    const resumen = await DashboardService.resumen(ctx());

    expect(resumen.clientes).toBe(5);
    expect(resumen.mascotasActivas).toBe(8);
    expect(resumen.turnosHoy).toBeNull();
    expect(resumen.estadiasHoy).toBeNull();
    expect(resumen.vacunasProximas30d).toBeNull();
  });
});

// ─── Criterio de cada conteo ─────────────────────────────────────────────────

describe("criterio de cada métrica", () => {
  it("RN-CL8: clientes excluye los eliminados (baja lógica)", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    expect(tieneFiltro(callDe(calls, "clientes"), "eq", "deleted", false)).toBe(true);
  });

  it("mascotasActivas cuenta solo estado 'Activa' y no eliminadas", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    const call = callDe(calls, "mascotas");
    expect(tieneFiltro(call, "eq", "estado", "Activa")).toBe(true);
    expect(tieneFiltro(call, "eq", "deleted", false)).toBe(true);
  });

  it("turnosHoy filtra por la fecha de hoy y excluye los cancelados", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    const call = callDe(calls, "turnos");
    expect(tieneFiltro(call, "eq", "date", HOY)).toBe(true);
    expect(tieneFiltro(call, "neq", "status", "Cancelado")).toBe(true);
  });

  it("estadiasHoy cuenta las vigentes que ocupan hoy (rango inclusivo, igual que /estadias/cupo)", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    const call = callDe(calls, "estadias");
    expect(tieneFiltro(call, "in", "status", ["Reservada", "EnCurso"])).toBe(true);
    expect(tieneFiltro(call, "lte", "check_in_date", HOY)).toBe(true);
    expect(tieneFiltro(call, "gte", "check_out_date", HOY)).toBe(true);
  });

  it("vacunasProximas30d cuenta dosis Pendiente en la ventana [hoy, hoy+30]", async () => {
    const { db, calls } = buildCountDb({});
    mockGetDb.mockReturnValue(db);

    await DashboardService.resumen(ctx());

    const en30 = new Date(`${HOY}T00:00:00Z`);
    en30.setUTCDate(en30.getUTCDate() + 30);
    const hasta = en30.toISOString().slice(0, 10);

    const call = callDe(calls, "plan_vacunacion");
    expect(tieneFiltro(call, "eq", "estado", "Pendiente")).toBe(true);
    expect(tieneFiltro(call, "gte", "fecha_estimada", HOY)).toBe(true);
    expect(tieneFiltro(call, "lte", "fecha_estimada", hasta)).toBe(true);
  });
});

// ─── Errores ─────────────────────────────────────────────────────────────────

describe("errores", () => {
  it("un error de la base en un conteo se propaga como INTERNAL_ERROR 500", async () => {
    const { db } = buildCountDb({}, "turnos");
    mockGetDb.mockReturnValue(db);

    await expect(DashboardService.resumen(ctx())).rejects.toMatchObject({
      code:       ErrorCode.INTERNAL_ERROR,
      statusCode: 500,
    });
  });

  it("el mensaje de error no filtra el detalle crudo al cliente por otra vía que el handler global", async () => {
    const { db } = buildCountDb({}, "clientes");
    mockGetDb.mockReturnValue(db);

    await expect(DashboardService.resumen(ctx())).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
  });
});
