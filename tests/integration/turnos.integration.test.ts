/**
 * Tests de integración — Agendar Turno (Etapa 6, RN-TU3/TU4 + RLS).
 *
 * El test CRÍTICO de esta etapa es la CONCURRENCIA: dos requests simultáneos para
 * el mismo bloque de un doctor deben resolver en exactamente UN turno persistido.
 * La guarda real es el constraint `excl_turnos_solapados` (EXCLUDE USING gist) que
 * existe desde la Etapa 1; el Service mapea el error 23P01 → TURNO_SOLAPADO. NO hay
 * pre-check de solapamiento (sería una condición de carrera TOCTOU): la base es la
 * única fuente de verdad, igual que el rollback lo fue en la eutanasia.
 *
 * Requiere un proyecto Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Correr:  npx vitest run tests/integration/turnos.integration.test.ts
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración turnos omitidos: falta configuración Supabase en .env");
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

/** Aprovisiona un tenant 'profesional' (módulo turnos habilitado) con su admin y un cliente. */
async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Turnos ${sufijo}`,
      cuit_rut:       `30-${Date.now().toString().slice(-7)}${sufijo}-4`,
      email_contacto: `turnos-${sufijo}@test.com`,
      plan:           "profesional", // profesional → módulo turnos habilitado
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-turnos-${sufijo}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  const { data: rolAdmin } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_${sufijo}`,
    email, full_name: `Admin ${sufijo}`, rol_id: rolAdmin?.id, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño ${sufijo}`, phone: "1112223334" })
    .select("id")
    .single();

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let especieId = "";

// Fecha futura fija; la franja del doctor se siembra con su día de la semana real.
const FECHA = "2099-12-31";
const DOW   = new Date(`${FECHA}T00:00:00Z`).getUTCDay(); // 0=Dom … 6=Sáb

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: especie } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = especie?.id ?? "";

  tenantA = await provisionTenant(serviceDb, "TA");
  tenantB = await provisionTenant(serviceDb, "TB");
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
    if (!tid) continue;
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
    await serviceDb.from("tenants").delete().eq("id", tid);
  }
});

// ─── Helpers de datos (siembra directa, bypass RLS, para setup determinista) ─────

async function seedServicio(tenantId: string, requiereProfesional: boolean): Promise<string> {
  const { data } = await serviceDb
    .from("servicios")
    .insert({
      tenant_id: tenantId, nombre: `Consulta ${Date.now()}`, tipo: "clinica",
      duracion_minutos: 30, requiere_profesional: requiereProfesional, activo: true,
    })
    .select("id")
    .single();
  return data?.id as string;
}

/** Doctor con una franja activa 09:00–12:00 el día de FECHA, suficiente para el bloque 10:00–10:30. */
async function seedDoctorConFranja(tenantId: string): Promise<string> {
  const { data: doctor } = await serviceDb
    .from("doctores")
    .insert({ tenant_id: tenantId, name: `Dra. Test ${Date.now()}`, available: true })
    .select("id")
    .single();
  const doctorId = doctor?.id as string;
  await serviceDb.from("horarios_doctor").insert({
    tenant_id: tenantId, doctor_id: doctorId, day_of_week: DOW,
    start_time: "09:00", end_time: "12:00", active: true,
  });
  return doctorId;
}

async function seedMascota(tenantId: string, clienteId: string, name: string): Promise<string> {
  const { data } = await serviceDb
    .from("mascotas")
    .insert({
      tenant_id: tenantId, client_id: clienteId, especie_id: especieId,
      name, sex: "Macho", tamano: "Mediano", estado: "Activa",
    })
    .select("id")
    .single();
  return data?.id as string;
}

async function contarTurnos(doctorId: string): Promise<number> {
  const { count } = await serviceDb
    .from("turnos")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", doctorId)
    .eq("date", FECHA)
    .eq("start_time", "10:00:00");
  return count ?? 0;
}

// ─── Caso CRÍTICO: concurrencia (RN-TU3, vía EXCLUDE) ───────────────────────────

describeIntegration("Agendar Turno: concurrencia (RN-TU3) — el más crítico", () => {
  it("dos requests simultáneos al mismo bloque del doctor → solo uno persiste (201 + 409 TURNO_SOLAPADO)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const servicioId = await seedServicio(tenantA.tenantId, true);
    const doctorId   = await seedDoctorConFranja(tenantA.tenantId);
    // Dos mascotas DISTINTAS del mismo cliente: descarta el UNIQUE(client,pet,date,start),
    // de modo que el discriminador sea el EXCLUDE de solapamiento del doctor.
    const pet1 = await seedMascota(tenantA.tenantId, tenantA.clienteId, "TurnoPet1");
    const pet2 = await seedMascota(tenantA.tenantId, tenantA.clienteId, "TurnoPet2");

    const body = (petId: string) => ({
      servicioId, clientId: tenantA.clienteId, petId, doctorId,
      date: FECHA, startTime: "10:00", reason: "Control",
    });

    const [r1, r2] = await Promise.all([
      callApp("/turnos", { method: "POST", jwt: tenantA.jwt, body: body(pet1) }),
      callApp("/turnos", { method: "POST", jwt: tenantA.jwt, body: body(pet2) }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = r1.status === 409 ? r1 : r2;
    const lb = await loser.json() as { error: { code: string } };
    expect(lb.error.code).toBe("TURNO_SOLAPADO");

    // La base tiene EXACTAMENTE un turno en ese bloque del doctor.
    expect(await contarTurnos(doctorId)).toBe(1);
  });
});

// ─── Caso: duplicado exacto (RN-TU4, vía UNIQUE) ────────────────────────────────

describeIntegration("Agendar Turno: duplicado exacto (RN-TU4)", () => {
  it("misma mascota+fecha+hora dos veces → DUPLICATE_APPOINTMENT en el segundo", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const servicioId = await seedServicio(tenantA.tenantId, false); // sin doctor (aísla el UNIQUE)
    const pet = await seedMascota(tenantA.tenantId, tenantA.clienteId, "DupPet");
    const body = {
      servicioId, clientId: tenantA.clienteId, petId: pet,
      date: FECHA, startTime: "11:00", reason: "Control",
    };

    const r1 = await callApp("/turnos", { method: "POST", jwt: tenantA.jwt, body });
    expect(r1.status).toBe(201);

    const r2 = await callApp("/turnos", { method: "POST", jwt: tenantA.jwt, body });
    const b2 = await r2.json() as { error: { code: string } };
    expect(r2.status).toBe(409);
    expect(b2.error.code).toBe("DUPLICATE_APPOINTMENT");
  });
});

// ─── Caso: aislamiento por tenant (RLS, bloqueante) ─────────────────────────────

describeIntegration("Agendar Turno: aislamiento por tenant (RLS, bloqueante)", () => {
  it("un turno de A no es visible para B bajo RLS", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const servicioId = await seedServicio(tenantA.tenantId, false);
    const pet = await seedMascota(tenantA.tenantId, tenantA.clienteId, "RlsPet");
    const r = await callApp("/turnos", {
      method: "POST", jwt: tenantA.jwt,
      body: { servicioId, clientId: tenantA.clienteId, petId: pet, date: FECHA, startTime: "08:00", reason: "Control" },
    });
    const created = await r.json() as { data: { id: string } };
    expect(r.status).toBe(201);
    const turnoId = created.data.id;

    // Cliente RLS-scoped como B: NO debe ver el turno de A.
    const dbB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${tenantB.jwt}` } },
    });
    const { data: visibleB } = await dbB.from("turnos").select("id").eq("id", turnoId);
    expect(visibleB ?? []).toHaveLength(0);

    // Cliente RLS-scoped como A: SÍ lo ve (sanity: RLS no bloquea al dueño).
    const dbA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${tenantA.jwt}` } },
    });
    const { data: visibleA } = await dbA.from("turnos").select("id").eq("id", turnoId);
    expect((visibleA ?? []).length).toBe(1);
  });
});
