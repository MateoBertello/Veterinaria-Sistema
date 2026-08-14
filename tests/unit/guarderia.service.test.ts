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
import { EstadiaService, type CancelResponse } from "../../supabase/functions/api/src/modules/guarderia/guarderia.service.ts";
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

// ─── Fixtures compartidas para actualizar / cancelar ──────────────────────────

const dtoModificar = {
  checkInDate:  ymd(10),
  checkOutDate: ymd(14),
  reason:       "Viaje extendido",
  notes:        null as string | null,
};

const filaRpcModificada = {
  ...filaRpc,
  check_in_date:  dtoModificar.checkInDate,
  check_out_date: dtoModificar.checkOutDate,
  reason:         dtoModificar.reason,
  notes:          null,
};

// ─── actualizar ───────────────────────────────────────────────────────────────

describe("EstadiaService.actualizar", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── RN-ME1 ──────────────────────────────────────────────────────────────────

  it("RN-ME1: Finalizada → STAY_LOCKED (422)", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "STAY_LOCKED" } }) as never,
    );
    await expect(
      EstadiaService.actualizar(ESTADIA_ID, dtoModificar, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_LOCKED, statusCode: 422 });
  });

  it("RN-ME1: Cancelada → STAY_LOCKED (422)", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "STAY_LOCKED" } }) as never,
    );
    await expect(
      EstadiaService.actualizar(ESTADIA_ID, dtoModificar, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_LOCKED, statusCode: 422 });
  });

  it("RN-ME1: EnCurso + cambio de checkIn → STAY_LOCKED (422)", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "STAY_LOCKED" } }) as never,
    );
    await expect(
      EstadiaService.actualizar(ESTADIA_ID, { ...dtoModificar, checkInDate: ymd(11) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_LOCKED, statusCode: 422 });
  });

  // ── RN-ME2 ──────────────────────────────────────────────────────────────────

  it("RN-ME2: checkOut < checkIn → INVALID_RANGE (422) — falla antes del RPC", async () => {
    // El mock no importa: el service lanza antes de llamar al RPC.
    mockGetServiceDb.mockReturnValue(buildDb() as never);
    await expect(
      EstadiaService.actualizar(
        ESTADIA_ID,
        { ...dtoModificar, checkInDate: ymd(14), checkOutDate: ymd(10) },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_RANGE, statusCode: 422 });
  });

  it("RN-ME2: checkIn anterior a hoy → PAST_DATE (422) — falla antes del RPC", async () => {
    mockGetServiceDb.mockReturnValue(buildDb() as never);
    await expect(
      EstadiaService.actualizar(
        ESTADIA_ID,
        { ...dtoModificar, checkInDate: ymd(-1), checkOutDate: ymd(2) },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  it("RN-ME2: solape con otra estadía → STAY_OVERLAP (409)", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "STAY_OVERLAP" } }) as never,
    );
    await expect(
      EstadiaService.actualizar(ESTADIA_ID, dtoModificar, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_OVERLAP, statusCode: 409 });
  });

  it("RN-ME2: cupo agotado en nuevos días → CUPO_GUARDERIA_AGOTADO (409) con días en details", async () => {
    const dias = [ymd(10), ymd(11)];
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: `CUPO_GUARDERIA_AGOTADO:${JSON.stringify(dias)}` } }) as never,
    );
    await expect(
      EstadiaService.actualizar(ESTADIA_ID, dtoModificar, ctx),
    ).rejects.toMatchObject({
      code:       ErrorCode.CUPO_GUARDERIA_AGOTADO,
      statusCode: 409,
      details:    dias,
    });
  });

  it("RN-ME1+ME6: éxito → estadía actualizada + auditoría UPDATE daycare", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: filaRpcModificada }) as never);

    const estadia = await EstadiaService.actualizar(ESTADIA_ID, dtoModificar, ctx);

    expect(estadia).toMatchObject({
      id:           ESTADIA_ID,
      checkInDate:  dtoModificar.checkInDate,
      checkOutDate: dtoModificar.checkOutDate,
      reason:       dtoModificar.reason,
    });
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:   "UPDATE",
        module:   "daycare",
        entityId: ESTADIA_ID,
        tenantId: TENANT_ID,
      }),
    );
  });
});

// ─── cancelar ─────────────────────────────────────────────────────────────────

