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
import { AuditoriaService } from "../../supabase/functions/api/src/modules/auditoria/auditoria.service.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID   = "22222222-2222-4222-8222-222222222222";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: USER_ID,
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

function registroRow(overrides: Record<string, unknown> = {}) {
  return {
    id:         "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenant_id:  TENANT_ID,
    user_id:    USER_ID,
    user_name:  "Admin Leo",
    user_role:  "admin",
    action:     "CREATE",
    module:     "clients",
    entity_id:  "ent-001",
    old_values: null,
    new_values: null,
    details:    "detail text",
    ip_address: "127.0.0.1",
    timestamp:  "2026-06-22T10:00:00Z",
    ...overrides,
  };
}

function buildDbChain(overrides: {
  countData?: unknown[];
  count?:     number;
  selectError?: { message: string } | null;
} = {}) {
  const chain: Record<string, unknown> = {};

  const rangeFn = vi.fn().mockResolvedValue({
    data:  overrides.countData ?? [],
    error: overrides.selectError ?? null,
    count: overrides.count ?? 0,
  });

  chain["from"]   = vi.fn().mockReturnValue(chain);
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockReturnValue(chain);
  chain["ilike"]  = vi.fn().mockReturnValue(chain);
  chain["gte"]    = vi.fn().mockReturnValue(chain);
  chain["lte"]    = vi.fn().mockReturnValue(chain);
  chain["order"]  = vi.fn().mockReturnValue(chain);
  chain["range"]  = rangeFn;

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuditoriaService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-AUD5: paginación ────────────────────────────────────────────────────

  it("RN-AUD5: buscarPaginado sin filtros retorna página 1 con meta correcta", async () => {
    const rows = [registroRow(), registroRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })];
    const db   = buildDbChain({ countData: rows, count: 2 });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await AuditoriaService.buscarPaginado(
      { page: 1, limit: 20 },
      ctx,
    );

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    // range debe llamarse con el offset correcto para page=1
    expect((db["range"] as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([0, 19]);
  });

  it("RN-AUD5: buscarPaginado filtra por módulo → eq('module', ...)", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.buscarPaginado({ page: 1, limit: 20, module: "pets" }, ctx);

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(eqCalls).toContainEqual(["module", "pets"]);
  });

  it("RN-AUD5: buscarPaginado filtra por acción → eq('action', ...)", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.buscarPaginado({ page: 1, limit: 20, action: "DELETE" }, ctx);

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(eqCalls).toContainEqual(["action", "DELETE"]);
  });

  it("RN-AUD5: buscarPaginado filtra por userId → eq('user_id', ...)", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.buscarPaginado({ page: 1, limit: 20, userId: USER_ID }, ctx);

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(eqCalls).toContainEqual(["user_id", USER_ID]);
  });

  it("RN-AUD5: buscarPaginado filtra por dateFrom/dateTo → gte/lte en 'timestamp'", async () => {
    const db = buildDbChain({ countData: [], count: 0 });
    mockGetServiceDb.mockReturnValue(db as never);

    const dateFrom = "2026-01-01T00:00:00Z";
    const dateTo   = "2026-12-31T23:59:59Z";
    await AuditoriaService.buscarPaginado({ page: 1, limit: 20, dateFrom, dateTo }, ctx);

    expect((db["gte"] as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["timestamp", dateFrom]);
    expect((db["lte"] as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["timestamp", dateTo]);
  });

  it("RN-AUD5: buscarPaginado filtra por search → ilike('user_name', '%term%')", async () => {
    const db = buildDbChain({ countData: [], count: 0 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.buscarPaginado({ page: 1, limit: 20, search: "john" }, ctx);

    expect((db["ilike"] as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["user_name", "%john%"]);
  });

  it("RN-AUD5: buscarPaginado siempre filtra por tenant_id del ctx (nunca de otro origen)", async () => {
    const db = buildDbChain({ countData: [], count: 0 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.buscarPaginado({ page: 1, limit: 20 }, ctx);

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls as [string, unknown][];
    expect(eqCalls).toContainEqual(["tenant_id", TENANT_ID]);
  });

  // ── exportarCsv ───────────────────────────────────────────────────────────

  it("exportarCsv: retorna string CSV con línea de encabezados", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    const { csv } = await AuditoriaService.exportarCsv({}, ctx);

    expect(typeof csv).toBe("string");
    // La primera línea es el encabezado
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toContain("id");
    expect(firstLine).toContain("timestamp");
    expect(firstLine).toContain("module");
    expect(firstLine).toContain("action");
    expect(firstLine).toContain("userName");
  });

  it("exportarCsv llama recordAudit con action='EXPORT' y module='security' (RN-AUD1)", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 1 });
    mockGetServiceDb.mockReturnValue(db as never);

    await AuditoriaService.exportarCsv({}, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("EXPORT");
    expect(auditArg.module).toBe("security");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.userId).toBe(USER_ID);
  });

  it("exportarCsv: truncated=true y totalMatching correcto cuando count > EXPORT_LIMIT", async () => {
    const EXPORT_LIMIT = 10_000;
    // Simular que el total es mayor al límite
    const db = buildDbChain({ countData: [], count: EXPORT_LIMIT + 500 });
    mockGetServiceDb.mockReturnValue(db as never);

    const { truncated, totalMatching } = await AuditoriaService.exportarCsv({}, ctx);

    expect(truncated).toBe(true);
    expect(totalMatching).toBe(EXPORT_LIMIT + 500);
  });

  it("exportarCsv: truncated=false cuando count <= EXPORT_LIMIT", async () => {
    const db = buildDbChain({ countData: [registroRow()], count: 42 });
    mockGetServiceDb.mockReturnValue(db as never);

    const { truncated, totalMatching } = await AuditoriaService.exportarCsv({}, ctx);

    expect(truncated).toBe(false);
    expect(totalMatching).toBe(42);
  });

  // ── RN-AUD2: inmutabilidad ─────────────────────────────────────────────────

  it("RN-AUD2: AuditoriaService no expone métodos de escritura (insert/update/delete)", () => {
    const keys = Object.keys(AuditoriaService);
    expect(keys).not.toContain("crear");
    expect(keys).not.toContain("actualizar");
    expect(keys).not.toContain("eliminar");
    expect(keys).not.toContain("insertar");
  });
});
