/**
 * Tests de integración — Cron de notificaciones / barrido masivo (Etapa 9 — S6, RN-NT5).
 *
 * Lo que los unit tests NO pueden verificar (depende de la base real):
 *
 *   1. RN-NT5 "dispara y NO spamea": correr el BARRIDO MASIVO (sin tenantId, la ruta del
 *      cron) DOS veces contra Postgres → cada aviso sale UNA sola vez. Lo garantiza el
 *      UNIQUE(tenant, origen, referencia_id, canal) de `notificaciones` disparándose de
 *      verdad (no el manejo del 23505 en código, que ya se prueba en unit).
 *
 *   2. Filtro por módulo licenciado: el barrido de turnos solo procesa tenants con el
 *      módulo 'turnos' habilitado (plan profesional/premium). Un tenant 'basico' (turnos
 *      deshabilitado) NO se notifica AUNQUE tenga los recordatorios habilitados y un turno
 *      en ventana — el embed !inner sobre `modulos_contratados` lo excluye. En cambio los
 *      avisos de vacunación llegan a todos (historial_clinico está en todos los planes).
 *
 * El envío de email se MOCKEA (canal inyectado): no se manda mail real en CI, pero la base
 * real ejecuta el INSERT idempotente y el filtro por módulo.
 *
 * NOTA de aislamiento: el barrido es GLOBAL (todos los tenants). Para no interferir con los
 * demás archivos de integración que corren en paralelo sobre la misma DB (usan relojes
 * ~2026-06/07), este test usa un `NOW` lejano (2026-09-01) y sus aserciones son por
 * referencia_id específico, robustas ante datos de otros tenants.
 *
 * Requiere Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Para correr: npx vitest run tests/integration
 */

globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { NotificacionService } from "../../supabase/functions/api/src/modules/notificaciones/notificaciones.service.ts";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { limpiarTenant } from "./_teardown.ts";

// Reloj fijo lejano: aísla el barrido all-tenants de datos in-window de otros archivos.
const NOW = new Date("2026-09-01T09:00:00Z");

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn("⚠️  Tests de integración cron-notificaciones omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

function fakeCanalEmail() {
  return { enviar: vi.fn().mockResolvedValue(undefined) };
}

function addDays(base: Date, n: number): string {
  return new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

// ─── Estado global ──────────────────────────────────────────────────────────

let serviceDb: SupabaseClient;
let especieId = "";
let tipoVacunaId = "";

let tPro    = { tenantId: "", clienteId: "" }; // profesional → 'turnos' + 'historial_clinico'
let tBasico = { tenantId: "", clienteId: "" }; // basico      → 'historial_clinico' (turnos NO)

let turnoProId    = "";
let turnoBasicoId = "";
let dosisProId    = "";
let dosisBasicoId = "";

// ─── Seeders (directos por service-role; no hace falta API/JWT: se llama al service) ──

async function provisionTenant(sufijo: string, plan: "basico" | "profesional") {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Cron ${sufijo}`,
      cuit_rut:       `30-${Date.now().toString().slice(-7)}${sufijo}-3`,
      email_contacto: `cron-${sufijo}@test.com`,
      plan,
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  // Habilita los recordatorios de turnos y fija la ventana de vacunas. Es clave para el
  // test del filtro por MÓDULO: si el tenant basico quedara fuera por config (enabled=false)
  // no probaríamos nada; acá enabled=true en AMBOS, así el único discriminador es el módulo.
  const { data: cfgRow } = await serviceDb
    .from("configuracion_tenant").select("parametros_extra").eq("tenant_id", tenantId).single();
  const extra = ((cfgRow as { parametros_extra?: Record<string, unknown> } | null)?.parametros_extra) ?? {};
  await serviceDb.from("configuracion_tenant").update({
    parametros_extra: {
      ...extra,
      notificacionesTurnos: {
        enabled: true, hoursBeforeAppointment: 24, sendEmail: true, sendWhatsApp: false, sendSMS: false,
      },
    },
    dias_aviso_vacuna: 7,
  }).eq("tenant_id", tenantId);

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño Cron ${sufijo}`, email: `dueno-cron-${sufijo}@test.com`, phone: "1122334455" })
    .select("id")
    .single();

  return { tenantId, clienteId: cliente?.id as string };
}