describe("EstadiaService.cancelar", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── RN-ME1 ──────────────────────────────────────────────────────────────────

  it("RN-ME1: Finalizada/Cancelada → STAY_LOCKED (422)", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "STAY_LOCKED" } }) as never,
    );
    await expect(
      EstadiaService.cancelar(ESTADIA_ID, "Ya no necesito guardería", ctx),
    ).rejects.toMatchObject({ code: ErrorCode.STAY_LOCKED, statusCode: 422 });
  });

  // ── RN-ME3 ──────────────────────────────────────────────────────────────────

  it("RN-ME3: éxito → { id, status:'Cancelada', cancelledAt }", async () => {
    const cancelledAt = "2026-06-29T12:00:00Z";
    mockGetServiceDb.mockReturnValue(
      buildDb({
        rpcData: { id: ESTADIA_ID, status: "Cancelada", cancelled_at: cancelledAt },
      }) as never,
    );

    const result: CancelResponse = await EstadiaService.cancelar(
      ESTADIA_ID,
      "Ya no necesito guardería",
      ctx,
    );

    expect(result).toEqual({
      id:          ESTADIA_ID,
      status:      "Cancelada",
      cancelledAt,
    });
  });

  // ── RN-ME6 ──────────────────────────────────────────────────────────────────

  it("RN-ME6: éxito → auditoría UPDATE daycare con status:Cancelada", async () => {
    const cancelledAt = "2026-06-29T12:00:00Z";
    mockGetServiceDb.mockReturnValue(
      buildDb({
        rpcData: { id: ESTADIA_ID, status: "Cancelada", cancelled_at: cancelledAt },
      }) as never,
    );

    await EstadiaService.cancelar(ESTADIA_ID, "Ya no necesito guardería", ctx);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:    "UPDATE",
        module:    "daycare",
        entityId:  ESTADIA_ID,
        tenantId:  TENANT_ID,
        newValues: expect.objectContaining({ status: "Cancelada" }),
      }),
    );
  });
});

// ─── checkin ──────────────────────────────────────────────────────────────────

describe("EstadiaService.checkin", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const checkinRow = {
    id:            ESTADIA_ID,
    status:        "EnCurso",
    checked_in_at: "2026-06-30T10:00:00Z",
  };

  // ── RN-CK1 ──────────────────────────────────────────────────────────────────

  it("RN-CK1: Reservada → EnCurso (éxito) — RPC retorna id, status y checked_in_at", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkinRow }) as never);

    const result = await EstadiaService.checkin(ESTADIA_ID, ctx);

    expect(result).toMatchObject({
      id:          ESTADIA_ID,
      status:      "EnCurso",
      checkedInAt: checkinRow.checked_in_at,
    });
  });

  it("RN-CK1: EnCurso → INVALID_TRANSITION (422) — ya está en curso", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "INVALID_TRANSITION" } }) as never,
    );
    await expect(
      EstadiaService.checkin(ESTADIA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  // ── RN-CK4 ──────────────────────────────────────────────────────────────────

  it("RN-CK4: Finalizada → INVALID_TRANSITION (422) — estado terminal", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "INVALID_TRANSITION" } }) as never,
    );
    await expect(
      EstadiaService.checkin(ESTADIA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  it("RN-CK4: Cancelada → INVALID_TRANSITION (422) — estado terminal", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "INVALID_TRANSITION" } }) as never,
    );
    await expect(
      EstadiaService.checkin(ESTADIA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  // ── RN-CK2 ──────────────────────────────────────────────────────────────────

  it("RN-CK2: checked_in_at presente en la respuesta tras check-in exitoso", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkinRow }) as never);

    const result = await EstadiaService.checkin(ESTADIA_ID, ctx);

    expect(result.checkedInAt).toBe(checkinRow.checked_in_at);
  });

  // ── RN-CK6 ──────────────────────────────────────────────────────────────────

  it("RN-CK6: éxito → auditoría UPDATE módulo daycare con status EnCurso", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkinRow }) as never);

    await EstadiaService.checkin(ESTADIA_ID, ctx);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:    "UPDATE",
        module:    "daycare",
        entityId:  ESTADIA_ID,
        tenantId:  TENANT_ID,
        newValues: expect.objectContaining({ status: "EnCurso" }),
      }),
    );
  });
});

// ─── checkout ─────────────────────────────────────────────────────────────────

