import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks declarados ANTES de importar el módulo bajo prueba ─────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { ClientesService } from "../../supabase/functions/api/src/modules/clientes/clientes.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID      = "11111111-1111-1111-1111-111111111111";
const CALLER_USER_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID      = "33333333-3333-3333-3333-333333333333";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: CALLER_USER_ID,
  callerName:   "Recepción Uno",
  callerRole:   "recepcionista",
};

const dtoValido = {
  fullName:     "María García",
  dniCuit:      "20-12345678-9",
  phone:        "+54 11 4567-8900",
  address:      "Av. Libertador 1234",
  email:        "maria@mail.com",
  observations: "Cliente preferencial",
};

/** Fila tal como la devuelve la DB (snake_case). */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id:           CLIENT_ID,
  tenant_id:    TENANT_ID,
  full_name:    "María García",
  dni_cuit:     "20-12345678-9",
  phone:        "+54 11 4567-8900",
  address:      "Av. Libertador 1234",
  email:        "maria@mail.com",
  observations: "Cliente preferencial",
  deleted:      false,
  created_at:   "2026-06-19T12:00:00Z",
  created_by:   CALLER_USER_ID,
  ...over,
});

// ─── Mock de DB con cola de resultados (patrón de tenants.service.test) ───────

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () =>
    singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "insert", "update", "delete", "eq", "neq", "or", "ilike", "order", "limit"]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => next());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => next());
  builder["range"]       = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );

  const db = { from: vi.fn(() => builder), builder };
  return db;
}

beforeEach(() => vi.clearAllMocks());

// ─── RN-CL1: campos obligatorios ──────────────────────────────────────────────

