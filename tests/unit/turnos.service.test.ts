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
import { TurnoService } from "../../supabase/functions/api/src/modules/turnos/turnos.service.ts";
import { ErrorCode }    from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID  = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID  = "33333333-3333-4333-8333-333333333333";
const PET_ID     = "44444444-4444-4444-8444-444444444444";
const DOCTOR_ID  = "55555555-5555-4555-8555-555555555555";
const TURNO_ID   = "66666666-6666-4666-8666-666666666666";

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "99999999-9999-4999-8999-999999999999",
  callerName:   "Recepción Leo",
  callerRole:   "recepcionista",
};

// Fecha futura fija para no chocar con RN-TU1 (PAST_DATE).
const FECHA_FUTURA = "2099-12-31";

function dtoBase(overrides: Record<string, unknown> = {}) {
  return {
    servicioId: SERVICE_ID,
    clientId:   CLIENT_ID,
    petId:      PET_ID,
    date:       FECHA_FUTURA,
    startTime:  "10:00",
    reason:     "Control anual",
    ...overrides,
  };
}

function servicioRow(over: Record<string, unknown> = {}) {
  return { id: SERVICE_ID, duracion_minutos: 30, requiere_profesional: false, activo: true, ...over };
}

function turnoRowInsertado(over: Record<string, unknown> = {}) {
  return {
    id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
    status: "Confirmado", reason: "Control anual", notes: null,
    servicio: null, doctor: null, mascota: null, cliente: null, ...over,
  };
}

/**
 * Mock de supabase-js: el builder es thenable; cada terminal (single/maybeSingle
 * o el `await` directo del builder) consume el próximo resultado de la cola, en
 * el orden en que el Service ejecuta las consultas.
 */
