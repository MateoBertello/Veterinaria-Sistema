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
import { DoctorService } from "../../supabase/functions/api/src/modules/doctores/doctores.service.ts";
import { ErrorCode }    from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DOCTOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER_ID   = "22222222-2222-4222-8222-222222222222";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: USER_ID,
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

const filaDb = {
  id:             DOCTOR_ID,
  tenant_id:      TENANT_ID,
  user_id:        USER_ID,
  name:           "Dra. María Fernández",
  specialty:      "Clínica general",
  license_number: "MN-12345",
  available:      true,
  created_at:     "2026-06-22T00:00:00Z",
  usuario:        { username: "mfernandez", full_name: "Dra. María Fernández", active: true },
};

/** Helper para construir un mock de DB con la cadena builder completa. */
function buildDbChain(overrides: {
  singleData?: unknown;
  countData?:  unknown[];
  count?:      number;
} = {}) {
  const chain: Record<string, unknown> = {};

  const singleFn = vi.fn().mockResolvedValue({
    data:  overrides.singleData ?? null,
    error: null,
  });
  const rangeFn = vi.fn().mockResolvedValue({
    data:  overrides.countData ?? [],
    error: null,
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

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DoctorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Listado: embed sin N+1 + mapeo camel ────────────────────────────────────

  it("buscarPaginado: resuelve el usuario por embed en UNA consulta (sin N+1) y mapea a camelCase", async () => {
    const db = buildDbChain({ countData: [filaDb], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items, total } = await DoctorService.buscarPaginado(
      { page: 1, limit: 20, search: undefined, available: undefined },
      TENANT_ID,
    );

    // El select debe pedir el embed del usuario (resource embedding), no iterar por fila.
    const selectArg = (db["select"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).toContain("usuarios!user_id");
    // Una sola llamada a la DB (un único .from) para todo el listado.
    expect((db["from"] as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      id:            DOCTOR_ID,
      userId:        USER_ID,
      licenseNumber: "MN-12345",
      available:     true,
      usuario:       { username: "mfernandez", fullName: "Dra. María Fernández", active: true },
    });
  });

  it("buscarPaginado: filtro available=true se aplica como eq('available', true)", async () => {
    const db = buildDbChain({ countData: [], count: 0 });
    mockGetServiceDb.mockReturnValue(db as never);

    await DoctorService.buscarPaginado(
      { page: 1, limit: 20, search: undefined, available: true },
      TENANT_ID,
    );

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(["available", true]);
  });

  // ── Detalle: guard de tenant ────────────────────────────────────────────────

  it("obtenerPorId: doctor inexistente en el tenant → null", async () => {
    const db = buildDbChain({ singleData: null });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await DoctorService.obtenerPorId(DOCTOR_ID, TENANT_ID);
    expect(result).toBeNull();
  });

  // ── Edición ──────────────────────────────────────────────────────────────────

  it("actualizar: doctor de otro tenant → FORBIDDEN (guard de aislamiento)", async () => {
    const db = buildDbChain({ singleData: null });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      DoctorService.actualizar(DOCTOR_ID, { specialty: "Cirugía" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });

  it("actualizar: mapea camel→snake en el UPDATE y devuelve el DTO en camelCase", async () => {
    const filaActualizada = { ...filaDb, specialty: "Cirugía", license_number: "MN-99999" };
    const db = buildDbChain({ singleData: filaActualizada });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await DoctorService.actualizar(
      DOCTOR_ID,
      { specialty: "Cirugía", licenseNumber: "MN-99999" },
      ctx,
    );

    const updateArg = (db["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg["specialty"]).toBe("Cirugía");
    expect(updateArg["license_number"]).toBe("MN-99999");

    expect(result.specialty).toBe("Cirugía");
    expect(result.licenseNumber).toBe("MN-99999");
  });

  it("actualizar: available=false es la baja lógica (persiste available=false)", async () => {
    const db = buildDbChain({ singleData: { ...filaDb, available: false } });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await DoctorService.actualizar(DOCTOR_ID, { available: false }, ctx);

    const updateArg = (db["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg["available"]).toBe(false);
    expect(result.available).toBe(false);
  });

  it("actualizar: audita UPDATE en módulo 'users' con el tenant del ctx", async () => {
    const db = buildDbChain({ singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    await DoctorService.actualizar(DOCTOR_ID, { name: "Dra. M. Fernández" }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("users");
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.entityId).toBe(DOCTOR_ID);
  });
});
