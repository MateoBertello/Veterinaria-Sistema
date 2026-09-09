import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { TenantService } from "../../supabase/functions/api/src/modules/admin/tenants.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SA_CTX = { superAdminId: "sa-1", superAdminName: "Super Admin" };

const tenantRow = (over: Record<string, unknown> = {}) => ({
  id:             TENANT_ID,
  nombre:         "Clínica Demo",
  cuit_rut:       "30-12345678-9",
  email_contacto: "demo@clinica.com",
  plan:           "basico",
  activo:         true,
  admin_invitado: false,
  created_at:     "2026-06-18T00:00:00Z",
  ...over,
});

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
  rpcResult?:     { data: unknown; error: unknown };
  inviteResult?:  { error: { message: string } | null };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder["select"] = vi.fn(chain);
  builder["update"] = vi.fn(chain);
  builder["insert"] = vi.fn(chain);
  builder["eq"]     = vi.fn(chain);
  builder["or"]     = vi.fn(chain);
  builder["order"]  = vi.fn(chain);
  builder["range"]  = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );
  builder["single"] = vi.fn().mockImplementation(async () =>
    singleQueue.shift() ?? { data: null, error: { message: "no more single results" } },
  );

  const db = {
    from: vi.fn(() => builder),
    rpc:  vi.fn().mockResolvedValue(opts.rpcResult ?? { data: tenantRow(), error: null }),
    auth: {
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue(opts.inviteResult ?? { error: null }),
      },
    },
  };
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ─── RN-SA1 ───────────────────────────────────────────────────────────────────

describe("RN-SA1: unicidad fiscal", () => {
  it("RN-SA1: cuit_rut duplicado → TENANT_DUPLICATE_TAXID (409)", async () => {
    const db = buildMockDb({ singleResults: [{ data: { id: "otro" }, error: null }] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TenantService.crear(
        { nombre: "X Clínica", cuitRut: "30-12345678-9", emailContacto: "x@x.com", plan: "basico" },
        SA_CTX,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TENANT_DUPLICATE_TAXID, statusCode: 409 });

    expect(db.rpc).not.toHaveBeenCalled();
  });
});

// ─── RN-SA2 ───────────────────────────────────────────────────────────────────

describe("RN-SA2: alta atómica del tenant, sin invitación por mail", () => {
  it("RN-SA2: crear invoca rpc('crear_tenant') una sola vez (alta atómica)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: null, error: null },        // precheck cuit_rut
      ],
      rpcResult: { data: tenantRow(), error: null },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await TenantService.crear(
      { nombre: "Clínica Demo", cuitRut: "30-12345678-9", emailContacto: "demo@clinica.com", plan: "basico" },
      SA_CTX,
    );

    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith("crear_tenant", expect.objectContaining({
      p_nombre: "Clínica Demo",
      p_cuit_rut: "30-12345678-9",
    }));
    expect(result.id).toBe(TENANT_ID);
  });

  /**
   * El alta NO manda ningún mail y no crea ninguna cuenta de Auth.
   *
   * `inviteUserByEmail` mandaba el `tenant_id` a `user_metadata` —donde la API
   * no lo lee— y no creaba fila en `usuarios`, así que el invitado nunca podía
   * entrar; mientras tanto, cada alta dejaba una cuenta huérfana en `auth.users`.
   * Este assert es la contraparte unitaria del test de integración que cuenta
   * filas en `auth.users` antes y después del alta.
   */
  it("RN-SA2: crear NO invita por email (la invitación se sacó del alta)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
      rpcResult:     { data: tenantRow(), error: null },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TenantService.crear(
      { nombre: "Clínica Demo", cuitRut: "30-12345678-9", emailContacto: "demo@clinica.com", plan: "basico" },
      SA_CTX,
    );

    expect(db.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("RN-SA2: el tenant nace sin administrador (adminInvitado=false)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
      rpcResult:     { data: tenantRow(), error: null },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await TenantService.crear(
      { nombre: "Clínica Demo", cuitRut: "30-12345678-9", emailContacto: "demo@clinica.com", plan: "basico" },
      SA_CTX,
    );

    expect(result.adminInvitado).toBe(false);
  });
});

// ─── RN-SA4 ───────────────────────────────────────────────────────────────────

describe("RN-SA4: aislamiento de datos de negocio", () => {
  it("RN-SA4: el DTO de listado solo incluye metadatos comerciales (sin clientes/mascotas)", async () => {
    const db = buildMockDb({
      rangeResult: { data: [tenantRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await TenantService.buscarPaginado({ page: 1, limit: 20 });

    expect(items).toHaveLength(1);
    const keys = Object.keys(items[0]);
    expect(keys.sort()).toEqual(
      ["activo", "adminInvitado", "createdAt", "cuitRut", "emailContacto", "id", "nombre", "plan"].sort(),
    );
    // Nunca expone entidades de negocio del tenant.
    expect(keys).not.toContain("clientes");
    expect(keys).not.toContain("mascotas");
  });
});

// ─── RN-SA5 ───────────────────────────────────────────────────────────────────

describe("RN-SA5: auditoría de plataforma", () => {
  it("RN-SA5: crear audita CREATE con module='platform'", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TenantService.crear(
      { nombre: "Clínica Demo", cuitRut: "30-12345678-9", emailContacto: "demo@clinica.com", plan: "basico" },
      SA_CTX,
    );

    const call = mockRecordAudit.mock.calls.at(-1)![1];
    expect(call.action).toBe("CREATE");
    expect(call.module).toBe("platform");
    expect(call.tenantId).toBeNull();
    expect(call.userId).toBe("sa-1");
  });

  it("RN-SA5: cambiarEstado audita UPDATE con module='platform'", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: tenantRow({ activo: true }), error: null },
        { data: tenantRow({ activo: false }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await TenantService.cambiarEstado(TENANT_ID, false, SA_CTX);

    const call = mockRecordAudit.mock.calls.at(-1)![1];
    expect(call.action).toBe("UPDATE");
    expect(call.module).toBe("platform");
    expect(call.newValues).toMatchObject({ activo: false });
  });
});