function makeDb(results: Array<{ data?: unknown; error?: unknown }>) {
  const queue = [...results];
  const next = () => (queue.length ? queue.shift()! : { data: null, error: null });

  const chain: Record<string, unknown> = {};
  const passthrough = ["from", "select", "insert", "update", "delete", "eq", "neq", "in", "gte", "lte", "ilike", "order", "limit", "range"];
  for (const m of passthrough) chain[m] = vi.fn(() => chain);
  chain["single"]      = vi.fn(() => Promise.resolve(next()));
  chain["maybeSingle"] = vi.fn(() => Promise.resolve(next()));
  // Builder awaitable directo (consultas que no terminan en single/maybeSingle).
  chain["then"] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve, reject);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TurnoService.crearTurno", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-TU9 ────────────────────────────────────────────────────────────────

  it("RN-TU9: servicio inexistente → SERVICE_NOT_FOUND", async () => {
    mockGetServiceDb.mockReturnValue(makeDb([{ data: null }]) as never);
    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.SERVICE_NOT_FOUND, statusCode: 422,
    });
  });

  it("RN-TU9: servicio inactivo → SERVICE_NOT_FOUND", async () => {
    mockGetServiceDb.mockReturnValue(makeDb([{ data: servicioRow({ activo: false }) }]) as never);
    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.SERVICE_NOT_FOUND, statusCode: 422,
    });
  });

  it("RN-TU9: endTime se calcula server-side (start + duración), ignorando al cliente", async () => {
    const db = makeDb([
      { data: servicioRow({ duracion_minutos: 45 }) },        // servicio
      { data: { id: PET_ID, estado: "Activa" } },             // mascota
      { data: turnoRowInsertado({ end_time: "10:45" }) },     // insert
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    await TurnoService.crearTurno(dtoBase({ startTime: "10:00" }), ctx);

    const insertPayload = (db["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload["start_time"]).toBe("10:00");
    expect(insertPayload["end_time"]).toBe("10:45"); // 10:00 + 45min, no lo manda el cliente
  });

  // ── RN-TU10 ───────────────────────────────────────────────────────────────

  it("RN-TU10: servicio requiere profesional y falta doctorId → VALIDATION_ERROR", async () => {
    mockGetServiceDb.mockReturnValue(makeDb([{ data: servicioRow({ requiere_profesional: true }) }]) as never);
    await expect(TurnoService.crearTurno(dtoBase({ doctorId: undefined }), ctx)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR, statusCode: 422,
    });
  });

  // ── RN-TU1 ────────────────────────────────────────────────────────────────

  it("RN-TU1: fecha pasada → PAST_DATE", async () => {
    mockGetServiceDb.mockReturnValue(makeDb([{ data: servicioRow() }]) as never);
    await expect(TurnoService.crearTurno(dtoBase({ date: "2000-01-01" }), ctx)).rejects.toMatchObject({
      code: ErrorCode.PAST_DATE, statusCode: 422,
    });
  });

  // ── RN-TU1 (extendida: fecha DE HOY con hora ya pasada) ─────────────────────
  // Bug original: la comparación lexicográfica YYYY-MM-DD solo miraba la fecha;
  // cuando la fecha era la de hoy, start_time nunca se validaba.

  describe("RN-TU1 extendida: hora del día de hoy", () => {
    beforeEach(() => {
      // "Ahora" fijo en UTC (mismo criterio que el resto del sistema: sin zona
      // horaria de clínica configurada, todo corre en UTC).
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T14:30:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("agendar hoy a una hora ya pasada → PAST_DATE", async () => {
      mockGetServiceDb.mockReturnValue(makeDb([{ data: servicioRow() }]) as never);
      await expect(
        TurnoService.crearTurno(dtoBase({ date: "2026-06-15", startTime: "10:00" }), ctx),
      ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
    });

    it("agendar hoy a la hora actual exacta → PAST_DATE (no es 'posterior')", async () => {
      mockGetServiceDb.mockReturnValue(makeDb([{ data: servicioRow() }]) as never);
      await expect(
        TurnoService.crearTurno(dtoBase({ date: "2026-06-15", startTime: "14:30" }), ctx),
      ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
    });

    it("agendar hoy a una hora futura → OK", async () => {
      const db = makeDb([
        { data: servicioRow() },
        { data: { id: PET_ID, estado: "Activa" } },
        { data: turnoRowInsertado({ date: "2026-06-15", start_time: "15:00", end_time: "15:30" }) },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.crearTurno(dtoBase({ date: "2026-06-15", startTime: "15:00" }), ctx),
      ).resolves.toMatchObject({ date: "2026-06-15" });
    });

    it("borde de medianoche UTC: 21:30 hora local (UTC-3) ya es el día siguiente en UTC — agendar 'hoy' (UTC) a hora futura → OK", async () => {
      // "Ahora" = 2026-06-15T23:45:00Z (23:45 UTC). Un turno para el mismo día
      // UTC a las 23:50 debe aceptarse: sigue siendo hora futura de hoy en UTC.
      vi.setSystemTime(new Date("2026-06-15T23:45:00.000Z"));
      const db = makeDb([
        { data: servicioRow({ duracion_minutos: 10 }) },
        { data: { id: PET_ID, estado: "Activa" } },
        { data: turnoRowInsertado({ date: "2026-06-15", start_time: "23:50", end_time: "00:00" }) },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.crearTurno(dtoBase({ date: "2026-06-15", startTime: "23:50" }), ctx),
      ).resolves.toMatchObject({ date: "2026-06-15" });
    });

    it("borde de medianoche UTC: agendar el 'día siguiente' (UTC) ya no cae en la validación de hoy → OK aunque la hora sea 'temprano'", async () => {
      vi.setSystemTime(new Date("2026-06-15T23:45:00.000Z"));
      const db = makeDb([
        { data: servicioRow() },
        { data: { id: PET_ID, estado: "Activa" } },
        { data: turnoRowInsertado({ date: "2026-06-16", start_time: "00:15", end_time: "00:45" }) },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.crearTurno(dtoBase({ date: "2026-06-16", startTime: "00:15" }), ctx),
      ).resolves.toMatchObject({ date: "2026-06-16" });
    });
  });

  // ── RN-TU6 ────────────────────────────────────────────────────────────────

  it("RN-TU6: mascota fallecida → PET_DECEASED", async () => {
    const db = makeDb([
      { data: servicioRow() },                          // servicio
      { data: { id: PET_ID, estado: "Fallecida" } },    // mascota
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.PET_DECEASED, statusCode: 409,
    });
  });

  it("RN-TU6: mascota inexistente en el tenant → MASCOTA_NOT_FOUND", async () => {
    const db = makeDb([{ data: servicioRow() }, { data: null }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.MASCOTA_NOT_FOUND, statusCode: 404,
    });
  });

  // ── RN-TU5 + RN-TU8 ─────────────────────────────────────────────────────────

  it("RN-TU5/RN-TU8: nace 'Confirmado' y audita CREATE en módulo appointments", async () => {
    const db = makeDb([
      { data: servicioRow() },
      { data: { id: PET_ID, estado: "Activa" } },
      { data: turnoRowInsertado() },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await TurnoService.crearTurno(dtoBase(), ctx);

    const insertPayload = (db["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload["status"]).toBe("Confirmado");       // RN-TU5
    expect(insertPayload["tenant_id"]).toBe(TENANT_ID);       // tenant del ctx
    expect(result.status).toBe("Confirmado");

    expect(mockRecordAudit).toHaveBeenCalledOnce();           // RN-TU8
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("appointments");
    expect(auditArg.action).toBe("CREATE");
    expect(auditArg.entityId).toBe(TURNO_ID);
  });

  // ── RN-TU3 (concurrencia/solapamiento, vía constraint EXCLUDE) ───────────────

  it("RN-TU3: el INSERT viola el EXCLUDE (23P01) → TURNO_SOLAPADO", async () => {
    const db = makeDb([
      { data: servicioRow() },
      { data: { id: PET_ID, estado: "Activa" } },
      { data: null, error: { code: "23P01", message: "conflicting key value violates exclusion constraint" } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.TURNO_SOLAPADO, statusCode: 409,
    });
    expect(mockRecordAudit).not.toHaveBeenCalled(); // no audita si no persistió
  });

  // ── RN-TU4 (duplicado exacto, vía constraint UNIQUE) ─────────────────────────

  it("RN-TU4: el INSERT viola el UNIQUE (23505) → DUPLICATE_APPOINTMENT", async () => {
    const db = makeDb([
      { data: servicioRow() },
      { data: { id: PET_ID, estado: "Activa" } },
      { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(TurnoService.crearTurno(dtoBase(), ctx)).rejects.toMatchObject({
      code: ErrorCode.DUPLICATE_APPOINTMENT, statusCode: 409,
    });
  });

  // ── RN-TU2 (bloque fuera de las franjas del profesional) ─────────────────────

  it("RN-TU2/RN-HOR3: bloque fuera de toda franja activa del doctor → VALIDATION_ERROR", async () => {
    const db = makeDb([
      { data: servicioRow({ requiere_profesional: true }) },  // servicio
      { data: { id: PET_ID, estado: "Activa" } },             // mascota
      { data: [] },                                           // franjas: ninguna contiene el bloque
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      TurnoService.crearTurno(dtoBase({ doctorId: DOCTOR_ID }), ctx),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });
});

// ─── Tests: Modificar / Cancelar / Eliminar (RN-MC) ──────────────────────────

describe("TurnoService.obtenerTurno", () => {
  beforeEach(() => vi.clearAllMocks());

  function turnoExistente(status = "Programado", over: Record<string, unknown> = {}) {
    return {
      id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
      status, reason: "Control", notes: null, tenant_id: TENANT_ID,
      servicio: null, doctor: null, mascota: null, cliente: null, ...over,
    };
  }

  it("RN-MC1: Programado sin admin → accionesDisponibles ['modificar','cancelar','eliminar']", async () => {
    const db = makeDb([
      { data: turnoExistente("Programado") },
      { data: { roles: { name: "veterinario" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
    expect(result.accionesDisponibles).toEqual(["modificar", "cancelar", "eliminar"]);
  });

  it("RN-MC1: Confirmado sin admin → accionesDisponibles ['modificar','cancelar','eliminar']", async () => {
    const db = makeDb([
      { data: turnoExistente("Confirmado") },
      { data: { roles: { name: "recepcionista" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
    expect(result.accionesDisponibles).toEqual(["modificar", "cancelar", "eliminar"]);
  });

  it("RN-MC1: Completado sin admin → accionesDisponibles []", async () => {
    const db = makeDb([
      { data: turnoExistente("Completado") },
      { data: { roles: { name: "veterinario" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
    expect(result.accionesDisponibles).toEqual([]);
  });

  it("RN-MC1: Completado con admin → accionesDisponibles ['eliminar']", async () => {
    const db = makeDb([
      { data: turnoExistente("Completado") },
      { data: { roles: { name: "admin" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
    expect(result.accionesDisponibles).toEqual(["eliminar"]);
  });

  it("RN-MC1: Cancelado con admin → accionesDisponibles ['eliminar']", async () => {
    const db = makeDb([
      { data: turnoExistente("Cancelado") },
      { data: { roles: { name: "admin" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
    expect(result.accionesDisponibles).toEqual(["eliminar"]);
  });

  // ── vencido (turno vencido sin cerrar) ───────────────────────────────────────
  // Condición derivada: fecha/hora ya pasada (mismo "ahora" UTC que RN-TU1) +
  // estado todavía no terminal. No es una columna que un job tenga que actualizar.

  describe("vencido: condición derivada de fecha/hora + estado", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T14:30:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function obtener(over: Record<string, unknown>) {
      const db = makeDb([
        { data: turnoExistente("Confirmado", over) },
        { data: { roles: { name: "veterinario" } } },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      return TurnoService.obtenerTurno(TURNO_ID, ctx);
    }

    it("fecha pasada + Confirmado → vencido: true", async () => {
      const result = await obtener({ date: "2026-06-14", start_time: "10:00", end_time: "10:30" });
      expect(result.vencido).toBe(true);
    });

    it("hoy con end_time ya pasado + Confirmado → vencido: true", async () => {
      const result = await obtener({ date: "2026-06-15", start_time: "13:30", end_time: "14:00" });
      expect(result.vencido).toBe(true);
    });

    it("borde exacto: end_time == hora actual → vencido: true", async () => {
      const result = await obtener({ date: "2026-06-15", start_time: "14:00", end_time: "14:30" });
      expect(result.vencido).toBe(true);
    });

    it("hoy con end_time todavía futuro → vencido: false", async () => {
      const result = await obtener({ date: "2026-06-15", start_time: "14:31", end_time: "15:00" });
      expect(result.vencido).toBe(false);
    });

    it("fecha futura → vencido: false", async () => {
      const result = await obtener({ date: "2026-06-16", start_time: "09:00", end_time: "09:30" });
      expect(result.vencido).toBe(false);
    });

    it("fecha/hora pasada pero Completado (terminal) → vencido: false", async () => {
      const db = makeDb([
        { data: turnoExistente("Completado", { date: "2026-06-14", start_time: "10:00", end_time: "10:30" }) },
        { data: { roles: { name: "veterinario" } } },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
      expect(result.vencido).toBe(false);
    });

    it("fecha/hora pasada pero Cancelado (terminal) → vencido: false", async () => {
      const db = makeDb([
        { data: turnoExistente("Cancelado", { date: "2026-06-14", start_time: "10:00", end_time: "10:30" }) },
        { data: { roles: { name: "veterinario" } } },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      const result = await TurnoService.obtenerTurno(TURNO_ID, ctx);
      expect(result.vencido).toBe(false);
    });
  });
});

describe("TurnoService.modificarTurno", () => {
  beforeEach(() => vi.clearAllMocks());

  function turnoActual(status = "Confirmado", over: Record<string, unknown> = {}) {
    return {
      id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
      status, reason: "Control", notes: null, tenant_id: TENANT_ID,
      servicio_id: SERVICE_ID, doctor_id: DOCTOR_ID,
      servicio: null, doctor: null, mascota: null, cliente: null, ...over,
    };
  }

  it("RN-MC1: modificarTurno en Completado → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([{ data: turnoActual("Completado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.modificarTurno(TURNO_ID, { reason: "nuevo motivo" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 422 });
  });

  it("RN-MC1: modificarTurno en Cancelado → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([{ data: turnoActual("Cancelado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.modificarTurno(TURNO_ID, { notes: "x" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 422 });
  });

  it("RN-MC2: modificarTurno con nuevo servicio usa duración vigente server-side", async () => {
    const NUEVO_SERVICIO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const turnoModificado = {
      ...turnoActual(), servicio_id: NUEVO_SERVICIO_ID,
      start_time: "14:00", end_time: "15:00",
      servicio: null, doctor: null, mascota: null, cliente: null,
    };
    const db = makeDb([
      { data: turnoActual("Confirmado") },               // fetch turno actual
      { data: { id: NUEVO_SERVICIO_ID, duracion_minutos: 60, requiere_profesional: false, activo: true } }, // servicio nuevo
      { data: [{ start_time: "13:00", end_time: "17:00" }] }, // franjas del doctor (cubre 14:00-15:00)
      { data: turnoModificado },                         // UPDATE result
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    await TurnoService.modificarTurno(
      TURNO_ID,
      { servicioId: NUEVO_SERVICIO_ID, startTime: "14:00" },
      ctx,
    );

    const updatePayload = (db["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload["end_time"]).toBe("15:00"); // 14:00 + 60min
    expect(updatePayload["servicio_id"]).toBe(NUEVO_SERVICIO_ID);
  });

  // ── RN-TU1 extendida vía RN-MC2 (reprogramar a hora ya pasada de hoy) ────────

  describe("RN-TU1 extendida: reprogramar a hora pasada de hoy", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T14:30:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reprogramar startTime a una hora ya pasada de hoy → PAST_DATE", async () => {
      const db = makeDb([
        { data: turnoActual("Confirmado", { date: "2026-06-15" }) }, // fetch turno actual
        { data: servicioRow() },                                     // servicio vigente (mismo id, sin cambiar)
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.modificarTurno(TURNO_ID, { startTime: "10:00" }, ctx),
      ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
    });

    it("reprogramar un turno de ayer (vencido, sin cerrar) a una fecha futura → OK", async () => {
      const turnoDeAyer = turnoActual("Confirmado", { date: "2026-06-14", start_time: "10:00", end_time: "10:30" });
      const db = makeDb([
        { data: turnoDeAyer },                                    // fetch turno actual
        { data: servicioRow() },                                  // servicio vigente
        { data: [{ start_time: "08:00", end_time: "18:00" }] },   // franjas del doctor (cubre 10:00-10:30)
        { data: { ...turnoDeAyer, date: "2026-06-20", start_time: "10:00", end_time: "10:30", servicio: null, doctor: null, mascota: null, cliente: null } },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.modificarTurno(TURNO_ID, { date: "2026-06-20" }, ctx),
      ).resolves.toMatchObject({ date: "2026-06-20" });
    });

    it("reprogramar un turno de ayer (vencido, sin cerrar) a otra hora del mismo día pasado → PAST_DATE", async () => {
      const turnoDeAyer = turnoActual("Confirmado", { date: "2026-06-14", start_time: "10:00", end_time: "10:30" });
      const db = makeDb([
        { data: turnoDeAyer },
        { data: servicioRow() },
      ]);
      mockGetServiceDb.mockReturnValue(db as never);
      await expect(
        TurnoService.modificarTurno(TURNO_ID, { startTime: "11:00" }, ctx),
      ).rejects.toMatchObject({ code: ErrorCode.PAST_DATE, statusCode: 422 });
    });
  });

  it("RN-MC2: servicio inactivo al modificar → SERVICE_NOT_FOUND", async () => {
    const db = makeDb([
      { data: turnoActual("Confirmado") },
      { data: { id: SERVICE_ID, duracion_minutos: 30, requiere_profesional: false, activo: false } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.modificarTurno(TURNO_ID, { servicioId: SERVICE_ID, startTime: "10:00" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_NOT_FOUND, statusCode: 422 });
  });

  it("RN-MC7: modificarTurno audita UPDATE en módulo appointments", async () => {
    const db = makeDb([
      { data: turnoActual("Programado") },
      { data: { ...turnoActual(), reason: "motivo nuevo", servicio: null, doctor: null, mascota: null, cliente: null } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await TurnoService.modificarTurno(TURNO_ID, { reason: "motivo nuevo" }, ctx);
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.module).toBe("appointments");
    expect(auditArg.entityId).toBe(TURNO_ID);
  });
});

describe("TurnoService.cancelarTurno", () => {
  beforeEach(() => vi.clearAllMocks());

  function turnoActual(status = "Confirmado") {
    return {
      id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
      status, reason: "Control", notes: null, tenant_id: TENANT_ID,
      servicio_id: SERVICE_ID, doctor_id: null,
      servicio: null, doctor: null, mascota: null, cliente: null,
    };
  }

  it("RN-MC1/ES3: cancelarTurno en Completado → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([{ data: turnoActual("Completado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.cancelarTurno(TURNO_ID, { cancellationReason: "Paciente no llega" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 422 });
  });

  it("RN-MC1/ES3: cancelarTurno en Cancelado → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([{ data: turnoActual("Cancelado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.cancelarTurno(TURNO_ID, { cancellationReason: "ya cancelado" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 422 });
  });

  it("RN-MC3: cancelarTurno setea status=Cancelado + cancellationReason + cancelledAt", async () => {
    const cancelado = {
      ...turnoActual("Cancelado"),
      cancellation_reason: "Paciente no llega", cancelled_at: new Date().toISOString(),
    };
    const db = makeDb([
      { data: turnoActual("Confirmado") },
      { data: cancelado },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await TurnoService.cancelarTurno(TURNO_ID, { cancellationReason: "Paciente no llega" }, ctx);
    const updatePayload = (db["update"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload["status"]).toBe("Cancelado");
    expect(updatePayload["cancellation_reason"]).toBe("Paciente no llega");
    expect(updatePayload["cancelled_at"]).toBeDefined();
  });

  it("RN-MC7: cancelarTurno audita CANCEL en módulo appointments", async () => {
    const cancelado = { ...turnoActual("Cancelado"), cancellation_reason: "motivo", cancelled_at: new Date().toISOString() };
    const db = makeDb([
      { data: turnoActual("Programado") },
      { data: cancelado },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await TurnoService.cancelarTurno(TURNO_ID, { cancellationReason: "motivo" }, ctx);
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("CANCEL");
    expect(auditArg.module).toBe("appointments");
  });
});

describe("TurnoService.eliminarTurno", () => {
  beforeEach(() => vi.clearAllMocks());

  function turnoActual(status = "Programado") {
    return {
      id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
      status, reason: "Control", notes: null, tenant_id: TENANT_ID,
      servicio_id: SERVICE_ID, doctor_id: null,
      servicio: null, doctor: null, mascota: null, cliente: null,
    };
  }

  it("RN-MC6: eliminarTurno en Cancelado sin admin → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([
      { data: turnoActual("Cancelado") },
      { data: { roles: { name: "recepcionista" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.eliminarTurno(TURNO_ID, ctx)).rejects.toMatchObject({
      code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 403,
    });
  });

  it("RN-MC6: eliminarTurno en Completado sin admin → APPOINTMENT_LOCKED", async () => {
    const db = makeDb([
      { data: turnoActual("Completado") },
      { data: { roles: { name: "veterinario" } } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.eliminarTurno(TURNO_ID, ctx)).rejects.toMatchObject({
      code: ErrorCode.APPOINTMENT_LOCKED, statusCode: 403,
    });
  });

  it("RN-MC6: eliminarTurno en Cancelado con admin → OK", async () => {
    const db = makeDb([
      { data: turnoActual("Cancelado") },
      { data: { roles: { name: "admin" } } },
      { data: null, error: null },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.eliminarTurno(TURNO_ID, ctx)).resolves.toBeUndefined();
  });

  it("RN-MC6: eliminarTurno en Programado (no terminal) sin admin → OK", async () => {
    const db = makeDb([
      { data: turnoActual("Programado") },
      { data: null, error: null },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(TurnoService.eliminarTurno(TURNO_ID, ctx)).resolves.toBeUndefined();
  });

  it("RN-MC7: eliminarTurno audita DELETE en módulo appointments", async () => {
    const db = makeDb([
      { data: turnoActual("Confirmado") },
      { data: null, error: null },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await TurnoService.eliminarTurno(TURNO_ID, ctx);
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("DELETE");
    expect(auditArg.module).toBe("appointments");
    expect(auditArg.entityId).toBe(TURNO_ID);
  });
});

// ─── Tests: Gestionar Estado (RN-ES) ─────────────────────────────────────────

describe("TurnoService.cambiarEstado", () => {
  beforeEach(() => vi.clearAllMocks());

  function turnoActual(status = "Programado") {
    return {
      id: TURNO_ID, date: FECHA_FUTURA, start_time: "10:00", end_time: "10:30",
      status, reason: "Control", notes: null, tenant_id: TENANT_ID,
      servicio_id: SERVICE_ID, doctor_id: null,
      servicio: null, doctor: null, mascota: null, cliente: null,
    };
  }

  it("RN-ES1: Programado→Confirmado → OK", async () => {
    const db = makeDb([
      { data: turnoActual("Programado") },
      { data: { ...turnoActual("Confirmado") } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.cambiarEstado(TURNO_ID, { status: "Confirmado" }, ctx);
    expect(result.status).toBe("Confirmado");
  });

  it("RN-ES1: Confirmado→Completado → OK", async () => {
    const db = makeDb([
      { data: turnoActual("Confirmado") },
      { data: { ...turnoActual("Completado") } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    const result = await TurnoService.cambiarEstado(TURNO_ID, { status: "Completado" }, ctx);
    expect(result.status).toBe("Completado");
  });

  it("RN-ES1: Completado→Programado → INVALID_TRANSITION", async () => {
    const db = makeDb([{ data: turnoActual("Completado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.cambiarEstado(TURNO_ID, { status: "Programado" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  it("RN-ES1: Programado→Completado (saltar Confirmado) → INVALID_TRANSITION", async () => {
    const db = makeDb([{ data: turnoActual("Programado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.cambiarEstado(TURNO_ID, { status: "Completado" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  it("RN-ES3: cambiarEstado sobre Cancelado (terminal) → INVALID_TRANSITION", async () => {
    const db = makeDb([{ data: turnoActual("Cancelado") }]);
    mockGetServiceDb.mockReturnValue(db as never);
    await expect(
      TurnoService.cambiarEstado(TURNO_ID, { status: "Confirmado" }, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_TRANSITION, statusCode: 422 });
  });

  it("RN-ES5: cambiarEstado audita UPDATE en módulo appointments", async () => {
    const db = makeDb([
      { data: turnoActual("Programado") },
      { data: { ...turnoActual("Confirmado") } },
    ]);
    mockGetServiceDb.mockReturnValue(db as never);
    await TurnoService.cambiarEstado(TURNO_ID, { status: "Confirmado" }, ctx);
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.module).toBe("appointments");
  });
});

describe("TurnoService.listarTurnos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RN-ES2/RN-MC4: sin filtro de status, la query trae solo Programado/Confirmado (excluye Completado y Cancelado)", async () => {
    const db = makeDb([{ data: [] }]);
    mockGetServiceDb.mockReturnValue(db as never);

    await TurnoService.listarTurnos({}, ctx);

    expect(db["in"]).toHaveBeenCalledWith("status", ["Programado", "Confirmado"]);
    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls.some(([field]) => field === "status")).toBe(false);
  });

  it("RN-ES2: listarTurnos con status='Completado' explícito no aplica el default (no usa .in)", async () => {
    const db = makeDb([{ data: [] }]);
    mockGetServiceDb.mockReturnValue(db as never);

    await TurnoService.listarTurnos({ status: "Completado" }, ctx);

    expect(db["eq"]).toHaveBeenCalledWith("status", "Completado");
    expect(db["in"]).not.toHaveBeenCalled();
  });

  it("RN-MC4: listarTurnos con status='Cancelado' explícito no aplica el default (no usa .in)", async () => {
    const db = makeDb([{ data: [] }]);
    mockGetServiceDb.mockReturnValue(db as never);

    await TurnoService.listarTurnos({ status: "Cancelado" }, ctx);

    expect(db["eq"]).toHaveBeenCalledWith("status", "Cancelado");
    expect(db["in"]).not.toHaveBeenCalled();
  });
});

describe("TurnoService.slotsDisponibles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-TU2 (slots derivados de franjas, restando ocupados) ───────────────────

  it("RN-TU2/RN-HOR3: genera slots por duración y excluye los inicios ya ocupados", async () => {
    const db = makeDb([
      { data: { duracion_minutos: 30, activo: true } },                 // servicio
      { data: [{ start_time: "09:00", end_time: "10:00" }] },           // franja activa
      { data: [{ start_time: "09:00", end_time: "09:30" }] },           // turno ocupado
    ]);
    mockGetServiceDb.mockReturnValue(db as never);

    const slots = await TurnoService.slotsDisponibles(DOCTOR_ID, FECHA_FUTURA, SERVICE_ID, TENANT_ID);

    // La franja 09:00–10:00 con duración 30 daría 09:00 y 09:30; 09:00 está ocupado.
    expect(slots).toEqual([{ startTime: "09:30", endTime: "10:00" }]);
  });

  it("RN-TU9: slots de servicio inactivo → SERVICE_NOT_FOUND", async () => {
    mockGetServiceDb.mockReturnValue(makeDb([{ data: { duracion_minutos: 30, activo: false } }]) as never);
    await expect(
      TurnoService.slotsDisponibles(DOCTOR_ID, FECHA_FUTURA, SERVICE_ID, TENANT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_NOT_FOUND, statusCode: 422 });
  });
});
