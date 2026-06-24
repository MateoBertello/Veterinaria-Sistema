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
import { HistorialService } from "../../supabase/functions/api/src/modules/historial/historial.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";
import * as XLSX from "xlsx";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PET_ID    = "22222222-2222-4222-8222-222222222222";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "user-001",
  callerName:   "Vet User",
  callerRole:   "admin",
};

// ─── Mock builder ─────────────────────────────────────────────────────────────
// Extiende el patrón estándar con soporte para consultas sin terminal:
//   await db.from("historial_clinico").select(...).eq(...).order(...)
// que el runtime resuelve vía builder.then (la query es "thenable").

type ExportMockOpts = {
  mascota:  unknown;                        // resultado de .maybeSingle() para mascotas
  records:  unknown[];                      // resultado del await directo de historial_clinico
};

function buildExportDb(opts: ExportMockOpts) {
  const singleQueue = [{ data: opts.mascota, error: null }];
  const nextSingle  = () => singleQueue.shift() ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of [
    "select", "insert", "update", "delete",
    "eq", "neq", "or", "ilike", "not", "is", "filter",
    "order", "limit",
  ]) {
    builder[m] = vi.fn(chain);
  }
  builder["single"]      = vi.fn().mockImplementation(async () => nextSingle());
  builder["maybeSingle"] = vi.fn().mockImplementation(async () => nextSingle());
  builder["range"]       = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });

  // Hace el builder "thenable": await db.from(...).select(...).eq(...).order(...)
  // no pasa por .single()/.maybeSingle() sino por builder.then().
  (builder as Record<string, unknown>)["then"] = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: opts.records, error: null }).then(resolve, reject);

  return {
    from:    vi.fn(() => builder),
    rpc:     vi.fn(() => builder),
    storage: { from: vi.fn() },
    builder,
  };
}

beforeEach(() => vi.clearAllMocks());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mascotaRow = {
  id:       PET_ID,
  name:     "Firulais",
  especie:  { name: "Perro" },
  raza:     { name: "Labrador" },
  cliente:  { full_name: "Juan Perez" },
};

function historialRow(over: Record<string, unknown> = {}) {
  return {
    id:            "evt-001",
    date:          "2026-06-01",
    event_type:    "Consulta",
    weight_kg:     4.5,
    temperature_c: 38.2,
    description:   "Revision anual",
    diagnosis:     "Control sin hallazgos",
    profesional:   { full_name: "Dra. Garcia" },
    ...over,
  };
}

// ─── exportarHistorial ────────────────────────────────────────────────────────

describe("exportarHistorial", () => {
  it("RN-EX1: historial vacío lanza EMPTY_HISTORY", async () => {
    const db = buildExportDb({ mascota: mascotaRow, records: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.exportarHistorial(PET_ID, "pdf", ctx),
    ).rejects.toMatchObject({ code: ErrorCode.EMPTY_HISTORY, statusCode: 400 });
  });

  it("RN-EX1: mascota no encontrada lanza MASCOTA_NOT_FOUND (antes que EMPTY_HISTORY)", async () => {
    const db = buildExportDb({ mascota: null, records: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.exportarHistorial(PET_ID, "pdf", ctx),
    ).rejects.toMatchObject({ code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404 });
  });

  it("RN-EX2: format=pdf devuelve buffer que empieza con %PDF", async () => {
    const db = buildExportDb({ mascota: mascotaRow, records: [historialRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HistorialService.exportarHistorial(PET_ID, "pdf", ctx);

    expect(result.buffer).toBeInstanceOf(Uint8Array);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.contentType).toBe("application/pdf");
    expect(result.filename).toMatch(/^historial-.+\.pdf$/);

    const header = new TextDecoder().decode(result.buffer.slice(0, 4));
    expect(header).toBe("%PDF");
  });

  it("RN-EX3: format=xlsx devuelve buffer XLSX con headers y filas correctas", async () => {
    const rows = [
      historialRow({ id: "evt-001" }),
      historialRow({ id: "evt-002", event_type: "Vacunacion", diagnosis: null }),
    ];
    const db = buildExportDb({ mascota: mascotaRow, records: rows });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HistorialService.exportarHistorial(PET_ID, "xlsx", ctx);

    expect(result.buffer).toBeInstanceOf(Uint8Array);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.filename).toMatch(/^historial-.+\.xlsx$/);

    // Verificar estructura del XLSX
    const wb   = XLSX.read(result.buffer, { type: "buffer" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

    const headers = data[0];
    expect(headers).toEqual([
      "Fecha", "Tipo", "Profesional",
      "Peso (kg)", "Temp. (C)",
      "Descripcion", "Diagnostico",
    ]);
    expect(data.length - 1).toBe(2); // 2 filas de datos
  });

  it("RN-EX4: registra auditoría con action=EXPORT y entityId=petId", async () => {
    const db = buildExportDb({ mascota: mascotaRow, records: [historialRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    await HistorialService.exportarHistorial(PET_ID, "pdf", ctx);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action:   "EXPORT",
        module:   "medical_records",
        entityId: PET_ID,
        tenantId: TENANT_ID,
      }),
    );
  });

  it("RN-EX4: auditoría NO se registra si historial está vacío (EMPTY_HISTORY primero)", async () => {
    const db = buildExportDb({ mascota: mascotaRow, records: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HistorialService.exportarHistorial(PET_ID, "pdf", ctx),
    ).rejects.toMatchObject({ code: ErrorCode.EMPTY_HISTORY });

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
