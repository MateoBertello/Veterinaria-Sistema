import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit }  from "../../supabase/functions/api/src/shared/audit.ts";
import { ServicioService } from "../../supabase/functions/api/src/modules/servicios/servicios.service.ts";
import { ErrorCode }    from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SVC_ID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

const dtoValido = {
  nombre:              "Consulta General",
  tipo:                "clinica" as const,
  duracionMinutos:     30,
  requiereProfesional: true,
  descripcion:         "Revisación básica",
};

/** Helper para construir un mock de DB que devuelve la cadena builder completa. */
function buildDbChain(overrides: {
  maybeSingleData?: unknown;
  singleData?:      unknown;
  singleError?:     { message: string } | null;
  selectError?:     { message: string } | null;
  countData?:       unknown[];
  count?:           number;
} = {}) {
  const chain: Record<string, unknown> = {};

  const singleFn = vi.fn().mockResolvedValue({
    data:  overrides.singleData ?? null,
    error: overrides.singleError ?? null,
  });
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data:  overrides.maybeSingleData ?? null,
    error: null,
  });

  const rangeFn = vi.fn().mockResolvedValue({
    data:  overrides.countData ?? [],
    error: overrides.selectError ?? null,
    count: overrides.count ?? 0,
  });

  chain["from"]   = vi.fn().mockReturnValue(chain);
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["insert"] = vi.fn().mockReturnValue(chain);
  chain["update"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockReturnValue(chain);
  chain["ilike"]  = vi.fn().mockReturnValue(chain);
  chain["order"]  = vi.fn().mockReturnValue(chain);
  chain["range"]  = rangeFn;
  chain["single"] = singleFn;
  chain["maybeSingle"] = maybeSingleFn;
  chain["gte"]    = vi.fn().mockReturnValue(chain);
  chain["lte"]    = vi.fn().mockReturnValue(chain);

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ServicioService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-SV1 ────────────────────────────────────────────────────────────────

  it("RN-SV1: duracionMinutos=7 (no múltiplo de 5) → VALIDATION_ERROR", async () => {
    const db = buildDbChain();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ServicioService.crear({ ...dtoValido, duracionMinutos: 7 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-SV1: duracionMinutos=481 (fuera de rango) → VALIDATION_ERROR", async () => {
    const db = buildDbChain();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ServicioService.crear({ ...dtoValido, duracionMinutos: 481 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  // ── RN-SV2 ────────────────────────────────────────────────────────────────

  it("RN-SV2: nombre duplicado activo en mismo tenant → SERVICE_IN_USE", async () => {
    // La pre-query de nombre duplicado devuelve una fila existente.
    const db = buildDbChain({ maybeSingleData: { id: SVC_ID, nombre: "Consulta General" } });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ServicioService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_IN_USE, statusCode: 409 });
  });

  // ── RN-SV3 ────────────────────────────────────────────────────────────────

  it("RN-SV3: cambiarEstado(false) con turnos futuros mockeados → VALIDATION_ERROR", async () => {
    // Primera llamada: obtener el servicio (existe).
    // Segunda llamada: query turnos futuros (devuelve 1 fila → hay turnos pendientes).
    let callCount = 0;
    const db: Record<string, unknown> = {};

    const singleFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // obtenerPorId — servicio existe
        return Promise.resolve({ data: { id: SVC_ID, activo: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });

    // La query de turnos futuros devuelve count > 0
    const rangeFn = vi.fn().mockResolvedValue({ data: [{ id: "turno-1" }], error: null, count: 1 });

    db["from"]   = vi.fn().mockReturnValue(db);
    db["select"] = vi.fn().mockReturnValue(db);
    db["update"] = vi.fn().mockReturnValue(db);
    db["eq"]     = vi.fn().mockReturnValue(db);
    db["gte"]    = vi.fn().mockReturnValue(db);
    db["order"]  = vi.fn().mockReturnValue(db);
    db["range"]  = rangeFn;
    db["single"] = singleFn;
    db["maybeSingle"] = maybeSingleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ServicioService.cambiarEstado(SVC_ID, false, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("A3 — RN-SV3: el guard de turnos futuros filtra por tenant_id", async () => {
    // La consulta corre con service role (RLS bypasseada). Sin `tenant_id`
    // contaba los turnos de TODAS las clínicas que apunten al mismo
    // servicio_id: un turno ajeno bloqueaba la baja acá y, de paso, confirmaba
    // su existencia. `turnos.servicio_id` referencia `servicios(id)` a secas,
    // así que la integridad referencial no lo impide.
    // Se registra cada `.eq()` junto a la tabla del `.from()` que lo precede,
    // para poder afirmar sobre la consulta a `turnos` en particular.
    const db: Record<string, unknown> = {};
    const filtros: Array<{ tabla: string; col: string; val: unknown }> = [];
    let tablaActual = "";

    db["from"]   = vi.fn().mockImplementation((t: string) => { tablaActual = t; return db; });
    db["select"] = vi.fn().mockReturnValue(db);
    db["update"] = vi.fn().mockReturnValue(db);
    db["gte"]    = vi.fn().mockReturnValue(db);
    db["order"]  = vi.fn().mockReturnValue(db);
    db["eq"]     = vi.fn().mockImplementation((col: string, val: unknown) => {
      filtros.push({ tabla: tablaActual, col, val });
      return db;
    });
    db["range"]  = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    db["single"] = vi.fn().mockResolvedValue({
      data: { id: SVC_ID, tenant_id: TENANT_ID, nombre: "Consulta", tipo: "clinica",
              duracion_minutos: 30, requiere_profesional: true, descripcion: null,
              activo: true, created_at: "2026-06-22T00:00:00Z" },
      error: null,
    });
    db["maybeSingle"] = vi.fn().mockResolvedValue({ data: null, error: null });

    mockGetServiceDb.mockReturnValue(db as never);

    await ServicioService.cambiarEstado(SVC_ID, false, ctx);

    const filtrosTurnos = filtros.filter((f) => f.tabla === "turnos");
    expect(filtrosTurnos.length).toBeGreaterThan(0);
    expect(filtrosTurnos).toContainEqual({ tabla: "turnos", col: "servicio_id", val: SVC_ID });
    expect(filtrosTurnos).toContainEqual({ tabla: "turnos", col: "tenant_id", val: TENANT_ID });
  });

  // ── RN-SV4 ────────────────────────────────────────────────────────────────

  it("RN-SV4: crearServicio con requiereProfesional=false persiste el valor correctamente", async () => {
    const filaDb = {
      id:                   SVC_ID,
      tenant_id:            TENANT_ID,
      nombre:               "Baño y Corte",
      tipo:                 "peluqueria",
      duracion_minutos:     60,
      requiere_profesional: false,
      descripcion:          null,
      activo:               true,
      created_at:           "2026-06-22T00:00:00Z",
    };

    // Pre-query nombre duplicado → null (no existe)
    const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
    // INSERT devuelve la fila persistida
    const singleFn = vi.fn().mockResolvedValue({ data: filaDb, error: null });

    const db: Record<string, unknown> = {};
    db["from"]       = vi.fn().mockReturnValue(db);
    db["select"]     = vi.fn().mockReturnValue(db);
    db["insert"]     = vi.fn().mockReturnValue(db);
    db["eq"]         = vi.fn().mockReturnValue(db);
    db["ilike"]      = vi.fn().mockReturnValue(db);
    db["single"]     = singleFn;
    db["maybeSingle"] = maybeSingleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    const result = await ServicioService.crear(
      { ...dtoValido, nombre: "Baño y Corte", tipo: "peluqueria", duracionMinutos: 60, requiereProfesional: false },
      ctx,
    );

    expect(result.requiereProfesional).toBe(false);

    // Verifica que el INSERT recibió requiere_profesional=false (no hardcodeado a true).
    const insertCall = (db["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(insertCall["requiere_profesional"]).toBe(false);
  });

  // ── RN-SV5 ────────────────────────────────────────────────────────────────

  it("RN-SV5: tenantId se toma del ctx, nunca del dto", async () => {
    const filaDb = {
      id: SVC_ID, tenant_id: TENANT_ID, nombre: "RxTestNombre", tipo: "clinica",
      duracion_minutos: 30, requiere_profesional: true, descripcion: null,
      activo: true, created_at: "2026-06-22T00:00:00Z",
    };

    const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const singleFn      = vi.fn().mockResolvedValue({ data: filaDb, error: null });

    const db: Record<string, unknown> = {};
    db["from"]       = vi.fn().mockReturnValue(db);
    db["select"]     = vi.fn().mockReturnValue(db);
    db["insert"]     = vi.fn().mockReturnValue(db);
    db["eq"]         = vi.fn().mockReturnValue(db);
    db["ilike"]      = vi.fn().mockReturnValue(db);
    db["single"]     = singleFn;
    db["maybeSingle"] = maybeSingleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    // El dto no lleva tenantId; el ctx sí.
    await ServicioService.crear({ ...dtoValido, nombre: "RxTestNombre" }, ctx);

    const insertCall = (db["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    // El INSERT debe usar el tenantId del ctx, no de ningún otro origen.
    expect(insertCall["tenant_id"]).toBe(TENANT_ID);
    // Confirmar que el dto no expone un campo tenantId que pudiera usarse.
    expect("tenantId" in dtoValido).toBe(false);
  });

  // ── RN-SV6/SV7 ────────────────────────────────────────────────────────────

  it("RN-SV6/SV7: crearServicio llama recordAudit con module='services' y action='CREATE'", async () => {
    const filaDb = {
      id: SVC_ID, tenant_id: TENANT_ID, nombre: "Consulta General",
      tipo: "clinica", duracion_minutos: 30, requiere_profesional: true,
      descripcion: "Revisación básica", activo: true, created_at: "2026-06-22T00:00:00Z",
    };

    const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
    const singleFn      = vi.fn().mockResolvedValue({ data: filaDb, error: null });

    const db: Record<string, unknown> = {};
    db["from"]       = vi.fn().mockReturnValue(db);
    db["select"]     = vi.fn().mockReturnValue(db);
    db["insert"]     = vi.fn().mockReturnValue(db);
    db["eq"]         = vi.fn().mockReturnValue(db);
    db["ilike"]      = vi.fn().mockReturnValue(db);
    db["single"]     = singleFn;
    db["maybeSingle"] = maybeSingleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    await ServicioService.crear(dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("services");
    expect(auditArg.action).toBe("CREATE");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.entityId).toBe(SVC_ID);
  });

  it("RN-SV7: actualizar servicio llama recordAudit con module='services' y action='UPDATE'", async () => {
    const filaDb = {
      id: SVC_ID, tenant_id: TENANT_ID, nombre: "Consulta General",
      tipo: "clinica", duracion_minutos: 30, requiere_profesional: true,
      descripcion: "Revisación básica", activo: true, created_at: "2026-06-22T00:00:00Z",
    };
    const db = buildDbChain({ singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    await ServicioService.actualizar(SVC_ID, { descripcion: "Nueva descripción" }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("services");
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.entityId).toBe(SVC_ID);
  });

  // El dominio de servicios no tiene DELETE físico: la baja es soft-disable vía
  // cambiarEstado(false) (ya cubierto en RN-SV3), auditado como UPDATE. Este caso
  // cubre el camino feliz de reactivar (activo=true), sin turnos futuros a chequear.
  it("RN-SV3/RN-SV7: cambiarEstado(true) reactiva y llama recordAudit con action='UPDATE'", async () => {
    const filaDb = {
      id: SVC_ID, tenant_id: TENANT_ID, nombre: "Consulta General",
      tipo: "clinica", duracion_minutos: 30, requiere_profesional: true,
      descripcion: null, activo: false, created_at: "2026-06-22T00:00:00Z",
    };
    const db = buildDbChain({ singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    await ServicioService.cambiarEstado(SVC_ID, true, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("services");
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.entityId).toBe(SVC_ID);
  });
});
