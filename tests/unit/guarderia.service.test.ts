import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb:        vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/api/src/modules/configuracion/configuracion.service.ts", () => ({
  ConfiguracionService: {
    valor:   vi.fn(),
    obtener: vi.fn(),
  },
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit }  from "../../supabase/functions/api/src/shared/audit.ts";
import { ConfiguracionService } from "../../supabase/functions/api/src/modules/configuracion/configuracion.service.ts";
import { EstadiaService } from "../../supabase/functions/api/src/modules/guarderia/guarderia.service.ts";
import { ErrorCode }    from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);
const mockValor        = vi.mocked(ConfiguracionService.valor);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID  = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PET_ID     = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ESTADIA_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

/** Fecha "YYYY-MM-DD" desplazada N días respecto a hoy (UTC). Robusto al reloj. */
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const dtoValido = {
  clientId:     CLIENT_ID,
  petId:        PET_ID,
  checkInDate:  ymd(10),
  checkOutDate: ymd(12),
  reason:       "Vacaciones del dueño",
  notes:        "Trae su alimento",
};

const filaRpc = {
  id:             ESTADIA_ID,
  client_id:      CLIENT_ID,
  pet_id:         PET_ID,
  check_in_date:  dtoValido.checkInDate,
  check_out_date: dtoValido.checkOutDate,
  status:         "Reservada",
  reason:         dtoValido.reason,
  notes:          dtoValido.notes,
  created_at:     "2026-06-29T10:00:00Z",
  pet_name:       "Firulais",
  pet_tamano:     "Mediano",
  pet_dieta:      "Sin granos",
  client_name:    "Juan Pérez",
};

/**
 * Mock de DB con dos caminos:
 *  - `.rpc(name, params).single()` → { data: rpcData, error: rpcError }
 *  - query builder thenable (`.from().select().eq().in().lte().gte()`) → select result
 */
function buildDb(opts: {
  rpcData?:     unknown;
  rpcError?:    { message: string } | null;
  selectData?:  unknown[];
  selectError?: { message: string } | null;
} = {}) {
  const selectResult = { data: opts.selectData ?? [], error: opts.selectError ?? null };

  // deno-lint-ignore no-explicit-any
  const chain: any = {};
  for (const m of ["from", "select", "eq", "in", "lte", "gte", "order"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Thenable: permite `await db.from(...)...gte(...)`.
  chain.then = (resolve: (v: unknown) => unknown) => resolve(selectResult);
  chain.single = vi.fn().mockResolvedValue(selectResult);

  chain.rpc = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({
      data:  opts.rpcData ?? null,
      error: opts.rpcError ?? null,
    }),
  });

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EstadiaService.crear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-GU1 ──────────────────────────────────────────────────────────────────

  it("RN-GU1: checkOut < checkIn → INVALID_RANGE (422)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb() as never);
    await expect(
      EstadiaService.crear({ ...dtoValido, checkInDate: ymd(10), checkOutDate: ymd(5) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_RANGE, statusCode: 422 });
  });

  it("RN-GU1: checkIn anterior a hoy → PAST_DATE (422)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb() as never);
    await expect(
      EstadiaService.crear({ ...dtoValido, checkInDate: ymd(-1), checkOutDate: ymd(2) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  // ── RN-GU3 ──────────────────────────────────────────────────────────────────

  it("RN-GU3: mascota inexistente / de otro tenant → MASCOTA_NOT_FOUND (404)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcError: { message: "MASCOTA_NOT_FOUND" } }) as never);
    await expect(
      EstadiaService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-GU3: mascota fallecida → PET_DECEASED (422)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcError: { message: "PET_DECEASED" } }) as never);
    await expect(
      EstadiaService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  // ── RN-GU2 ──────────────────────────────────────────────────────────────────

  it("RN-GU2: solape de la misma mascota (exclusion_violation del RPC) → STAY_OVERLAP (409)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcError: { message: "STAY_OVERLAP" } }) as never);
    await expect(
      EstadiaService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_OVERLAP, statusCode: 409 });
  });

  // ── RN-GU4 ──────────────────────────────────────────────────────────────────

  it("RN-GU4: cupo agotado → CUPO_GUARDERIA_AGOTADO (409) con los días en details", async () => {
    const dias = ["2026-07-11", "2026-07-12"];
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: `CUPO_GUARDERIA_AGOTADO:${JSON.stringify(dias)}` } }) as never,
    );
    await expect(
      EstadiaService.crear(dtoValido, ctx),
    ).rejects.toMatchObject({
      code:       ErrorCode.CUPO_GUARDERIA_AGOTADO,
      statusCode: 409,
      details:    dias,
    });
  });

  // ── RN-GU5 / RN-GU7 ─────────────────────────────────────────────────────────

  it("RN-GU5: éxito → estadía 'Reservada' con la tarjeta de la mascota", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: filaRpc }) as never);

    const estadia = await EstadiaService.crear(dtoValido, ctx);

    expect(estadia).toMatchObject({
      id:        ESTADIA_ID,
      status:    "Reservada",
      petName:   "Firulais",
      petTamano: "Mediano",
      petDieta:  "Sin granos",
      clientName: "Juan Pérez",
    });
  });

  it("RN-GU7: éxito → auditoría CREATE en módulo daycare", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: filaRpc }) as never);

    await EstadiaService.crear(dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:   "CREATE",
        module:   "daycare",
        entityId: ESTADIA_ID,
        tenantId: TENANT_ID,
      }),
    );
  });
});

describe("EstadiaService.cupo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("agrega la ocupación por día en UNA sola query (sin N+1) e incluye cupo y disponible", async () => {
    mockValor.mockResolvedValue(2);
    // Dos estadías activas: una cubre 11–13, otra 12–12.
    const db = buildDb({
      selectData: [
        { check_in_date: "2026-07-11", check_out_date: "2026-07-13" },
        { check_in_date: "2026-07-12", check_out_date: "2026-07-12" },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await EstadiaService.cupo("2026-07-11", "2026-07-13", ctx);

    // Una única lectura a estadias (no se consulta por día).
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("estadias");

    expect(result).toEqual([
      { date: "2026-07-11", ocupados: 1, cupo: 2, disponible: 1 },
      { date: "2026-07-12", ocupados: 2, cupo: 2, disponible: 0 },
      { date: "2026-07-13", ocupados: 1, cupo: 2, disponible: 1 },
    ]);
  });
});
