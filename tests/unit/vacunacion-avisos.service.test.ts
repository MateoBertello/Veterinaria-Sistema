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

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit  = vi.mocked(recordAudit);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID  = "11111111-1111-4111-8111-111111111111";
const TENANT_B   = "33333333-3333-4333-8333-333333333333";
const NOW        = new Date("2026-06-29T09:00:00Z"); // dateStr → "2026-06-29"

const canalConfig = {
  enabled: true,            // no se mira en vacunación, pero lo dejamos explícito
  hoursBeforeAppointment: 24,
  sendEmail: true,
  sendWhatsApp: false,
  sendSMS: false,
};

/** Fila de configuracion_tenant: trae ambas lecturas (dias_aviso_vacuna + parametros_extra). */
function configRow(diasAvisoVacuna = 7): Record<string, unknown> {
  return {
    dias_aviso_vacuna: diasAvisoVacuna,
    parametros_extra:  { notificacionesTurnos: canalConfig },
  };
}

/** Fila de plan_vacunacion en la forma del embed (mascota → cliente, tipo). */
function dosisRow(over: {
  id?: string;
  fecha_estimada?: string;
  estado?: string;
  notified_at?: string | null;
  email?: string | null;
  phone?: string | null;
  mascota?: string;
  tipo?: string;
} = {}): Record<string, unknown> {
  return {
    id:             over.id ?? "dosis-1",
    fecha_estimada: over.fecha_estimada ?? "2026-07-05", // +6 días de NOW
    estado:         over.estado ?? "Pendiente",
    notified_at:    over.notified_at ?? null,
    mascota: {
      name: over.mascota ?? "Firulais",
      cliente: {
        full_name: "Juan Pérez",
        email: over.email === undefined ? "juan@example.com" : over.email,
        phone: over.phone === undefined ? null : over.phone,
      },
    },
    tipo: { nombre: over.tipo ?? "Antirrábica" },
  };
}

/** Shape interno que espera debeAvisarVacuna (no usa DB). */
function dosisMapped(over: { fechaEstimada?: string; estado?: string } = {}) {
  return {
    id: "d",
    fechaEstimada: over.fechaEstimada ?? "2026-07-05",
    estado: over.estado ?? "Pendiente",
    cliente: { fullName: "X", email: "a@b.com", phone: null },
    mascota: "Firulais",
    tipoVacuna: "Antirrábica",
  };
}

/**
 * Mock de DB por tabla y operación. Las queries son secuenciales y awaited, así que
 * el estado mutable se resuelve antes de la siguiente (igual que el de turnos).
 */