async function seedMascota(tenantId: string, clienteId: string, name: string): Promise<string> {
  const { data } = await serviceDb
    .from("mascotas")
    .insert({ tenant_id: tenantId, name, client_id: clienteId, especie_id: especieId, sex: "Macho", tamano: "Mediano" })
    .select("id")
    .single();
  return data?.id as string;
}

async function seedServicio(tenantId: string): Promise<string> {
  const { data } = await serviceDb
    .from("servicios")
    .insert({ tenant_id: tenantId, nombre: `Consulta ${sufijoUnico()}`, duracion_minutos: 30, requiere_profesional: false, tipo: "clinica", activo: true })
    .select("id")
    .single();
  return data?.id as string;
}

let _seq = 0;
function sufijoUnico(): string { return `${Date.now()}-${_seq++}`; }

async function seedTurno(tenantId: string, clienteId: string, petId: string, servicioId: string): Promise<string> {
  // NOW + 9 h (mismo día) → dentro de la ventana de 24 h (debeNotificar=true).
  const { data } = await serviceDb
    .from("turnos")
    .insert({
      tenant_id: tenantId, client_id: clienteId, pet_id: petId, servicio_id: servicioId,
      date: NOW.toISOString().slice(0, 10), start_time: "18:00", end_time: "18:30",
      status: "Confirmado", reason: "Control",
    })
    .select("id")
    .single();
  return data?.id as string;
}

async function seedDosis(tenantId: string, petId: string, fechaEstimada: string): Promise<string> {
  const { data } = await serviceDb
    .from("plan_vacunacion")
    .insert({ tenant_id: tenantId, pet_id: petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: fechaEstimada, estado: "Pendiente" })
    .select("id")
    .single();
  return data?.id as string;
}

/** Filas de `notificaciones` para una referencia (turno o dosis). */
async function notifsDe(origen: "turno" | "vacunacion", referenciaId: string): Promise<{ canal: string; estado: string }[]> {
  const { data } = await serviceDb
    .from("notificaciones").select("canal, estado")
    .eq("origen", origen).eq("referencia_id", referenciaId);
  return (data ?? []) as { canal: string; estado: string }[];
}

/** Corre el barrido MASIVO (sin tenantId — la ruta del cron) de turnos + vacunas. */
async function correrBarridoMasivo() {
  const canal = fakeCanalEmail();
  await NotificacionService.procesarRecordatoriosTurnos({}, { canales: { email: canal }, now: NOW });
  await NotificacionService.procesarAvisosVacunacion({}, { canales: { email: canal }, now: NOW });
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: esp } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = esp?.id ?? "";
  const { data: tv } = await serviceDb.from("tipos_vacuna").select("id").eq("active", true).limit(1).single();
  tipoVacunaId = tv?.id ?? "";

  tPro    = await provisionTenant("PRO", "profesional");
  tBasico = await provisionTenant("BAS", "basico");

  const petPro = await seedMascota(tPro.tenantId, tPro.clienteId, "CronPro");
  const petBas = await seedMascota(tBasico.tenantId, tBasico.clienteId, "CronBas");
  turnoProId    = await seedTurno(tPro.tenantId, tPro.clienteId, petPro, await seedServicio(tPro.tenantId));
  turnoBasicoId = await seedTurno(tBasico.tenantId, tBasico.clienteId, petBas, await seedServicio(tBasico.tenantId));
  dosisProId    = await seedDosis(tPro.tenantId, petPro, addDays(NOW, 3));
  dosisBasicoId = await seedDosis(tBasico.tenantId, petBas, addDays(NOW, 3));
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tPro.tenantId, tBasico.tenantId]) await limpiarTenant(serviceDb, tid);
});

