/**
 * Tests de integración — Avisos automáticos de Vacunación (Etapa 8, RN-PV6/PV7).
 *
 * Tres candados que los unit tests NO pueden verificar porque dependen de la base real:
 *
 *   1. RN-PV6 (idempotencia REAL): correr el procesador DOS veces contra Postgres → el
 *      aviso sale UNA sola vez. Lo garantiza el UNIQUE(tenant, origen, referencia_id,
 *      canal) de `notificaciones` disparándose de verdad (no el manejo del 23505 en
 *      código, que ya se prueba en unit). La 2ª corrida vuelve a procesar la dosis
 *      (no se filtra por notified_at) y aun así NO reenvía.
 *
 *   2. RN-PV7 (ventana por-tenant): dos tenants con `dias_aviso_vacuna` distinto y una
 *      dosis a +10 días → solo notifica el de ventana ≥ 10.
 *
 *   3. Aislamiento: el procesador de un tenant no procesa ni ve dosis de otro (el
 *      aislamiento lo da el filtro `tenant_id` explícito; `getServiceDb()` bypasea RLS).
 *
 * El envío de email se MOCKEA (canal inyectado): no se manda mail real en CI, pero la
 * base real ejecuta el INSERT idempotente y el filtro por tenant.
 *
 * Requiere Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { NotificacionService } from "../../supabase/functions/api/src/modules/notificaciones/notificaciones.service.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

// Reloj fijo: hace deterministas la ventana y las fechas sembradas, sin depender del reloj de CI.
const NOW = new Date("2026-06-30T12:00:00Z"); // dateStr → "2026-06-30"

function addDays(base: Date, n: number): string {
  const d = new Date(base.getTime() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración avisos-vacunación omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

const adminHeaders = () => ({
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
  "apikey":        SERVICE_ROLE_KEY,
});

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? "";
}

async function createAuthUser(email: string, appMetadata: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: adminHeaders(),
    body:    JSON.stringify({ email, password: "TestPass123!", email_confirm: true, app_metadata: appMetadata }),
  });
  const user = await res.json() as { id?: string };
  return user.id ?? "";
}

async function callApp(path: string, opts: { method?: string; jwt?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  return app.request(`http://localhost/api/v1${path}`, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

/** Provisiona tenant + admin + cliente CON email (necesario para el canal email). */
async function provisionTenant(sufijo: string, diasAvisoVacuna: number) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Avisos ${sufijo}`,
      cuit_rut:       `30-${Date.now().toString().slice(-7)}${sufijo}-7`,
      email_contacto: `avisos-${sufijo}@test.com`,
      plan:           "basico", // habilita módulo historial_clinico
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  // RN-PV7: fija la ventana del tenant.
  await serviceDb.from("configuracion_tenant").update({ dias_aviso_vacuna: diasAvisoVacuna }).eq("tenant_id", tenantId);

  const email  = `admin-avisos-${sufijo}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  const { data: rolAdmin } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_av_${sufijo}`,
    email, full_name: `Admin Avisos ${sufijo}`, rol_id: rolAdmin?.id, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño Avisos ${sufijo}`, email: `dueno-${sufijo}@test.com`, phone: "1122334455" })
    .select("id")
    .single();

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

// ─── Estado global ──────────────────────────────────────────────────────────

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" }; // dias_aviso_vacuna = 7
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" }; // dias_aviso_vacuna = 30
let especieId    = "";
let tipoVacunaId = "";

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: esp } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = esp?.id ?? "";
  const { data: tv } = await serviceDb.from("tipos_vacuna").select("id").eq("active", true).limit(1).single();
  tipoVacunaId = tv?.id ?? "";

  tenantA = await provisionTenant("AA", 7);
  tenantB = await provisionTenant("AB", 30);
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
    if (!tid) continue;
    // ORDEN IMPORTANTE: primero el tenant, después las cuentas de Auth.
    // Desde que `usuarios.id` referencia a `auth.users` con ON DELETE CASCADE
    // (migración 20260725000005), borrar la cuenta arrastra la fila espejo — y
    // eso lo frena cualquier FK que apunte al usuario, como
    // `historial_clinico.professional_id`. Borrando primero el tenant, su
    // cascade se lleva todo lo dependiente y la cuenta sale limpia. Al revés,
    // el DELETE de Auth falla en silencio y deja cuentas huérfanas que hacen
    // fallar la corrida SIGUIENTE (el email ya existe).
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    await serviceDb.from("tenants").delete().eq("id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    } // cascade → plan_vacunacion, notificaciones
  }
});

// ─── Helpers de datos ──────────────────────────────────────────────────────────