function makeDb(opts: {
  configRow?: Record<string, unknown> | null;
  tenantsList?: Record<string, unknown>[];
  dosisList?: Record<string, unknown>[];
  insertResults?: { data: unknown; error: { code?: string; message?: string } | null }[];
} = {}) {
  const calls = {
    from:         [] as string[],
    notifInserts: [] as Record<string, unknown>[],
    notifUpdates: [] as Record<string, unknown>[],
    planUpdates:  [] as Record<string, unknown>[],
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
    if (state.table === "plan_vacunacion") {
      if (state.op === "select") return Promise.resolve({ data: opts.dosisList ?? [], error: null });
      return Promise.resolve({ data: null, error: null }); // update notified_at
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
    if (state.table === "plan_vacunacion") calls.planUpdates.push(p);
    return builder;
  };
  builder["eq"]    = () => builder;
  builder["in"]    = () => builder;
  builder["gte"]   = () => builder;
  builder["lte"]   = () => builder;
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

describe("NotificacionService.procesarAvisosVacunacion (RN-PV6/PV7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── RN-PV7: ventana de aviso (puro) ───────────────────────────────────────────

  it("RN-PV7: dosis dentro de la ventana (diff=6 ≤ 7) → debeAvisarVacuna=true", () => {
    expect(NotificacionService.debeAvisarVacuna(dosisMapped({ fechaEstimada: "2026-07-05" }), 7, NOW)).toBe(true);
  });

  it("RN-PV7: dosis fuera de la ventana (diff=10 > 7) → debeAvisarVacuna=false", () => {
    expect(NotificacionService.debeAvisarVacuna(dosisMapped({ fechaEstimada: "2026-07-09" }), 7, NOW)).toBe(false);
  });

  it("RN-PV7: borde exacto (diff = diasAvisoVacuna) → debeAvisarVacuna=true", () => {
    expect(NotificacionService.debeAvisarVacuna(dosisMapped({ fechaEstimada: "2026-07-06" }), 7, NOW)).toBe(true);
  });

  it("RN-PV7: fecha pasada (diff < 0) → debeAvisarVacuna=false", () => {
    expect(NotificacionService.debeAvisarVacuna(dosisMapped({ fechaEstimada: "2026-06-28" }), 7, NOW)).toBe(false);
  });

  it("RN-PV7: dosis no Pendiente (Aplicada) nunca entra en ventana", () => {
    expect(NotificacionService.debeAvisarVacuna(dosisMapped({ estado: "Aplicada" }), 7, NOW)).toBe(false);
  });

  // ── Envío feliz ───────────────────────────────────────────────────────────────

  it("envía un aviso por email (origen='vacunacion'), cuenta sent=1 y marca notified_at", async () => {
    const db = makeDb({ configRow: configRow(7), dosisList: [dosisRow()] });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID },
      { canales: { email: canal }, now: NOW },
    );

    expect(canal.enviar).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ processed: 1, sent: 1, failed: 0, skipped: 0 });

    const calls = db["_calls"] as {
      notifInserts: Record<string, unknown>[];
      notifUpdates: Record<string, unknown>[];
      planUpdates:  Record<string, unknown>[];
    };
    expect(calls.notifInserts[0]?.["origen"]).toBe("vacunacion");
    expect(calls.notifInserts[0]?.["referencia_id"]).toBe("dosis-1");
    expect(calls.notifInserts[0]?.["mensaje"]).toContain("vence el 2026-07-05");
    expect(calls.notifUpdates[0]?.["estado"]).toBe("enviada");
    // RN-PV6: marcador denormalizado tras envío.
    expect(calls.planUpdates[0]?.["notified_at"]).toBeTruthy();
  });

  it("RN-PV8/auditoría: cada aviso registra auditoría con module='system' y entityId=dosis", async () => {
    const db = makeDb({ configRow: configRow(7), dosisList: [dosisRow()] });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID },
      { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditArg = mockRecordAudit.mock.calls[0][1];
    expect(auditArg.module).toBe("system");
    expect(auditArg.tenantId).toBe(TENANT_ID);
    expect(auditArg.entityId).toBe("dosis-1");
  });

  // ── RN-PV6: idempotencia (dos corridas seguidas no reenvían) ──────────────────

  it("RN-PV6: dos corridas seguidas no reenvían (2ª → skipped por UNIQUE), canal una sola vez", async () => {
    const db = makeDb({
      configRow: configRow(7),
      dosisList: [dosisRow()],
      insertResults: [
        { data: { id: "notif-0" }, error: null },  // 1ª corrida: inserta
        { data: null, error: { code: "23505" } },  // 2ª corrida: conflicto UNIQUE
      ],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const r1 = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );
    const r2 = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(r1).toMatchObject({ processed: 1, sent: 1, skipped: 0 });
    expect(r2).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
    // El aviso salió UNA sola vez aunque la 2ª corrida SÍ procesó la dosis (no se filtra por notified_at).
    expect(canal.enviar).toHaveBeenCalledOnce();
  });

  // ── RN-PV7: dos tenants con ventanas distintas ────────────────────────────────

  it("RN-PV7: dos tenants con dias_aviso_vacuna distinto avisan en su propia ventana", async () => {
    const dosis = [dosisRow({ fecha_estimada: "2026-07-09" })]; // +10 días

    // Tenant A: ventana 7 → +10 queda fuera → no procesa.
    const dbA = makeDb({ configRow: configRow(7), dosisList: dosis });
    mockGetServiceDb.mockReturnValue(dbA as never);
    const canalA = fakeCanalEmail();
    const rA = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canalA }, now: NOW },
    );

    // Tenant B: ventana 30 → +10 queda dentro → avisa.
    const dbB = makeDb({ configRow: configRow(30), dosisList: dosis });
    mockGetServiceDb.mockReturnValue(dbB as never);
    const canalB = fakeCanalEmail();
    const rB = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_B }, { canales: { email: canalB }, now: NOW },
    );

    expect(rA).toMatchObject({ processed: 0, sent: 0 });
    expect(canalA.enviar).not.toHaveBeenCalled();

    expect(rB).toMatchObject({ processed: 1, sent: 1 });
    expect(canalB.enviar).toHaveBeenCalledOnce();
  });

  // ── Exclusiones ───────────────────────────────────────────────────────────────

  it("dosis Aplicada/Cancelada no se procesan (defensa en código además del filtro de query)", async () => {
    const db = makeDb({
      configRow: configRow(7),
      dosisList: [dosisRow({ estado: "Aplicada" }), dosisRow({ id: "d2", estado: "Cancelada" })],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(res).toMatchObject({ processed: 0, sent: 0 });
    expect(canal.enviar).not.toHaveBeenCalled();
  });

  // ── Sin contacto → fallida ────────────────────────────────────────────────────

  it("cliente sin email/teléfono → fallida (origen='vacunacion'), sin invocar el canal", async () => {
    const db = makeDb({
      configRow: configRow(7),
      dosisList: [dosisRow({ email: null, phone: null })],
    });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = fakeCanalEmail();

    const res = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(canal.enviar).not.toHaveBeenCalled();
    expect(res).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const calls = db["_calls"] as { notifInserts: Record<string, unknown>[] };
    expect(calls.notifInserts[0]?.["estado"]).toBe("fallida");
    expect(calls.notifInserts[0]?.["origen"]).toBe("vacunacion");
  });

  // ── Error del proveedor → fallida, no rompe el lote ──────────────────────────

  it("si el canal arroja al enviar → aviso fallido con motivo (failed=1)", async () => {
    const db = makeDb({ configRow: configRow(7), dosisList: [dosisRow()] });
    mockGetServiceDb.mockReturnValue(db as never);
    const canal = { enviar: vi.fn().mockRejectedValue(new Error("Resend respondió 500")) };

    const res = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: canal }, now: NOW },
    );

    expect(res).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const calls = db["_calls"] as { notifUpdates: Record<string, unknown>[]; planUpdates: Record<string, unknown>[] };
    expect(calls.notifUpdates[0]?.["estado"]).toBe("fallida");
    expect(calls.notifUpdates[0]?.["failure_reason"]).toContain("Resend");
    // No se marca notified_at si no hubo envío.
    expect(calls.planUpdates.length).toBe(0);
  });

  // ── tenant del JWT vs cron ────────────────────────────────────────────────────

  it("disparo manual (tenantId) procesa SOLO ese tenant (no barre 'tenants')", async () => {
    const db = makeDb({ configRow: configRow(7), dosisList: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarAvisosVacunacion(
      { tenantId: TENANT_ID }, { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    const calls = db["_calls"] as { from: string[] };
    expect(calls.from).not.toContain("tenants");
    expect(calls.from).toContain("plan_vacunacion");
  });

  it("cron (sin tenantId) barre la tabla 'tenants'", async () => {
    const db = makeDb({ configRow: configRow(7), tenantsList: [{ id: TENANT_ID }], dosisList: [] });
    mockGetServiceDb.mockReturnValue(db as never);

    await NotificacionService.procesarAvisosVacunacion(
      {}, { canales: { email: fakeCanalEmail() }, now: NOW },
    );

    const calls = db["_calls"] as { from: string[] };
    expect(calls.from).toContain("tenants");
  });
});