// ─── RN-NT5: el barrido dispara y NO spamea (idempotencia real por UNIQUE) ────────

describeIntegration("RN-NT5: cron (barrido all-tenants) dispara y NO spamea (bloqueante)", () => {
  it("dos corridas del barrido masivo → cada aviso queda registrado UNA sola vez", async () => {
    if (skipIfNoCredentials()) return;

    // 1ª corrida: se envían los avisos del tenant profesional y las dosis de ambos.
    await correrBarridoMasivo();

    const tras1 = await notifsDe("turno", turnoProId);
    expect(tras1).toHaveLength(1);
    expect(tras1[0]).toMatchObject({ canal: "email", estado: "enviada" });
    expect(await notifsDe("vacunacion", dosisProId)).toHaveLength(1);
    expect(await notifsDe("vacunacion", dosisBasicoId)).toHaveLength(1);

    // 2ª corrida: el 2.º INSERT choca con el UNIQUE → NO se duplica ninguna fila.
    await correrBarridoMasivo();

    expect(await notifsDe("turno", turnoProId)).toHaveLength(1);
    expect(await notifsDe("vacunacion", dosisProId)).toHaveLength(1);
    expect(await notifsDe("vacunacion", dosisBasicoId)).toHaveLength(1);
  });
});

// ─── RN-NT5: el barrido respeta el módulo licenciado ─────────────────────────────

describeIntegration("RN-NT5: el barrido masivo respeta el módulo licenciado (bloqueante)", () => {
  it("turno de un tenant SIN el módulo 'turnos' (plan basico) NO se notifica, aun con recordatorios habilitados", async () => {
    if (skipIfNoCredentials()) return;

    await correrBarridoMasivo();

    // basico: módulo 'turnos' deshabilitado → su turno queda fuera del barrido (0 filas),
    // pese a tener enabled=true y un turno en ventana.
    expect(await notifsDe("turno", turnoBasicoId)).toHaveLength(0);
    // Control positivo: el tenant profesional (turnos habilitado) SÍ se notifica.
    expect(await notifsDe("turno", turnoProId)).toHaveLength(1);
    // Vacunas: historial_clinico está en todos los planes → ambos tenants reciben aviso.
    expect(await notifsDe("vacunacion", dosisBasicoId)).toHaveLength(1);
  });
});

// ─── Endpoint interno del cron: guard por secreto (X-Cron-Secret) ────────────────

describeIntegration("RN-NT5: endpoint interno POST /internal/notificaciones/procesar (guard por secreto)", () => {
  it("rechaza sin secreto (401) y procesa con el secreto correcto (200 + resumen combinado)", async () => {
    if (skipIfNoCredentials()) return;

    const prevSecret = process.env.CRON_SECRET;
    const prevResend = process.env.RESEND_API_KEY;
    process.env.CRON_SECRET = "test-cron-secret";
    // Sin proveedor de email configurado: el barrido real marca 'fallida' en vez de enviar
    // mail de verdad (el objetivo acá es la ruta + guard + envelope, no el proveedor).
    delete process.env.RESEND_API_KEY;
    try {
      const url = "http://localhost/api/v1/internal/notificaciones/procesar";

      // Sin header X-Cron-Secret → 401 (deny-by-default; no toca tenantContext).
      const r401 = await app.request(url, { method: "POST" });
      expect(r401.status).toBe(401);

      // Con secreto incorrecto → 401.
      const rBad = await app.request(url, { method: "POST", headers: { "X-Cron-Secret": "nope" } });
      expect(rBad.status).toBe(401);

      // Con el secreto correcto → 200 y resumen combinado { turnos, vacunas }.
      const rOk = await app.request(url, { method: "POST", headers: { "X-Cron-Secret": "test-cron-secret" } });
      const body = await rOk.json() as { success: boolean; data: { turnos: unknown; vacunas: unknown } };
      expect(rOk.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty("turnos");
      expect(body.data).toHaveProperty("vacunas");
    } finally {
      if (prevSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prevSecret;
      if (prevResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevResend;
    }
  });
});
