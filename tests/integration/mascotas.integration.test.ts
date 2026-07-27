/**
 * Tests de integración — Mascotas (Etapa 3, v1.1).
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Para correr: npx vitest run tests/integration
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración mascotas omitidos: falta configuración Supabase en .env");
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

/** Aprovisiona un tenant con su admin (rol con manage_pets) y un cliente propio. */
async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Mascotas ${sufijo}`,
      cuit_rut:       `30-${Date.now().toString().slice(-7)}${sufijo}-9`,
      email_contacto: `mascotas-${sufijo}@test.com`,
      plan:           "basico",
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-mascotas-${sufijo}@test.com`;
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

  return { tenantId, jwt, clienteId: cliente?.id as string };
}

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", clienteId: "" };
let especieId = "";
let razaId    = "";

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Catálogos globales (sembrados en seed_global.sql).
  const { data: especie } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = especie?.id ?? "";
  const { data: raza } = await serviceDb.from("razas").select("id").eq("especie_id", especieId).limit(1).single();
  razaId = raza?.id ?? "";

  tenantA = await provisionTenant(serviceDb, "A");
  tenantB = await provisionTenant(serviceDb, "B");
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
    }
  }
});

// ─── Alta y aislamiento ───────────────────────────────────────────────────────

describeIntegration("Mascotas: alta vía API", () => {
  it("POST /mascotas crea la mascota del tenant con estado 'Activa' (RN-MA10)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const res = await callApp("/mascotas", {
      method: "POST", jwt: tenantA.jwt,
      body: {
        name: "Firulais", clientId: tenantA.clienteId, especieId, razaId,
        sex: "Macho", tamano: "Mediano", alimentoDieta: "Croquetas",
      },
    });
    const body = await res.json() as { success: boolean; data: { id: string; estado: string; ownerName: string } };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe("Activa");
    expect(body.data.ownerName).toBeTruthy(); // embed del dueño (sin N+1)
  });

  it("RN-MA8: tamano fuera del ENUM → 422 VALIDATION_ERROR", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const res = await callApp("/mascotas", {
      method: "POST", jwt: tenantA.jwt,
      body: { name: "X", clientId: tenantA.clienteId, especieId, sex: "Macho", tamano: "Enorme" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("FK cross-tenant: no se puede crear mascota contra un cliente de otro tenant", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const res = await callApp("/mascotas", {
      method: "POST", jwt: tenantA.jwt,
      body: {
        name: "Intruso", clientId: tenantB.clienteId, especieId,
        sex: "Hembra", tamano: "Pequeño",
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describeIntegration("Mascotas: aislamiento por tenant (RLS, bloqueante)", () => {
  it("el listado de B no contiene mascotas de A", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    // A crea una mascota.
    await callApp("/mascotas", {
      method: "POST", jwt: tenantA.jwt,
      body: { name: "SoloDeA", clientId: tenantA.clienteId, especieId, sex: "Macho", tamano: "Grande" },
    });

    const res  = await callApp("/mascotas", { jwt: tenantB.jwt });
    const body = await res.json() as { data: Array<{ name: string }> };
    expect(res.status).toBe(200);
    expect(body.data.some((m) => m.name === "SoloDeA")).toBe(false);
  });
});

// ─── Cambiar Dueño de Mascota (RN-CD1..CD5) ────────────────────────────────────

/** Crea una mascota de un tenant y devuelve su id. */
async function crearMascota(jwt: string, clienteId: string, name = "Transferible"): Promise<string> {
  const res = await callApp("/mascotas", {
    method: "POST", jwt,
    body: { name, clientId: clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

describeIntegration("Cambiar Dueño de Mascota (RN-CD)", () => {
  it("RN-CD2: transfiere atómicamente y deja trazabilidad consultable", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    // Segundo cliente del tenant A (destino de la transferencia).
    const { data: nuevoDueno } = await serviceDb
      .from("clientes")
      .insert({ tenant_id: tenantA.tenantId, full_name: "Nuevo Dueño A", phone: "1100009999" })
      .select("id").single();
    const newClientId = nuevoDueno?.id as string;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId);

    const res = await callApp(`/mascotas/${petId}/cambio-dueno`, {
      method: "POST", jwt: tenantA.jwt,
      body: { newClientId, reason: "Adopción", notes: "Acordado por escrito" },
    });
    const body = await res.json() as { success: boolean; data: { newClientName: string } };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.newClientName).toBe("Nuevo Dueño A");

    // (a) la mascota quedó con el nuevo dueño.
    const det = await callApp(`/mascotas/${petId}`, { jwt: tenantA.jwt });
    const detBody = await det.json() as { data: { clientId: string } };
    expect(detBody.data.clientId).toBe(newClientId);

    // (b) la trazabilidad es consultable (RN-CD2).
    const hist = await callApp(`/mascotas/${petId}/cambios-dueno`, { jwt: tenantA.jwt });
    const histBody = await hist.json() as { data: Array<{ previousClientName: string; newClientName: string }> };
    expect(histBody.data.length).toBeGreaterThanOrEqual(1);
    expect(histBody.data[0].newClientName).toBe("Nuevo Dueño A");
  });

  it("RN-CD1: nuevo dueño = dueño actual → 422 SAME_OWNER", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "MismoDueno");
    const res = await callApp(`/mascotas/${petId}/cambio-dueno`, {
      method: "POST", jwt: tenantA.jwt,
      body: { newClientId: tenantA.clienteId },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("SAME_OWNER");
  });

  it("aislamiento: B no puede cambiar el dueño de una mascota de A → 404", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "AjenaA");
    const res = await callApp(`/mascotas/${petId}/cambio-dueno`, {
      method: "POST", jwt: tenantB.jwt,
      body: { newClientId: tenantB.clienteId },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");
  });

  it("aislamiento: no se transfiere a un cliente de otro tenant → 403 FORBIDDEN", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "DestinoAjeno");
    const res = await callApp(`/mascotas/${petId}/cambio-dueno`, {
      method: "POST", jwt: tenantA.jwt,
      body: { newClientId: tenantB.clienteId },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

// ─── Marcar Mascota como Fallecida — manual (RN-MF1..MF5) ───────────────────────

describeIntegration("Marcar Mascota como Fallecida (RN-MF)", () => {
  it("marca estado 'Fallecida' con fecha y motivo (RN-MF4)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "ParaBaja");
    const res = await callApp(`/mascotas/${petId}/fallecimiento`, {
      method: "POST", jwt: tenantA.jwt,
      body: { deceasedReason: "Insuficiencia renal", deceasedDate: "2026-06-10" },
    });
    const body = await res.json() as { success: boolean; data: { estado: string; deceasedReason: string } };
    expect(res.status).toBe(200);
    expect(body.data.estado).toBe("Fallecida");
    expect(body.data.deceasedReason).toBe("Insuficiencia renal");
  });

  it("RN-MF1: sin motivo → 422 VALIDATION_ERROR", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "SinMotivo");
    const res = await callApp(`/mascotas/${petId}/fallecimiento`, {
      method: "POST", jwt: tenantA.jwt, body: { deceasedReason: "" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("RN-MF2: re-marcar una mascota ya fallecida → 422 PET_DECEASED", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "DobleBaja");
    await callApp(`/mascotas/${petId}/fallecimiento`, {
      method: "POST", jwt: tenantA.jwt, body: { deceasedReason: "Causa 1" },
    });
    const res = await callApp(`/mascotas/${petId}/fallecimiento`, {
      method: "POST", jwt: tenantA.jwt, body: { deceasedReason: "Causa 2" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("PET_DECEASED");
  });

  it("aislamiento: B no puede marcar fallecida una mascota de A → 404", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "AjenaBaja");
    const res = await callApp(`/mascotas/${petId}/fallecimiento`, {
      method: "POST", jwt: tenantB.jwt, body: { deceasedReason: "Intruso" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");
  });
});

// ─── Catálogos globales por PostgREST directo ──────────────────────────────────

describeIntegration("Catálogos globales (PostgREST directo, sin endpoints Hono)", () => {
  it("cualquier tenant autenticado lee especies y razas", async () => {
    if (skipIfNoCredentials() || !tenantB.jwt) return;

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tenantB.jwt}` } },
      auth:   { persistSession: false },
    });

    const { data: especies } = await db.from("especies").select("id, name");
    const { data: razas }    = await db.from("razas").select("id, name").eq("especie_id", especieId);
    expect((especies ?? []).length).toBeGreaterThan(0);
    expect((razas ?? []).length).toBeGreaterThan(0);
  });
});
