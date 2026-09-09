import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import {
  ProveedorService,
  assertProveedorActivo,
} from "../../supabase/functions/api/src/modules/proveedores/proveedores.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit = vi.mocked(recordAudit);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PROV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctx = {
  tenantId: TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName: "Admin Commercial",
  callerRole: "admin",
};

const dtoValido = {
  razonSocial: "Distribuidora Veterinaria Sur S.A.",
  nombreFantasia: "VetSur",
  cuit: "30-71234567-8",
  condicionFiscal: "responsable_inscripto" as const,
  telefono: "11-4444-5555",
  email: "ventas@vetsur.com",
  direccion: "Av. Principal 123",
  contactoNombre: "Juan Perez",
  observaciones: "Entrega los martes",
};

function buildDbChain(overrides: {
  maybeSingleData?: unknown;
  singleData?: unknown;
  singleError?: { message: string; code?: string } | null;
  count?: number;
  data?: unknown[];
} = {}) {
  const chain: Record<string, unknown> = {};
  const defaultData = overrides.singleData ?? overrides.maybeSingleData ?? null;

  const singleFn = vi.fn().mockResolvedValue({
    data: overrides.singleData !== undefined ? overrides.singleData : defaultData,
    error: overrides.singleError ?? null,
  });
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: overrides.maybeSingleData !== undefined ? overrides.maybeSingleData : defaultData,
    error: overrides.singleError ?? null,
  });

  const rangeFn = vi.fn().mockResolvedValue({
    data: overrides.data ?? [],
    error: null,
    count: overrides.count ?? 0,
  });

  chain["from"] = vi.fn().mockReturnValue(chain);
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["insert"] = vi.fn().mockReturnValue(chain);
  chain["update"] = vi.fn().mockReturnValue(chain);
  chain["delete"] = vi.fn().mockReturnValue(chain);
  chain["eq"] = vi.fn().mockReturnValue(chain);
  chain["neq"] = vi.fn().mockReturnValue(chain);
  chain["ilike"] = vi.fn().mockReturnValue(chain);
  chain["order"] = vi.fn().mockReturnValue(chain);
  chain["range"] = rangeFn;
  chain["single"] = singleFn;
  chain["maybeSingle"] = maybeSingleFn;

  return chain;
}

describe("ProveedorService & Guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RN-PRV1: razón social duplicada se rechaza con 409 SUPPLIER_DUPLICATE", async () => {
    // 1. Pre-query encuentra razón social
    const dbPre = buildDbChain({ maybeSingleData: { id: "otro-id", razon_social: dtoValido.razonSocial } });
    mockGetServiceDb.mockReturnValue(dbPre as never);

    await expect(ProveedorService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.SUPPLIER_DUPLICATE,
      statusCode: 409,
    });

    // 2. Pre-query vacía pero INSERT lanza 23505
    const dbErr = buildDbChain({
      maybeSingleData: null,
      singleError: { message: "duplicate key value violates unique constraint uq_proveedores_tenant_razon_social", code: "23505" },
    });
    mockGetServiceDb.mockReturnValue(dbErr as never);

    await expect(ProveedorService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.SUPPLIER_DUPLICATE,
      statusCode: 409,
    });
  });

  it("RN-PRV1: CUIT duplicado en el mismo tenant se rechaza con 409 SUPPLIER_DUPLICATE", async () => {
    // Pre-query encuentra cuit
    let call = 0;
    const db: Record<string, unknown> = {};
    db["from"] = vi.fn().mockReturnValue(db);
    db["select"] = vi.fn().mockReturnValue(db);
    db["eq"] = vi.fn().mockReturnValue(db);
    db["ilike"] = vi.fn().mockReturnValue(db);
    db["maybeSingle"] = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ data: null, error: null }); // razon social check ok
      return Promise.resolve({ data: { id: "otro-id", cuit: dtoValido.cuit }, error: null }); // cuit check colisiona
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(ProveedorService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.SUPPLIER_DUPLICATE,
      statusCode: 409,
    });
  });

  it("RN-PRV2: un proveedor inactivo no recibe compras", async () => {
    // Inactivo -> SUPPLIER_INACTIVE
    const dbInactivo = buildDbChain({ maybeSingleData: { id: PROV_ID, activo: false } });
    mockGetServiceDb.mockReturnValue(dbInactivo as never);
    await expect(assertProveedorActivo(PROV_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.SUPPLIER_INACTIVE,
      statusCode: 422,
    });

    // Activo -> ok
    const dbActivo = buildDbChain({ maybeSingleData: { id: PROV_ID, activo: true } });
    mockGetServiceDb.mockReturnValue(dbActivo as never);
    await expect(assertProveedorActivo(PROV_ID, TENANT_ID)).resolves.toBeUndefined();

    // Inexistente -> SUPPLIER_NOT_FOUND
    const dbNotFound = buildDbChain({ maybeSingleData: null });
    mockGetServiceDb.mockReturnValue(dbNotFound as never);
    await expect(assertProveedorActivo(PROV_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.SUPPLIER_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("RN-SC1: clienteId de otro tenant es rechazado con 422 VALIDATION_ERROR", async () => {
    // Mock donde la búsqueda de cliente en este tenant devuelve null (no existe o es de otro tenant)
    const db = buildDbChain({ maybeSingleData: null });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ProveedorService.crear({ ...dtoValido, clienteId: CLIENTE_ID }, ctx),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: 422,
    });
  });

  it("RN-SC5: toda escritura deja asiento con module suppliers", async () => {
    const filaDb = {
      id: PROV_ID,
      tenant_id: TENANT_ID,
      razon_social: dtoValido.razonSocial,
      cuit: dtoValido.cuit,
      activo: true,
      created_at: "2026-09-01T00:00:00Z",
    };

    const db = buildDbChain({ maybeSingleData: null, singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    await ProveedorService.crear(dtoValido, ctx);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ module: "suppliers", action: "CREATE" }),
    );

    mockRecordAudit.mockClear();

    // Si falla el INSERT, no se llama recordAudit
    const dbFail = buildDbChain({
      maybeSingleData: null,
      singleError: { message: "DB Error", code: "50000" },
    });
    mockGetServiceDb.mockReturnValue(dbFail as never);

    await expect(ProveedorService.crear(dtoValido, ctx)).rejects.toThrow();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
