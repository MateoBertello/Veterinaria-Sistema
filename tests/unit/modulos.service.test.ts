import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks de dependencias del Service ──────────────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// Espía de invalidateModuleCache (RN-SM3) sin arrastrar el middleware real.
vi.mock("../../supabase/functions/api/src/middleware/requireModule.ts", () => ({
  invalidateModuleCache: vi.fn(),
}));

import { getDb, getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { invalidateModuleCache } from "../../supabase/functions/api/src/middleware/requireModule.ts";
import { ModuloService } from "../../supabase/functions/api/src/modules/modulos/modulos.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetDb         = vi.mocked(getDb);
const mockGetServiceDb  = vi.mocked(getServiceDb);
const mockRecordAudit   = vi.mocked(recordAudit);
const mockInvalidate    = vi.mocked(invalidateModuleCache);

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SA_CTX    = { superAdminId: "sa-1", superAdminName: "Super Admin" };

const moduloRow = (over: Record<string, unknown> = {}) => ({
  modulo:     "turnos",
  habilitado: true,
  fecha_alta: "2026-01-10",
  ...over,
});

type MockOpts = {
  singleResults?: Array<{ data: unknown; error?: unknown }>;
  orderResult?:   { data: unknown[]; error: unknown };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder["select"] = vi.fn(chain);
  builder["update"] = vi.fn(chain);
  builder["delete"] = vi.fn(chain);
  builder["eq"]     = vi.fn(chain);
  builder["order"]  = vi.fn().mockResolvedValue(
    opts.orderResult ?? { data: [], error: null },
  );
  builder["single"] = vi.fn().mockImplementation(async () =>
    singleQueue.shift() ?? { data: null, error: { message: "no more single results" } },
  );

  const db = { from: vi.fn(() => builder), __builder: builder };
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ─── RN-SM2 ─────────────────────────────────────────────────────────────────

describe("RN-SM2: deshabilitar no borra datos", () => {
  it("RN-SM2: setModulo(false) hace UPDATE habilitado=false y NUNCA delete", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: TENANT_ID }, error: null },          // tenant existe
        { data: moduloRow({ habilitado: true }), error: null }, // estado previo
        { data: moduloRow({ habilitado: false }), error: null }, // resultado update
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await ModuloService.setModulo(TENANT_ID, "turnos", false, SA_CTX);

    const builder = db.__builder as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder["update"]).toHaveBeenCalledWith({ habilitado: false });
    expect(builder["delete"]).not.toHaveBeenCalled();
    expect(result.habilitado).toBe(false);
  });

  it("sella fecha_alta la primera vez que se habilita (fecha_alta previa null)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: TENANT_ID }, error: null },
        { data: moduloRow({ habilitado: false, fecha_alta: null }), error: null },
        { data: moduloRow({ habilitado: true }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ModuloService.setModulo(TENANT_ID, "turnos", true, SA_CTX);

    const builder = db.__builder as Record<string, ReturnType<typeof vi.fn>>;
    const payload = builder["update"].mock.calls[0][0] as Record<string, unknown>;
    expect(payload["habilitado"]).toBe(true);
    expect(typeof payload["fecha_alta"]).toBe("string");
  });
});

// ─── RN-SM3 ─────────────────────────────────────────────────────────────────

describe("RN-SM3: vigencia inmediata (invalidación de caché)", () => {
  it("RN-SM3: setModulo invalida la caché del tenant/módulo tras togglear", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: TENANT_ID }, error: null },
        { data: moduloRow({ habilitado: true }), error: null },
        { data: moduloRow({ habilitado: false }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ModuloService.setModulo(TENANT_ID, "turnos", false, SA_CTX);

    expect(mockInvalidate).toHaveBeenCalledWith(TENANT_ID, "turnos");
  });
});

// ─── RN-SM4 ─────────────────────────────────────────────────────────────────

describe("RN-SM4: auditoría del toggle", () => {
  it("RN-SM4: setModulo audita UPDATE en module='platform' con old/new", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: TENANT_ID }, error: null },
        { data: moduloRow({ habilitado: true }), error: null },
        { data: moduloRow({ habilitado: false }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ModuloService.setModulo(TENANT_ID, "turnos", false, SA_CTX);

    const call = mockRecordAudit.mock.calls.at(-1)![1];
    expect(call.action).toBe("UPDATE");
    expect(call.module).toBe("platform");
    expect(call.tenantId).toBeNull();
    expect(call.entityId).toBe(TENANT_ID);
    expect(call.oldValues).toMatchObject({ modulo: "turnos", habilitado: true });
    expect(call.newValues).toMatchObject({ modulo: "turnos", habilitado: false });
  });
});

// ─── Tenant inexistente ──────────────────────────────────────────────────────

describe("setModulo sobre tenant inexistente", () => {
  it("→ TENANT_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: { message: "not found" } }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ModuloService.setModulo(TENANT_ID, "turnos", true, SA_CTX),
    ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND, statusCode: 404 });
  });
});

// ─── Mapeo camelCase ─────────────────────────────────────────────────────────

describe("habilitadosDelTenant: mapeo a camelCase", () => {
  it("devuelve las 3 filas mapeadas a { modulo, habilitado, fechaAlta }", async () => {
    const db = buildMockDb({
      orderResult: {
        data: [
          moduloRow({ modulo: "guarderia", habilitado: false, fecha_alta: null }),
          moduloRow({ modulo: "historial_clinico", habilitado: true }),
          moduloRow({ modulo: "turnos", habilitado: true }),
        ],
        error: null,
      },
    });
    mockGetDb.mockReturnValue(db as never);

    const result = await ModuloService.habilitadosDelTenant(TENANT_ID, "Bearer x");

    expect(result).toHaveLength(3);
    expect(Object.keys(result[0]).sort()).toEqual(["fechaAlta", "habilitado", "modulo"]);
    expect(result[0]).toMatchObject({ modulo: "guarderia", habilitado: false, fechaAlta: null });
  });
});
