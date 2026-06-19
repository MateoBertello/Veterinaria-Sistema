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
import { MascotasService } from "../../supabase/functions/api/src/modules/mascotas/mascotas.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID      = "11111111-1111-4111-8111-111111111111";
const CALLER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID      = "33333333-3333-4333-8333-333333333333";
const ESPECIE_ID     = "44444444-4444-4444-8444-444444444444";
const RAZA_ID        = "55555555-5555-4555-8555-555555555555";
const PET_ID         = "66666666-6666-4666-8666-666666666666";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: CALLER_USER_ID,
  callerName:   "Recepción Uno",
  callerRole:   "recepcionista",
};

const dtoValido = {
  name:          "Firulais",
  clientId:      CLIENT_ID,
  especieId:     ESPECIE_ID,
  razaId:        RAZA_ID,
  sex:           "Macho" as const,
  tamano:        "Mediano" as const,
  alimentoDieta: "Croquetas premium",
  birthDate:     "2020-05-01",
  color:         "Marrón",
  observations:  "Tranquilo",
};

/** Fila tal como la devuelve la DB (snake_case + embeds). */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id:             PET_ID,
  tenant_id:      TENANT_ID,
  name:           "Firulais",
  client_id:      CLIENT_ID,
  especie_id:     ESPECIE_ID,
  raza_id:        RAZA_ID,
  sex:            "Macho",
  tamano:         "Mediano",
  alimento_dieta: "Croquetas premium",
  birth_date:     "2020-05-01",
  color:          "Marrón",
  observations:   "Tranquilo",
  estado:         "Activa",
  deceased_date:  null,
  deleted:        false,
  created_at:     "2026-06-19T12:00:00Z",
  cliente:        { full_name: "María García" },
  especie:        { name: "Perro" },
  raza:           { name: "Labrador" },
  ...over,
});

// ─── Mock de DB con cola de resultados (mismo patrón que clientes.service.test) ─

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () => singleQueue.shift() ?? { data: null, error: null };

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

// ─── RN-MA1: campos obligatorios ──────────────────────────────────────────────

describe("RN-MA1: Campos obligatorios", () => {
  for (const campo of ["name", "clientId", "especieId", "sex", "tamano"] as const) {
    it(`RN-MA1: falta ${campo} → VALIDATION_ERROR`, async () => {
      const db = buildMockDb();
      mockGetServiceDb.mockReturnValue(db as never);

      const { [campo]: _omit, ...incompleto } = dtoValido;

      await expect(
        MascotasService.crear(incompleto as typeof dtoValido, ctx),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
      expect(db.builder["insert"]).not.toHaveBeenCalled();
    });
  }
});

// ─── RN-MA8: tamaño tipado ─────────────────────────────────────────────────────

describe("RN-MA8: Tamaño por ENUM", () => {
  it("RN-MA8: tamano fuera del ENUM → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear({ ...dtoValido, tamano: "Enorme" as never }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });
});

// ─── RN-MA2: coherencia raza/especie ───────────────────────────────────────────

describe("RN-MA2: Coherencia raza/especie", () => {
  it("RN-MA2: razaId que no pertenece a la especie → VALIDATION_ERROR", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null }, // cliente del tenant existe
        { data: null, error: null },              // raza no pertenece a la especie
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });
});

// ─── RN-MA9: dieta máx. 500 + fallback ─────────────────────────────────────────

