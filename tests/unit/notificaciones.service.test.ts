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
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import { NotificacionService } from "../../supabase/functions/api/src/modules/notificaciones/notificaciones.service.ts";
import { CONFIG_NOTIF_TURNOS_DEFAULT } from "../../supabase/functions/api/src/modules/notificaciones/notificaciones.schemas.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-06-29T09:00:00Z");

const ctx = {
  tenantId:     TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName:   "Admin Leo",
  callerRole:   "admin",
};

const configHabilitada = {
  enabled: true,
  hoursBeforeAppointment: 24,
  sendEmail: true,
  sendWhatsApp: false,
  sendSMS: false,
};

/** Construye una fila de turno en la forma del embed (cliente/mascota/servicio). */
function turnoRow(over: {
  id?: string;
  date?: string;
  start_time?: string;
  status?: string;
  email?: string | null;
  phone?: string | null;
} = {}): Record<string, unknown> {
  return {
    id:         over.id ?? "turno-1",
    date:       over.date ?? "2026-06-29",
    start_time: over.start_time ?? "18:00:00", // 9 h después de NOW → dentro de 24 h
    status:     over.status ?? "Confirmado",
    cliente:    {
      full_name: "Juan Pérez",
      email: over.email === undefined ? "juan@example.com" : over.email,
      phone: over.phone === undefined ? null : over.phone,
    },
    mascota:    { name: "Firulais" },
    servicio:   { nombre: "Consulta General" },
  };
}

/**
 * Mock de DB que distingue por tabla y operación. `getServiceDb()` siempre
 * devuelve el mismo builder; las queries son secuenciales y awaited, así que el
 * estado mutable se resuelve antes de la siguiente.
 */
function makeDb(opts: {
  configRow?: Record<string, unknown> | null;
  tenantsList?: Record<string, unknown>[];
  turnosList?: Record<string, unknown>[];
  insertResults?: { data: unknown; error: { code?: string; message?: string } | null }[];
} = {}) {
  const calls = {
    from:         [] as string[],
    notifInserts: [] as Record<string, unknown>[],
    notifUpdates: [] as Record<string, unknown>[],
    configUpdates: [] as Record<string, unknown>[],
  };
  let notifInsertIdx = 0;
  const state = { table: "" as string, op: "select" as string };

  function resolveTerminal(): Promise<{ data: unknown; error: unknown }> {
    if (state.table === "configuracion_tenant") {
      return Promise.resolve({ data: opts.configRow ?? null, error: null });
    }
    if (state.table === "tenants") {
      return Promise.resolve({ data: opts.tenantsList ?? [], error: null });
    }
    if (state.table === "turnos") {
      return Promise.resolve({ data: opts.turnosList ?? [], error: null });
    }
    if (state.table === "notificaciones") {
      if (state.op === "insert") {
        const r = opts.insertResults?.[notifInsertIdx] ?? { data: { id: `notif-${notifInsertIdx}` }, error: null };
        notifInsertIdx++;
        return Promise.resolve(r);
      }
      return Promise.resolve({ data: null, error: null }); // update
    }
    return Promise.resolve({ data: null, error: null });
  }

  const builder: Record<string, unknown> = {};
  builder["from"]   = (t: string) => { state.table = t; state.op = "select"; calls.from.push(t); return builder; };
  builder["select"] = () => builder;
  builder["insert"] = (p: Record<string, unknown>) => {
    state.op = "insert";
    if (state.table === "notificaciones") calls.notifInserts.push(p);
    return builder;
  };
  builder["update"] = (p: Record<string, unknown>) => {
    state.op = "update";
    if (state.table === "notificaciones") calls.notifUpdates.push(p);
    if (state.table === "configuracion_tenant") calls.configUpdates.push(p);
    return builder;
  };
  builder["eq"]   = () => builder;
  builder["in"]   = () => builder;
  builder["gte"]  = () => builder;
  builder["lte"]  = () => builder;
  builder["order"] = () => builder;
  builder["maybeSingle"] = () => resolveTerminal();
  builder["single"]      = () => resolveTerminal();
  builder["then"] = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    resolveTerminal().then(onF, onR);

  builder["_calls"] = calls;
  return builder;
}

