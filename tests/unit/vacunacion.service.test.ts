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
import { VacunacionService } from "../../supabase/functions/api/src/modules/vacunacion/vacunacion.service.ts";
import { ErrorCode }         from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID   = "11111111-1111-4111-8111-111111111111";
const PET_ID      = "22222222-2222-4222-8222-222222222222";
const DOSIS_ID    = "33333333-3333-4333-8333-333333333333";
const TIPO_VAC_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID     = "55555555-5555-4555-8555-555555555555";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: USER_ID,
  callerName:   "Vet Leo",
  callerRole:   "vet",
};

/** Fecha YYYY-MM-DD desplazada N días respecto a hoy (UTC). */
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const mascotaActiva   = { id: PET_ID, estado: "Activa" };
const mascotaFallecida = { id: PET_ID, estado: "Fallecida" };
const tipoVacunaRow   = { id: TIPO_VAC_ID, nombre: "Antirrábica" };

function dosisRow(over: Record<string, unknown> = {}) {
  return {
    id:                   DOSIS_ID,
    tenant_id:            TENANT_ID,
    pet_id:               PET_ID,
    tipo_vacuna_id:       TIPO_VAC_ID,
    evento_origen_id:     null,
    evento_aplicacion_id: null,
    fecha_estimada:       ymd(10),
    estado:               "Pendiente",
    notas:                null,
    notified_at:          null,
    created_by:           USER_ID,
    created_at:           "2026-07-01T10:00:00Z",
    tipo:                 { nombre: "Antirrábica" },
    ...over,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────────────────

type MockOpts = {
  singleResults?: Array<{ data: unknown; error: unknown }>;
  rangeResult?:   { data: unknown[]; error: unknown; count: number };
};

function buildMockDb(opts: MockOpts = {}) {
  const singleQueue = [...(opts.singleResults ?? [])];
  const next = () => singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of [
    "select", "insert", "update", "delete",
    "eq", "neq", "not", "is", "order", "limit", "filter",
  ]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => next());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => next());
  builder["range"]       = vi.fn().mockResolvedValue(
    opts.rangeResult ?? { data: [], error: null, count: 0 },
  );

  return { from: vi.fn(() => builder), builder };
}

beforeEach(() => vi.clearAllMocks());

// ─── listarPlanVacunacion ─────────────────────────────────────────────────────