describe("RN-MA9: Alimento/dieta", () => {
  it("RN-MA9: alimentoDieta de más de 500 chars → VALIDATION_ERROR", async () => {
    const db = buildMockDb();
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear({ ...dtoValido, alimentoDieta: "x".repeat(501) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('RN-MA9: dieta vacía → persiste el fallback "Sin indicaciones de dieta"', async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },                       // cliente
        { data: { id: RAZA_ID }, error: null },                         // raza coherente
        { data: dbRow({ alimento_dieta: "Sin indicaciones de dieta" }), error: null }, // insert+select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { alimentoDieta: _omit, ...sinDieta } = dtoValido;
    await MascotasService.crear(sinDieta as typeof dtoValido, ctx);

    const payload = (db.builder["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.alimento_dieta).toBe("Sin indicaciones de dieta");
  });
});

// ─── RN-MA10: estado por ENUM ──────────────────────────────────────────────────

describe("RN-MA10: Estado por ENUM", () => {
  it("RN-MA10: alta queda con estado 'Activa' y sin flag booleano deceased", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },
        { data: { id: RAZA_ID }, error: null },
        { data: dbRow(), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const mascota = await MascotasService.crear(dtoValido, ctx);
    expect(mascota.estado).toBe("Activa");

    const payload = (db.builder["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("deceased");
  });
});

// ─── Cross-tenant: cliente de otro tenant ──────────────────────────────────────

describe("FK cross-tenant", () => {
  it("crear contra un cliente inexistente en el tenant → FORBIDDEN (no inserta)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }], // cliente no encontrado en el tenant
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      MascotasService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
    expect(db.builder["insert"]).not.toHaveBeenCalled();
  });
});

// ─── RN-MA4: fecha de nacimiento inmutable ─────────────────────────────────────

describe("RN-MA4: Fecha de nacimiento inmutable", () => {
  it("RN-MA4: editar nunca incluye birth_date en el payload de update", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },                          // carga de la mascota actual
        { data: dbRow({ tamano: "Grande" }), error: null },      // update + select
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    // birthDate viene en el body pero el schema lo descarta (RN-MA4).
    await MascotasService.editar(PET_ID, { tamano: "Grande", birthDate: "1999-01-01" } as never, ctx);

    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("birth_date");
    expect(payload).toMatchObject({ tamano: "Grande" });
  });
});

// ─── RN-MA7: auditoría módulo pets ─────────────────────────────────────────────

describe("RN-MA7: Auditoría de alta y edición (módulo pets)", () => {
  it("RN-MA7: crear registra auditoría CREATE en módulo pets", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: { id: CLIENT_ID }, error: null },
        { data: { id: RAZA_ID }, error: null },
        { data: dbRow(), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.crear(dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("CREATE");
    expect(audit.module).toBe("pets");
    expect(audit.tenantId).toBe(TENANT_ID);
    expect(audit.entityId).toBe(PET_ID);
  });

  it("RN-MA7: editar registra auditoría UPDATE con oldValues y newValues", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },
        { data: dbRow({ name: "Firu" }), error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.editar(PET_ID, { name: "Firu" }, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const audit = mockRecordAudit.mock.calls[0][1];
    expect(audit.action).toBe("UPDATE");
    expect(audit.module).toBe("pets");
    expect(audit.oldValues).toBeDefined();
    expect(audit.newValues).toBeDefined();
  });
});

// ─── RN-MA6: baja lógica ───────────────────────────────────────────────────────

describe("RN-MA6: Baja lógica", () => {
  it("RN-MA6: eliminar marca deleted=true y audita DELETE en pets", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dbRow(), error: null },            // carga de la mascota
        { data: { id: PET_ID }, error: null },     // update (baja lógica)
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await MascotasService.eliminar(PET_ID, ctx);

    expect(db.builder["update"]).toHaveBeenCalledOnce();
    const payload = (db.builder["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({ deleted: true });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit.mock.calls[0][1].action).toBe("DELETE");
    expect(mockRecordAudit.mock.calls[0][1].module).toBe("pets");
  });
});

// ─── Listado: excluye eliminados y embebe el dueño ─────────────────────────────

describe("Listado de mascotas", () => {
  it("listar excluye deleted=true y resuelve el dueño con embed (sin N+1)", async () => {
    const db = buildMockDb({
      rangeResult: { data: [dbRow()], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items, total } = await MascotasService.listar(TENANT_ID, { page: 1, limit: 20 });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].ownerName).toBe("María García");
    expect(db.builder["eq"]).toHaveBeenCalledWith("deleted", false);

    // El dueño se resuelve en la misma consulta (embed), no por fila.
    const selectArg = (db.builder["select"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).toContain("cliente:clientes");
  });
});