function fakeCanalEmail() {
  return { enviar: vi.fn().mockResolvedValue(undefined) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NotificacionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-NT1: ventana de envío ────────────────────────────────────────────────

  it("RN-NT1: turno dentro de la ventana (9 h ≤ 24 h) → debeNotificar=true", () => {
    const turno = mapForPure({ start_time: "18:00:00" });
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(true);
  });

  it("RN-NT1: turno fuera de la ventana (>24 h) → debeNotificar=false", () => {
    const turno = mapForPure({ date: "2026-07-02", start_time: "10:00:00" });
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(false);
  });

  it("RN-NT1: borde exacto (horasRestantes = antelación) → debeNotificar=true", () => {
    const turno = mapForPure({ date: "2026-06-30", start_time: "09:00:00" }); // exactamente 24 h
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(true);
  });

  it("RN-NT1: turno pasado (horasRestantes ≤ 0) → debeNotificar=false", () => {
    const turno = mapForPure({ date: "2026-06-29", start_time: "08:00:00" }); // 1 h antes de NOW
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(false);
  });

  // ── RN-NT2: estados excluidos ─────────────────────────────────────────────────

  it("RN-NT2: turno Cancelado nunca se notifica", () => {
    const turno = mapForPure({ status: "Cancelado", start_time: "18:00:00" });
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(false);
  });

  it("RN-NT2: turno Completado nunca se notifica", () => {
    const turno = mapForPure({ status: "Completado", start_time: "18:00:00" });
    expect(NotificacionService.debeNotificar(turno, configHabilitada, NOW)).toBe(false);
  });

  // ── RN-NT4: canales según contacto ────────────────────────────────────────────

  it("RN-NT4: cliente con email y sin teléfono → solo canal email", () => {
    const canales = NotificacionService.canalesDisponibles(
      { fullName: "X", email: "a@b.com", phone: null },
      { ...configHabilitada, sendWhatsApp: true, sendSMS: true },
    );
    expect(canales).toEqual(["email"]);
  });

  it("RN-NT4: cliente sin ningún contacto → ningún canal", () => {
    const canales = NotificacionService.canalesDisponibles(
      { fullName: "X", email: null, phone: null },
      { ...configHabilitada, sendWhatsApp: true, sendSMS: true },
    );
    expect(canales).toEqual([]);
  });

  it("RN-NT4: canal email desactivado en config no se usa aunque haya email", () => {
    const canales = NotificacionService.canalesDisponibles(
      { fullName: "X", email: "a@b.com", phone: null },
      { ...configHabilitada, sendEmail: false },
    );
    expect(canales).toEqual([]);
  });

  // ── procesarRecordatoriosTurnos: envío feliz ──────────────────────────────────

  it("envía un recordatorio por email y cuenta sent=1", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [turnoRow()],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID },
      { canales: { email: canal }, now: NOW },
    );

    expect(canal.enviar).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ processed: 1, sent: 1, failed: 0, skipped: 0 });
    // se marcó enviada
    const calls = (db["_calls"] as { notifUpdates: Record<string, unknown>[] });
    expect(calls.notifUpdates[0]?.["estado"]).toBe("enviada");
  });

  // ── RN-NT6: auditoría del envío como evento del sistema ───────────────────────

  it("RN-NT6: cada envío registra auditoría con module='system'", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [turnoRow()],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID },
      { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("system");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.entityId).toBe("turno-1");
  });

  // ── RN-NT3: idempotencia (no reenviar) ────────────────────────────────────────

  it("RN-NT3: un segundo procesamiento del mismo turno no reenvía (skipped, sin llamar al canal)", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [turnoRow()],
      insertResults: [
        { data: { id: "notif-0" }, error: null },          // 1ª corrida: inserta
        { data: null, error: { code: "23505" } },           // 2ª corrida: conflicto UNIQUE
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const r1 = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );
    const r2 = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(r1).toMatchObject({ processed: 1, sent: 1, skipped: 0 });
    expect(r2).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
    // El canal solo se invocó UNA vez en total (RN-NT3).
    expect(canal.enviar).toHaveBeenCalledOnce();
  });

  // ── RN-NT4 (flujo 3a): sin contacto → fallida ─────────────────────────────────

  it("RN-NT4: turno cuyo cliente no tiene contacto → fallida, sin invocar el canal", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [turnoRow({ email: null, phone: null })],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(canal.enviar).not.toHaveBeenCalled();
    expect(res).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const calls = (db["_calls"] as { notifInserts: Record<string, unknown>[] });
    expect(calls.notifInserts[0]?.["estado"]).toBe("fallida");
    expect(calls.notifInserts[0]?.["failure_reason"]).toBeTruthy();
  });

  // ── Error del proveedor → fallida, no rompe el lote ──────────────────────────

  it("si el canal arroja al enviar → notificación fallida con motivo (failed=1)", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [turnoRow()],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = { enviar: vi.fn().mockRejectedValue(new Error("Resend respondió 500")) };

    const res = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(res).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const calls = (db["_calls"] as { notifUpdates: Record<string, unknown>[] });
    expect(calls.notifUpdates[0]?.["estado"]).toBe("fallida");
    expect(calls.notifUpdates[0]?.["failure_reason"]).toContain("Resend");
  });

  // ── config deshabilitada → no procesa ─────────────────────────────────────────

  it("config deshabilitada (enabled=false) → no se procesa ningún turno", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: { ...configHabilitada, enabled: false } } },
      turnosList: [turnoRow()],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(canal.enviar).not.toHaveBeenCalled();
    expect(res).toMatchObject({ processed: 0, sent: 0 });
  });

  // ── tenant del JWT: disparo manual scopa a un solo tenant ─────────────────────

  it("disparo manual (tenantId) procesa SOLO ese tenant (no barre 'tenants')", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      turnosList: [],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarRecordatoriosTurnos(
      { tenantId: TENANT_ID }, { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    const calls = (db["_calls"] as { from: string[] });
    expect(calls.from).not.toContain("tenants"); // no hace barrido global
    expect(calls.from).toContain("turnos");
  });

  it("cron (sin tenantId) barre la tabla 'tenants'", async () => {
    const db = makeDb({
      configRow: { parametros_extra: { notificacionesTurnos: configHabilitada } },
      tenantsList: [{ id: TENANT_ID }],
      turnosList: [],
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarRecordatoriosTurnos(
      {}, { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    const calls = (db["_calls"] as { from: string[] });
    expect(calls.from).toContain("tenants");
  });

  // ── Config: defaults, validación y merge ──────────────────────────────────────

  it("obtenerConfig devuelve defaults cuando el tenant no guardó nada", async () => {
    const db = makeDb({ configRow: { parametros_extra: {} } });
    mockGetServiceDb.mockReturnValue(db as never);

    const cfg = await NotificacionService.obtenerConfig(TENANT_ID);
    expect(cfg).toEqual(CONFIG_NOTIF_TURNOS_DEFAULT);
  });

  it("guardarConfig rechaza hoursBeforeAppointment=0 → VALIDATION_ERROR", async () => {
    const db = makeDb({ configRow: { parametros_extra: {} } });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(
      NotificacionService.guardarConfig(
        TENANT_ID,
        { ...configHabilitada, hoursBeforeAppointment: 0 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 422 });
  });

  it("guardarConfig hace merge en parametros_extra sin pisar otras claves", async () => {
    const db = makeDb({ configRow: { parametros_extra: { otraClave: 42 } } });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.guardarConfig(TENANT_ID, configHabilitada, ctx);

    const calls = (db["_calls"] as { configUpdates: Record<string, unknown>[] });
    const extra = calls.configUpdates[0]?.["parametros_extra"] as Record<string, unknown>;
    expect(extra["otraClave"]).toBe(42);
    expect(extra["notificacionesTurnos"]).toMatchObject(configHabilitada);
    // RN-NT6: auditoría del cambio de config en módulo system.
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit.mock.calls[0][1].module).toBe("system");
  });

  // Avisos de vacunación (procesarAvisosVacunacion) se prueban en
  // tests/unit/vacunacion-avisos.service.test.ts (RN-PV6/PV7).
});

/** Helper para construir el shape interno que espera debeNotificar (no usa DB). */
function mapForPure(over: { date?: string; start_time?: string; status?: string } = {}) {
  return {
    id: "t",
    date: over.date ?? "2026-06-29",
    startTime: over.start_time ?? "18:00:00",
    status: over.status ?? "Confirmado",
    cliente: { fullName: "X", email: "a@b.com", phone: null },
    mascota: "Firulais",
    servicio: "Consulta",
  };
}
