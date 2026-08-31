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
import { HorarioService } from "../../supabase/functions/api/src/modules/horarios/horarios.service.ts";
import { ErrorCode }    from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DOCTOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FRANJA_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
// Usuario dueño del perfil profesional DOCTOR_ID (RN-HOR7).
const VET_USER_ID = "99999999-9999-4999-8999-999999999999";

// Admin de la clínica: gestiona el horario de cualquier profesional (RN-HOR7).
const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
  canManageAll: true,
};

const doctorRow = { id: DOCTOR_ID, tenant_id: TENANT_ID, user_id: VET_USER_ID, available: true };
const doctorInactivoRow = { ...doctorRow, available: false };

function franjaRow(over: Record<string, unknown> = {}) {
  return {
    id:          FRANJA_ID,
    tenant_id:   TENANT_ID,
    doctor_id:   DOCTOR_ID,
    day_of_week: 1,
    start_time:  "09:00:00",
    end_time:    "13:00:00",
    active:      true,
    ...over,
  };
}

/**
 * Mock de DB con cadena builder. `singleSeq` alimenta llamadas .single() en orden;
 * `thenData` resuelve las queries que terminan en .eq()/.order() (supabase-js es
 * thenable: se await-ea el builder directamente).
 */
function buildDbChain(opts: {
  singleSeq?:  unknown[];
  singleData?: unknown;
  thenData?:   unknown[];
} = {}) {
  const chain: Record<string, unknown> = {};
  const seq = opts.singleSeq ? [...opts.singleSeq] : null;

  const singleFn = vi.fn().mockImplementation(() => {
    if (seq) return Promise.resolve({ data: seq.shift() ?? null, error: null });
    return Promise.resolve({ data: opts.singleData ?? null, error: null });
  });

  chain["from"]   = vi.fn().mockReturnValue(chain);
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["insert"] = vi.fn().mockReturnValue(chain);
  chain["update"] = vi.fn().mockReturnValue(chain);
  chain["delete"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockReturnValue(chain);
  chain["order"]  = vi.fn().mockReturnValue(chain);
  chain["single"] = singleFn;
  // Hace al builder thenable para queries sin .single().
  chain["then"]   = (resolve: (v: unknown) => unknown) =>
    resolve({ data: opts.thenData ?? [], error: null });

  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HorarioService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-HOR1 ──────────────────────────────────────────────────────────────────

  it("RN-HOR1: inicio ≥ fin → INVALID_RANGE", async () => {
    const db = buildDbChain({ singleSeq: [doctorRow] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.crearFranja(
        DOCTOR_ID,
        { dayOfWeek: 1, startTime: "13:00", endTime: "09:00", active: true },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_RANGE, statusCode: 422 });
  });

  it("RN-HOR1: rango válido persiste la franja y audita CREATE en módulo system (RN-HOR6)", async () => {
    const inserted = franjaRow({ start_time: "09:00:00", end_time: "13:00:00" });
    // single(): 1) doctor-check, 2) fila insertada. thenData=[] → sin solapamiento.
    const db = buildDbChain({ singleSeq: [doctorRow, inserted], thenData: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HorarioService.crearFranja(
      DOCTOR_ID,
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
      ctx,
    );

    expect(result).toMatchObject({
      doctorId: DOCTOR_ID, dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true,
    });

    const insertArg = (db["insert"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg["tenant_id"]).toBe(TENANT_ID); // tenant del ctx, no del body
    expect(insertArg["doctor_id"]).toBe(DOCTOR_ID);

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("system");
    expect(auditArg.action).toBe("CREATE");
  });

  // ── RN-HOR2 ──────────────────────────────────────────────────────────────────

  it("RN-HOR2: solapamiento con franja activa del mismo doctor y día → SCHEDULE_OVERLAP", async () => {
    // Existe 09:00–13:00 activa; intento crear 12:00–14:00 (se solapa).
    const db = buildDbChain({
      singleSeq: [doctorRow],
      thenData:  [{ id: "otra", start_time: "09:00:00", end_time: "13:00:00" }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.crearFranja(
        DOCTOR_ID,
        { dayOfWeek: 1, startTime: "12:00", endTime: "14:00", active: true },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SCHEDULE_OVERLAP, statusCode: 409 });
  });

  it("RN-HOR2: franja adyacente (13:00–14:00 vs 09:00–13:00) NO se solapa → se crea", async () => {
    const inserted = franjaRow({ start_time: "13:00:00", end_time: "14:00:00" });
    const db = buildDbChain({
      singleSeq: [doctorRow, inserted],
      thenData:  [{ id: "otra", start_time: "09:00:00", end_time: "13:00:00" }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HorarioService.crearFranja(
      DOCTOR_ID,
      { dayOfWeek: 1, startTime: "13:00", endTime: "14:00", active: true },
      ctx,
    );
    expect(result.startTime).toBe("13:00");
  });

  it("RN-HOR2: la verificación de solapamiento sólo mira franjas activas del mismo día", async () => {
    const inserted = franjaRow({ start_time: "09:00:00", end_time: "13:00:00" });
    const db = buildDbChain({ singleSeq: [doctorRow, inserted], thenData: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await HorarioService.crearFranja(
      DOCTOR_ID,
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
      ctx,
    );

    const eqCalls = (db["eq"] as ReturnType<typeof vi.fn>).mock.calls;
    // El query de solapamiento filtra por activas y por el día (excluye inactivas/otros días).
    expect(eqCalls).toContainEqual(["active", true]);
    expect(eqCalls).toContainEqual(["day_of_week", 1]);
  });

  it("RN-HOR2: franja inactiva (active=false) no valida solapamiento → se crea siempre", async () => {
    const inserted = franjaRow({ active: false });
    // thenData NO debería consultarse; lo dejamos con datos para asegurar que no se usa.
    const db = buildDbChain({
      singleSeq: [doctorRow, inserted],
      thenData:  [{ id: "otra", start_time: "09:00:00", end_time: "13:00:00" }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HorarioService.crearFranja(
      DOCTOR_ID,
      { dayOfWeek: 1, startTime: "10:00", endTime: "12:00", active: false },
      ctx,
    );
    expect(result.active).toBe(false);
  });

  it("RN-HOR2: alternarActivo re-valida solapamiento al reactivar una franja", async () => {
    // La franja a reactivar (inactiva) choca con otra activa existente.
    // RN-HOR8: al reactivar también se carga el doctor (pertenencia + disponibilidad).
    const db = buildDbChain({
      singleSeq: [franjaRow({ active: false, start_time: "12:00:00", end_time: "14:00:00" }), doctorRow],
      thenData:  [{ id: "otra", start_time: "09:00:00", end_time: "13:00:00" }],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.alternarActivo(FRANJA_ID, true, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.SCHEDULE_OVERLAP, statusCode: 409 });
  });

  // ── RN-HOR4 ──────────────────────────────────────────────────────────────────

  it("RN-HOR4: franja para un doctor inexistente en el tenant → FORBIDDEN", async () => {
    const db = buildDbChain({ singleSeq: [null] }); // doctor-check → null
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.crearFranja(
        DOCTOR_ID,
        { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });

  // ── RN-HOR6 ──────────────────────────────────────────────────────────────────

  it("RN-HOR6: alternarActivo(false) audita UPDATE en módulo system", async () => {
    const db = buildDbChain({
      singleSeq: [franjaRow(), franjaRow({ active: false })],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await HorarioService.alternarActivo(FRANJA_ID, false, ctx);

    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("system");
    expect(auditArg.action).toBe("UPDATE");
    expect(auditArg.entityId).toBe(FRANJA_ID);
  });

  it("RN-HOR6: eliminar audita DELETE en módulo system", async () => {
    const db = buildDbChain({ singleSeq: [franjaRow()], thenData: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await HorarioService.eliminar(FRANJA_ID, ctx);

    expect(db["delete"]).toHaveBeenCalled();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("system");
    expect(auditArg.action).toBe("DELETE");
    expect(auditArg.entityId).toBe(FRANJA_ID);
  });

  it("eliminar: franja de otro tenant → FORBIDDEN", async () => {
    const db = buildDbChain({ singleSeq: [null] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.eliminar(FRANJA_ID, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });
  });

  // ── Resumen: una sola consulta con embed (sin N+1) ──────────────────────────

  it("resumen: resuelve doctores + franjas con embed en UNA consulta (sin N+1)", async () => {
    const db = buildDbChain({
      thenData: [
        {
          id: DOCTOR_ID, name: "Dra. Fernández", available: true,
          franjas: [
            { id: "f2", doctor_id: DOCTOR_ID, day_of_week: 3, start_time: "14:00:00", end_time: "18:00:00", active: true },
            { id: "f1", doctor_id: DOCTOR_ID, day_of_week: 1, start_time: "09:00:00", end_time: "13:00:00", active: true },
          ],
        },
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const resumen = await HorarioService.resumen(ctx);

    const selectArg = (db["select"] as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selectArg).toContain("horarios_doctor!doctor_id");
    expect((db["from"] as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    expect(resumen[0].doctorId).toBe(DOCTOR_ID);
    // Orden estable por día/hora.
    expect(resumen[0].franjas.map((f) => f.dayOfWeek)).toEqual([1, 3]);
    expect(resumen[0].franjas[0]).toMatchObject({ startTime: "09:00", endTime: "13:00" });
  });

  // ── RN-HOR7 (pertenencia) ────────────────────────────────────────────────────
  // El veterinario tiene manage_schedules, pero solo sobre SU perfil profesional;
  // el admin de la clínica (canManageAll) no tiene esa restricción.

  const ctxVet = { ...ctx, callerUserId: VET_USER_ID, callerName: "vet_leo", callerRole: "veterinario", canManageAll: false };
  const ctxOtroVet = { ...ctxVet, callerUserId: "88888888-8888-4888-8888-888888888888" };

  it("RN-HOR7: el veterinario crea franjas en su propio perfil", async () => {
    const db = buildDbChain({ singleSeq: [doctorRow, franjaRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    const franja = await HorarioService.crearFranja(
      DOCTOR_ID,
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
      ctxVet,
    );

    expect(franja.doctorId).toBe(DOCTOR_ID);
  });

  it("RN-HOR7: el veterinario NO puede crear franjas en el perfil de otro → FORBIDDEN", async () => {
    const db = buildDbChain({ singleSeq: [doctorRow] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.crearFranja(
        DOCTOR_ID,
        { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
        ctxOtroVet,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });

    // Cortó antes de tocar la tabla de franjas.
    expect(db["insert"]).not.toHaveBeenCalled();
  });

  it("RN-HOR7: el veterinario no puede desactivar la franja de otro → FORBIDDEN", async () => {
    const db = buildDbChain({ singleSeq: [franjaRow(), doctorRow] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.alternarActivo(FRANJA_ID, false, ctxOtroVet),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });

    expect(db["update"]).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("RN-HOR7: el veterinario no puede eliminar la franja de otro → FORBIDDEN", async () => {
    const db = buildDbChain({ singleSeq: [franjaRow(), doctorRow] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.eliminar(FRANJA_ID, ctxOtroVet),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, statusCode: 403 });

    expect(db["delete"]).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("RN-HOR7: el admin (canManageAll) gestiona el horario de cualquier profesional", async () => {
    const db = buildDbChain({ singleSeq: [franjaRow(), franjaRow({ active: false })] });
    mockGetServiceDb.mockReturnValue(db as never);

    await HorarioService.alternarActivo(FRANJA_ID, false, ctx);

    expect(db["update"]).toHaveBeenCalledWith({ active: false });
    // Ni siquiera consulta el perfil del doctor: no hace falta chequear pertenencia.
    expect((db["from"] as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]))
      .not.toContain("doctores");
  });

  it("RN-HOR7: la LECTURA no se restringe — el veterinario ve la agenda de otro", async () => {
    const db = buildDbChain({ singleSeq: [doctorRow], thenData: [franjaRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    const franjas = await HorarioService.listarPorDoctor(DOCTOR_ID, ctxOtroVet);

    expect(franjas).toHaveLength(1);
  });

  // ── RN-HOR8 (baja lógica del profesional) ───────────────────────────────────
  // Un doctor con available=false no puede recibir franjas nuevas ni reactivar
  // las que tenía (no tiene sentido ofrecerlo para turnos nuevos), pero la baja
  // no es destructiva: conserva sus franjas, se pueden listar, desactivar y
  // eliminar sin restricción.

  it("RN-HOR8: rechaza crear franja para doctor inactivo -> DOCTOR_INACTIVE", async () => {
    const db = buildDbChain({ singleSeq: [doctorInactivoRow] });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.crearFranja(
        DOCTOR_ID,
        { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", active: true },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.DOCTOR_INACTIVE, statusCode: 422 });

    expect(db["insert"]).not.toHaveBeenCalled();
  });

  it("RN-HOR8: rechaza reactivar (alternarActivo a true) la franja de un doctor inactivo -> DOCTOR_INACTIVE", async () => {
    const db = buildDbChain({
      singleSeq: [franjaRow({ active: false }), doctorInactivoRow],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      HorarioService.alternarActivo(FRANJA_ID, true, ctx),
    ).rejects.toMatchObject({ code: ErrorCode.DOCTOR_INACTIVE, statusCode: 422 });

    expect(db["update"]).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("RN-HOR8: permite DESACTIVAR una franja de un doctor inactivo (la baja no es destructiva)", async () => {
    const db = buildDbChain({
      singleSeq: [franjaRow(), franjaRow({ active: false })],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    const result = await HorarioService.alternarActivo(FRANJA_ID, false, ctx);

    expect(result.active).toBe(false);
  });

  it("RN-HOR8: permite LISTAR las franjas de un doctor inactivo", async () => {
    const db = buildDbChain({ singleSeq: [doctorInactivoRow], thenData: [franjaRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    const franjas = await HorarioService.listarPorDoctor(DOCTOR_ID, ctx);

    expect(franjas).toHaveLength(1);
  });

  it("RN-HOR8: permite ELIMINAR la franja de un doctor inactivo", async () => {
    const db = buildDbChain({ singleSeq: [franjaRow()], thenData: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await HorarioService.eliminar(FRANJA_ID, ctx);

    expect(db["delete"]).toHaveBeenCalled();
  });
});