describe("EstadiaService.checkout", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const checkoutRow = {
    id:             ESTADIA_ID,
    status:         "Finalizada",
    checked_out_at: "2026-06-30T18:00:00Z",
  };

  // ── RN-CK1 ──────────────────────────────────────────────────────────────────

  it("RN-CK1: EnCurso → Finalizada (éxito) — RPC retorna id, status y checked_out_at", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkoutRow }) as never);

    const result = await EstadiaService.checkout(ESTADIA_ID, ctx);

    expect(result).toMatchObject({
      id:           ESTADIA_ID,
      status:       "Finalizada",
      checkedOutAt: checkoutRow.checked_out_at,
    });
  });

  it("RN-CK1: Reservada → INVALID_TRANSITION (422) — no hizo check-in", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "INVALID_TRANSITION" } }) as never,
    );
    await expect(
      EstadiaService.checkout(ESTADIA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  // ── RN-CK4 ──────────────────────────────────────────────────────────────────

  it("RN-CK4: Finalizada → INVALID_TRANSITION (422) — ya está finalizada", async () => {
    mockGetServiceDb.mockReturnValue(
      buildDb({ rpcError: { message: "INVALID_TRANSITION" } }) as never,
    );
    await expect(
      EstadiaService.checkout(ESTADIA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  // ── RN-CK3 ──────────────────────────────────────────────────────────────────

  it("RN-CK3: checked_out_at presente en la respuesta — cupo liberado implícitamente (Finalizada queda fuera del conteo)", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkoutRow }) as never);

    const result = await EstadiaService.checkout(ESTADIA_ID, ctx);

    expect(result.checkedOutAt).toBe(checkoutRow.checked_out_at);
    expect(result.status).toBe("Finalizada");
  });

  // ── RN-CK6 ──────────────────────────────────────────────────────────────────

  it("RN-CK6: éxito → auditoría UPDATE módulo daycare con status Finalizada", async () => {
    mockGetServiceDb.mockReturnValue(buildDb({ rpcData: checkoutRow }) as never);

    await EstadiaService.checkout(ESTADIA_ID, ctx);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:    "UPDATE",
        module:    "daycare",
        entityId:  ESTADIA_ID,
        tenantId:  TENANT_ID,
        newValues: expect.objectContaining({ status: "Finalizada" }),
      }),
    );
  });
});

describe("EstadiaService.listar", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const filaEmbed = {
    id:             ESTADIA_ID,
    client_id:      CLIENT_ID,
    pet_id:         PET_ID,
    check_in_date:  "2026-07-06", // lunes
    check_out_date: "2026-07-10", // viernes
    status:         "Reservada",
    reason:         "Vacaciones",
    notes:          "Trae su alimento",
    checked_in_at:  null,
    checked_out_at: null,
    created_at:     "2026-07-01T10:00:00Z",
    mascota:        { name: "Firulais", tamano: "Mediano", alimento_dieta: "Sin granos" },
    cliente:        { full_name: "Juan Pérez" },
  };

  it("mapea el embed (mascota/cliente anidados) a EstadiaPublica en UNA sola query", async () => {
    const db = buildDb({ selectData: [filaEmbed] });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await EstadiaService.listar("2026-07-08", ctx); // miércoles, dentro del rango

    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("estadias");
    expect(result).toEqual([
      {
        id:           ESTADIA_ID,
        clientId:     CLIENT_ID,
        petId:        PET_ID,
        checkInDate:  "2026-07-06",
        checkOutDate: "2026-07-10",
        status:       "Reservada",
        reason:       "Vacaciones",
        notes:        "Trae su alimento",
        createdAt:    "2026-07-01T10:00:00Z",
        checkedInAt:  null,
        checkedOutAt: null,
        petName:      "Firulais",
        petTamano:    "Mediano",
        petDieta:     "Sin granos",
        clientName:   "Juan Pérez",
      },
    ]);
  });

  it("solape inclusivo: consulta el día con check_in ≤ date ≤ check_out (una estadía Lun→Vie aparece cada día)", async () => {
    // El filtro real corre en Postgres; acá verificamos que el Service arma la
    // ventana correcta (lte check_in_date, gte check_out_date sobre `date`).
    const db = buildDb({ selectData: [filaEmbed] });
    mockGetServiceDb.mockReturnValue(db as never);

    for (const date of ["2026-07-06", "2026-07-08", "2026-07-10"]) {
      db.lte.mockClear();
      db.gte.mockClear();
      await EstadiaService.listar(date, ctx);
      expect(db.lte).toHaveBeenCalledWith("check_in_date", date);
      expect(db.gte).toHaveBeenCalledWith("check_out_date", date);
    }
  });

  it("excluye Cancelada del listado (status IN Reservada/EnCurso/Finalizada)", async () => {
    const db = buildDb({ selectData: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await EstadiaService.listar("2026-07-08", ctx);

    expect(db.in).toHaveBeenCalledWith("status", ["Reservada", "EnCurso", "Finalizada"]);
    expect(db.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
  });

  it("listarRango: solape del rango (check_in ≤ dateTo AND check_out ≥ dateFrom) en UNA query", async () => {
    // La semana Lun→Vie se trae completa con una sola consulta al rango; el cliente
    // la agrupa por día (sin N+1).
    const db = buildDb({ selectData: [filaEmbed] });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await EstadiaService.listarRango("2027-10-18", "2027-10-22", ctx);

    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("estadias");
    expect(db.lte).toHaveBeenCalledWith("check_in_date", "2027-10-22"); // ≤ dateTo
    expect(db.gte).toHaveBeenCalledWith("check_out_date", "2027-10-18"); // ≥ dateFrom
    expect(db.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].petName).toBe("Firulais");
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