describe("RN-CL1: Campos obligatorios", () => {
  it("RN-CL1: falta address → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    const { address: _omit, ...sinAddress } = dtoValido;

    await expect(
      ClientesService.crear(sinAddress as typeof dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });
});

// ─── RN-CL2: formato DNI/CUIT ──────────────────────────────────────────────────

describe("RN-CL2: Formato DNI/CUIT", () => {
  it("RN-CL2/RN-CL6: dniCuit con letras → VALIDATION_ERROR (paridad backend/front)", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.crear({ ...dtoValido, dniCuit: "20-ABC-9" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-CL4: formato teléfono ──────────────────────────────────────────────────

describe("RN-CL4: Formato teléfono", () => {
  it("RN-CL4: phone con letras → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.crear({ ...dtoValido, phone: "llamar tarde" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-CL5: formato email ─────────────────────────────────────────────────────

describe("RN-CL5: Formato email", () => {
  it("RN-CL5: email inválido → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.crear({ ...dtoValido, email: "no-es-email" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-CL3: unicidad de DNI/CUIT entre no eliminados ─────────────────────────

describe("RN-CL3: Unicidad de DNI/CUIT", () => {
  it("RN-CL3: DNI/CUIT duplicado entre activos → DUPLICATE_DNI (409)", async () => {
    const db = buildMockDb({
      // 1ª query: chequeo de unicidad → existe otro cliente con ese DNI
      singleResults: [{ data: { id: "otro-cliente" }, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.DUPLICATE_DNI, statusCode: 409 });

    // No debe intentar insertar si el DNI ya existe
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });

  it("RN-CL3: editar con el mismo DNI del propio registro no colisiona (excluye su id)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },                 // 1) carga del cliente actual
        { data: null, error: null },                    // 2) unicidad excluyendo el propio id → libre
        { data: dbRow({ full_name: "María G." }), error: null }, // 3) update + select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.editar(CLIENT_ID, { fullName: "María G.", dniCuit: "20-12345678-9" }, ctx),
    ).resolves.toMatchObject({ id: CLIENT_ID });

    // La verificación de unicidad excluye el propio registro (RN-CL3)
    expect(db.builder["neq"]).toHaveBeenCalledWith("id", CLIENT_ID);
  });
});

// ─── RN-CL7: auditoría de escrituras (módulo clients) ─────────────────────────

describe("RN-CL7: Auditoría de alta y edición", () => {
  it("RN-CL7: crear registra auditoría CREATE en módulo clients", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: null, error: null },        // unicidad → libre
        { data: dbRow(), error: null },     // insert + select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ClientesService.crear(dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("CREATE");
    expect(audit.module).toBe("clients");
    expect(audit.tenantId).toBe(TENANT_ID);
    expect(audit.entityId).toBe(CLIENT_ID);
  });

  it("RN-CL7: editar registra auditoría UPDATE con oldValues y newValues", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },                          // carga actual
        { data: dbRow({ full_name: "Nuevo Nombre" }), error: null }, // update + select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ClientesService.editar(CLIENT_ID, { fullName: "Nuevo Nombre" }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("clients");
    expect(audit.oldValues).toBeDefined();
    expect(audit.newValues).toBeDefined();
  });
});

// ─── RN-CL8: integridad referencial al eliminar ───────────────────────────────

describe("RN-CL8: No eliminar cliente con mascotas vivas", () => {
  it("RN-CL8: eliminar con mascota viva → CLIENT_HAS_PETS (409)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },          // carga del cliente
        { data: { id: "pet-viva" }, error: null }, // mascota viva asociada
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      ClientesService.eliminar(CLIENT_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.CLIENT_HAS_PETS, statusCode: 409 });

    // No debe aplicar la baja si hay mascotas vivas
    expect(db.builder["update"]).not.toHaveBeenCalled();
  });
});

// ─── RN-CL9: baja lógica ───────────────────────────────────────────────────────

describe("RN-CL9: Baja lógica", () => {
  it("RN-CL9/RN-CL11: eliminar marca deleted/deleted_at/deleted_by y audita DELETE en módulo clients", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },          // carga del cliente
        { data: null, error: null },             // sin mascotas vivas
        { data: { id: CLIENT_ID }, error: null }, // update (baja lógica)
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ClientesService.eliminar(CLIENT_ID, ctx);

    expect(db.builder["update"]).toHaveBeenCalledOnce();
    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({ deleted: true, deleted_by: CALLER_USER_ID });
    expect(payload.deleted_at).toBeTruthy();

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("DELETE");
    expect(audit.module).toBe("clients");
  });
});

// ─── Listado: excluye eliminados por defecto ──────────────────────────────────

describe("Listado de clientes", () => {
  it("listar excluye clientes con deleted=true por defecto", async () => {
    const db = buildMockDb({
      rangeResult: { data: [dbRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items, total } = await ClientesService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    // El filtro de baja lógica se aplica siempre en el listado por defecto
    expect(db.builder["eq"]).toHaveBeenCalledWith("deleted", false);
  });
});

// ─── RN-CL8: conteo de mascotas vivas en el listado (mismo criterio que el DELETE) ──

describe("RN-CL8: livePetCount en el listado", () => {
  it("el conteo se filtra con la MISMA definición del DELETE: deleted=false AND estado='Activa'", async () => {
    const db = buildMockDb({
      rangeResult: { data: [dbRow({ mascotas: [{ count: 2 }] })], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await ClientesService.listar(TENANT_ID, { page: 1, limit: 20 });

    // El embed cuenta solo mascotas vivas, igual que el bloqueo RN-CL8 del eliminar.
    expect(db.builder["eq"]).toHaveBeenCalledWith("mascotas.deleted", false);
    expect(db.builder["eq"]).toHaveBeenCalledWith("mascotas.estado", "Activa");
  });

  it("cliente con mascota viva → livePetCount ≥ 1", async () => {
    const db = buildMockDb({
      rangeResult: { data: [dbRow({ mascotas: [{ count: 3 }] })], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await ClientesService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(items[0].livePetCount).toBe(3);
    expect(items[0].livePetCount).toBeGreaterThanOrEqual(1);
  });

  it("cliente solo con mascotas fallecidas/eliminadas → livePetCount 0 (excluidas por el filtro)", async () => {
    // El filtro embebido excluye fallecidas/eliminadas, así que el conteo llega en 0.
    const db = buildMockDb({
      rangeResult: { data: [dbRow({ mascotas: [{ count: 0 }] })], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await ClientesService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(items[0].livePetCount).toBe(0);
  });

  it("cliente sin mascotas → APARECE igual en el listado con livePetCount 0 (left join, no lo descarta)", async () => {
    // Embed vacío = sin filas relacionadas; la fila del cliente debe seguir presente.
    const db = buildMockDb({
      rangeResult: { data: [dbRow({ mascotas: [] })], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items, total } = await ClientesService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(CLIENT_ID);
    expect(items[0].livePetCount).toBe(0);
  });
});
