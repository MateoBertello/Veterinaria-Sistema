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
import { ConfiguracionService } from "../../supabase/functions/api/src/modules/configuracion/configuracion.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

const filaDefault = {
  id:                 "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  tenant_id:          TENANT_ID,
  cupo_maximo_diario: 10,
  dias_aviso_vacuna:  7,
  parametros_extra:   {},
  updated_at:         "2026-06-22T00:00:00Z",
};

/** Helper para construir un mock de DB con la cadena builder de supabase-js. */
function buildDbChain(overrides: {
  maybeSingleData?: unknown;
  singleData?:      unknown;
  singleError?:     { message: string } | null;
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

  chain["from"]        = vi.fn().mockReturnValue(chain);
  chain["select"]      = vi.fn().mockReturnValue(chain);
  chain["update"]      = vi.fn().mockReturnValue(chain);
  chain["eq"]          = vi.fn().mockReturnValue(chain);
  chain["single"]      = singleFn;
  chain["maybeSingle"] = maybeSingleFn;

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConfiguracionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-CF1: GET singleton ─────────────────────────────────────────────────

  it("RN-CF1: obtener devuelve el singleton del tenant con DTO camelCase", async () => {
    const db = buildDbChain({ singleData: filaDefault });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await ConfiguracionService.obtener(TENANT_ID);

    expect(result.cupoMaximoDiario).toBe(10);
    expect(result.diasAvisoVacuna).toBe(7);
    expect(result.parametrosExtra).toEqual({});
    expect(result.updatedAt).toBe("2026-06-22T00:00:00Z");
  });

  it("RN-CF1: obtener lanza CONFIG_NOT_FOUND (404) si la fila no existe (fallo de seeder)", async () => {
    const db = buildDbChain({ singleData: null });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ConfiguracionService.obtener(TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.CONFIG_NOT_FOUND, statusCode: 404 });
  });

  // ── RN-CF2: rangos de validación ──────────────────────────────────────────

  it("RN-CF2: actualizar rechaza cupoMaximoDiario=0 → VALIDATION_ERROR 422", async () => {
    const db = buildDbChain({ singleData: filaDefault });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ConfiguracionService.actualizar(TENANT_ID, { cupoMaximoDiario: 0, diasAvisoVacuna: 7 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-CF2: actualizar rechaza cupoMaximoDiario=501 → VALIDATION_ERROR 422", async () => {
    const db = buildDbChain({ singleData: filaDefault });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ConfiguracionService.actualizar(TENANT_ID, { cupoMaximoDiario: 501, diasAvisoVacuna: 7 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-CF2: actualizar rechaza diasAvisoVacuna=0 → VALIDATION_ERROR 422", async () => {
    const db = buildDbChain({ singleData: filaDefault });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ConfiguracionService.actualizar(TENANT_ID, { cupoMaximoDiario: 10, diasAvisoVacuna: 0 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-CF2: actualizar rechaza diasAvisoVacuna=91 → VALIDATION_ERROR 422", async () => {
    const db = buildDbChain({ singleData: filaDefault });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ConfiguracionService.actualizar(TENANT_ID, { cupoMaximoDiario: 10, diasAvisoVacuna: 91 }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("RN-CF2: actualizar acepta valores en rango límite (500 / 90)", async () => {
    const filaActualizada = { ...filaDefault, cupo_maximo_diario: 500, dias_aviso_vacuna: 90 };

    // Primera llamada (SELECT oldValues), segunda (UPDATE RETURNING)
    let callCount = 0;
    const singleFn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        data:  callCount === 1 ? filaDefault : filaActualizada,
        error: null,
      });
    });

    const db: Record<string, unknown> = {};
    db["from"]   = vi.fn().mockReturnValue(db);
    db["select"] = vi.fn().mockReturnValue(db);
    db["update"] = vi.fn().mockReturnValue(db);
    db["eq"]     = vi.fn().mockReturnValue(db);
    db["single"] = singleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    const result = await ConfiguracionService.actualizar(
      TENANT_ID,
      { cupoMaximoDiario: 500, diasAvisoVacuna: 90 },
      ctx,
    );

    expect(result.cupoMaximoDiario).toBe(500);
    expect(result.diasAvisoVacuna).toBe(90);
  });

  // ── RN-CF3: efecto inmediato, no cancela reservas ─────────────────────────

  it("RN-CF3: actualizar no realiza llamadas a tablas de turnos ni estadias", async () => {
    const filaActualizada = { ...filaDefault, cupo_maximo_diario: 15, dias_aviso_vacuna: 14 };
    let callCount = 0;
    const singleFn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        data:  callCount === 1 ? filaDefault : filaActualizada,
        error: null,
      });
    });

    const fromFn = vi.fn();
    const db: Record<string, unknown> = {};
    db["from"]   = fromFn.mockReturnValue(db);
    db["select"] = vi.fn().mockReturnValue(db);
    db["update"] = vi.fn().mockReturnValue(db);
    db["eq"]     = vi.fn().mockReturnValue(db);
    db["single"] = singleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    await ConfiguracionService.actualizar(
      TENANT_ID,
      { cupoMaximoDiario: 15, diasAvisoVacuna: 14 },
      ctx,
    );

    const tablesQueried = fromFn.mock.calls.map((call) => call[0] as string);
    expect(tablesQueried).not.toContain("turnos");
    expect(tablesQueried).not.toContain("estadias");
  });

  // ── RN-CF5: auditoría ─────────────────────────────────────────────────────

  it("RN-CF5: actualizar registra recordAudit con action=UPDATE, module=system, oldValues y newValues", async () => {
    const filaActualizada = { ...filaDefault, cupo_maximo_diario: 20, dias_aviso_vacuna: 14 };
    let callCount = 0;
    const singleFn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        data:  callCount === 1 ? filaDefault : filaActualizada,
        error: null,
      });
    });

    const db: Record<string, unknown> = {};
    db["from"]   = vi.fn().mockReturnValue(db);
    db["select"] = vi.fn().mockReturnValue(db);
    db["update"] = vi.fn().mockReturnValue(db);
    db["eq"]     = vi.fn().mockReturnValue(db);
    db["single"] = singleFn;

    mockGetServiceDb.mockReturnValue(db as never);

    await ConfiguracionService.actualizar(
      TENANT_ID,
      { cupoMaximoDiario: 20, diasAvisoVacuna: 14 },
      ctx,
    );

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.module).toBe("system");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.oldValues).toMatchObject({ cupoMaximoDiario: 10, diasAvisoVacuna: 7 });
    expect(auditArg.newValues).toMatchObject({ cupoMaximoDiario: 20, diasAvisoVacuna: 14 });
  });
});