describe("VacunacionService.listarPlanVacunacion", () => {
  it("devuelve timeline vacío cuando no hay dosis", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [], error: null, count: 0 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("RN-PV1: Pendiente + fecha futura → estadoVisual=Proxima", async () => {
    const row = dosisRow({ estado: "Pendiente", fecha_estimada: ymd(5) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Proxima");
  });

  it("RN-PV1: Pendiente + fecha pasada → estadoVisual=Vencida", async () => {
    const row = dosisRow({ estado: "Pendiente", fecha_estimada: ymd(-3) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Vencida");
  });

  it("RN-PV1: Aplicada → estadoVisual=Aplicada", async () => {
    const row = dosisRow({ estado: "Aplicada", fecha_estimada: ymd(-10) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Aplicada");
  });

  it("RN-PV1: Cancelada → estadoVisual=Cancelada", async () => {
    const row = dosisRow({ estado: "Cancelada", fecha_estimada: ymd(5) });
    const db  = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
      rangeResult:   { data: [row], error: null, count: 1 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const { items } = await VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 });
    expect(items[0].estadoVisual).toBe("Cancelada");
  });

  it("mascota inexistente → MASCOTA_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.listarPlanVacunacion(PET_ID, TENANT_ID, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });
});

// ─── programarDosis ───────────────────────────────────────────────────────────

describe("VacunacionService.programarDosis", () => {
  const dtoValido = {
    tipoVacunaId:  TIPO_VAC_ID,
    fechaEstimada: ymd(10),
  };

  it("mascota inexistente → MASCOTA_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV4: mascota Fallecida → PET_DECEASED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaFallecida, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PET_DECEASED, statusCode: 422 });
  });

  it("RN-PV2: fechaEstimada < today → PAST_DATE (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: mascotaActiva, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, { ...dtoValido, fechaEstimada: ymd(-1) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  it("RN-PV3: tipoVacunaId inexistente → VACCINE_TYPE_NOT_FOUND (422)", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: null, error: null },           // tipos_vacuna no encontrado
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.programarDosis(PET_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_TYPE_NOT_FOUND, statusCode: 422 });
  });

  it("RN-PV9: éxito → recordAudit llamado con action=CREATE, module=medical_records", async () => {
    const inserted = dosisRow({ fecha_estimada: ymd(10) });
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: tipoVacunaRow, error: null },
        { data: inserted, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.programarDosis(PET_ID, dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "CREATE", module: "medical_records" }),
    );
  });

  it("éxito → dosis con estadoVisual=Proxima y tipoVacunaNombre mapeado", async () => {
    const inserted = dosisRow({ fecha_estimada: ymd(10), tipo: { nombre: "Antirrábica" } });
    const db = buildMockDb({
      singleResults: [
        { data: mascotaActiva, error: null },
        { data: tipoVacunaRow, error: null },
        { data: inserted, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const dosis = await VacunacionService.programarDosis(PET_ID, dtoValido, ctx);

    expect(dosis.estadoVisual).toBe("Proxima");
    expect(dosis.tipoVacunaNombre).toBe("Antirrábica");
    expect(dosis.estado).toBe("Pendiente");
  });
});

// ─── editarDosis ──────────────────────────────────────────────────────────────

describe("VacunacionService.editarDosis", () => {
  const dtoValido = { fechaEstimada: ymd(15) };

  it("dosis inexistente → VACCINE_PLAN_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV5: estado=Aplicada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Aplicada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV5: estado=Cancelada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Cancelada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV2: nueva fechaEstimada < today → PAST_DATE (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow(), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.editarDosis(DOSIS_ID, { fechaEstimada: ymd(-2) }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
  });

  it("RN-PV9: éxito → recordAudit llamado con action=UPDATE, module=medical_records", async () => {
    const updated = dosisRow({ fecha_estimada: ymd(15) });
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: updated,   error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "UPDATE", module: "medical_records" }),
    );
  });

  it("éxito → dosis actualizada con estadoVisual derivado", async () => {
    const updated = dosisRow({ fecha_estimada: ymd(15) });
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: updated,   error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const dosis = await VacunacionService.editarDosis(DOSIS_ID, dtoValido, ctx);
    expect(dosis.estadoVisual).toBe("Proxima");
    expect(dosis.id).toBe(DOSIS_ID);
  });
});

// ─── cancelarDosis ────────────────────────────────────────────────────────────

describe("VacunacionService.cancelarDosis", () => {
  it("dosis inexistente → VACCINE_PLAN_NOT_FOUND (404)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: null, error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_NOT_FOUND, statusCode: 404 });
  });

  it("RN-PV5: estado=Aplicada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Aplicada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV5: estado=Cancelada → VACCINE_PLAN_ALREADY_APPLIED (422)", async () => {
    const db = buildMockDb({
      singleResults: [{ data: dosisRow({ estado: "Cancelada" }), error: null }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VACCINE_PLAN_ALREADY_APPLIED, statusCode: 422 });
  });

  it("RN-PV9: éxito → recordAudit llamado con action=UPDATE, module=medical_records", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: { id: DOSIS_ID, estado: "Cancelada" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "UPDATE", module: "medical_records" }),
    );
  });

  it("éxito → { id, estado: 'Cancelada' }", async () => {
    const db = buildMockDb({
      singleResults: [
        { data: dosisRow(), error: null },
        { data: { id: DOSIS_ID, estado: "Cancelada" }, error: null },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await VacunacionService.cancelarDosis(DOSIS_ID, undefined, ctx);
    expect(result).toEqual({ id: DOSIS_ID, estado: "Cancelada" });
  });
});