async function crearMascota(jwt: string, clienteId: string, name: string): Promise<string> {
  const res = await callApp("/mascotas", {
    method: "POST", jwt,
    body: { name, clientId: clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

async function seedDosis(tenantId: string, petId: string, fechaEstimada: string): Promise<string> {
  const { data } = await serviceDb
    .from("plan_vacunacion")
    .insert({ tenant_id: tenantId, pet_id: petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: fechaEstimada, estado: "Pendiente" })
    .select("id")
    .single();
  return data?.id as string;
}

/** Filas de `notificaciones` (origen='vacunacion') para una dosis. */
async function notifsDeDosis(dosisId: string): Promise<{ canal: string; estado: string }[]> {
  const { data } = await serviceDb
    .from("notificaciones").select("canal, estado")
    .eq("origen", "vacunacion").eq("referencia_id", dosisId);
  return (data ?? []) as { canal: string; estado: string }[];
}

async function getNotifiedAt(dosisId: string): Promise<string | null> {
  const { data } = await serviceDb.from("plan_vacunacion").select("notified_at").eq("id", dosisId).single();
  return (data as { notified_at: string | null }).notified_at;
}

function fakeCanalEmail() {
  return { enviar: vi.fn().mockResolvedValue(undefined) };
}

// ─── Candado 1: RN-PV6 idempotencia REAL (UNIQUE de la tabla) ────────────────

describeIntegration("Avisos vacunación: RN-PV6 idempotencia real por UNIQUE (bloqueante)", () => {
  it("dos corridas del procesador → el aviso sale UNA sola vez (2ª INSERT rechazado por UNIQUE)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AvisoIdem");
    const dosisId = await seedDosis(tenantA.tenantId, petId, addDays(NOW, 3)); // dentro de ventana 7
    const canal   = fakeCanalEmail();

    const r1 = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantA.tenantId }, { canales: { email: canal }, now: NOW },
    );
    const r2 = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantA.tenantId }, { canales: { email: canal }, now: NOW },
    );

    expect(r1).toMatchObject({ processed: 1, sent: 1, skipped: 0 });
    expect(r2).toMatchObject({ processed: 1, sent: 0, skipped: 1 }); // 2ª vez: UNIQUE rechaza
    expect(canal.enviar).toHaveBeenCalledOnce();                     // un solo envío real

    // En la base hay EXACTAMENTE una notificación para la dosis, en estado 'enviada'.
    const notifs = await notifsDeDosis(dosisId);
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ canal: "email", estado: "enviada" });

    // RN-PV6: marcador denormalizado seteado.
    expect(await getNotifiedAt(dosisId)).toBeTruthy();
  });
});

// ─── Candado 2: RN-PV7 ventana por-tenant ────────────────────────────────────

describeIntegration("Avisos vacunación: RN-PV7 ventana por-tenant (bloqueante)", () => {
  it("dosis a +10 días → tenant ventana 7 NO avisa; tenant ventana 30 SÍ avisa", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petA = await crearMascota(tenantA.jwt, tenantA.clienteId, "VentanaA");
    const petB = await crearMascota(tenantB.jwt, tenantB.clienteId, "VentanaB");
    const dosisA = await seedDosis(tenantA.tenantId, petA, addDays(NOW, 10)); // 10 > 7
    const dosisB = await seedDosis(tenantB.tenantId, petB, addDays(NOW, 10)); // 10 ≤ 30

    const canalA = fakeCanalEmail();
    await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantA.tenantId }, { canales: { email: canalA }, now: NOW },
    );
    const canalB = fakeCanalEmail();
    const rB = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantB.tenantId }, { canales: { email: canalB }, now: NOW },
    );

    // Aserciones sobre la dosis ESPECÍFICA (+10), robustas ante otras dosis del tenant.
    // Tenant A (ventana 7): la dosis a +10 queda FUERA → no se notifica.
    expect(await notifsDeDosis(dosisA)).toHaveLength(0);
    expect(await getNotifiedAt(dosisA)).toBeNull();

    // Tenant B (ventana 30): la dosis a +10 entra → se notifica exactamente una vez.
    expect(rB.sent).toBeGreaterThanOrEqual(1);
    expect(await notifsDeDosis(dosisB)).toHaveLength(1);
    expect(await getNotifiedAt(dosisB)).toBeTruthy();
  });
});

// ─── Candado 3: Aislamiento entre tenants ────────────────────────────────────

describeIntegration("Avisos vacunación: aislamiento entre tenants (bloqueante)", () => {
  it("el procesador de B no procesa ni notifica una dosis de A", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petA   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AislamientoA");
    const dosisA = await seedDosis(tenantA.tenantId, petA, addDays(NOW, 3)); // dentro de cualquier ventana

    const canalB = fakeCanalEmail();
    const rB = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantB.tenantId }, { canales: { email: canalB }, now: NOW },
    );

    // B no debe haber tocado la dosis de A.
    expect(await notifsDeDosis(dosisA)).toHaveLength(0);
    expect(await getNotifiedAt(dosisA)).toBeNull();

    // Y A, al procesar lo suyo, SÍ la avisa (control positivo).
    const canalA = fakeCanalEmail();
    const rA = await NotificacionService.procesarAvisosVacunacion(
      { tenantId: tenantA.tenantId }, { canales: { email: canalA }, now: NOW },
    );
    expect(rA.sent).toBeGreaterThanOrEqual(1);
    expect(await notifsDeDosis(dosisA)).toHaveLength(1);

    // El run de B no debe haber sumado envíos por la dosis de A.
    void rB;
  });
});

// ─── Smoke: endpoint manual (ruta + módulo + permiso + envelope) ─────────────

describeIntegration("Avisos vacunación: endpoint manual POST /notificaciones/vacunas/procesar", () => {
  it("responde 200 con el resumen { processed, sent, failed, skipped }", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    // Sin RESEND configurado el envío real falla con gracia (estado 'fallida'); lo que
    // verificamos acá es la ruta/módulo/permiso/envelope, no el proveedor.
    const res  = await callApp("/notificaciones/vacunas/procesar", { method: "POST", jwt: tenantA.jwt });
    const body = await res.json() as { success: boolean; data: Record<string, number> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("processed");
    expect(body.data).toHaveProperty("sent");
    expect(body.data).toHaveProperty("failed");
    expect(body.data).toHaveProperty("skipped");
  });
});
