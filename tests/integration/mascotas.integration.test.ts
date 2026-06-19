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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import app from "../../supabase/functions/api/src/main.ts";

function loadEnv(): void {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env opcional */ }
}
loadEnv();

const SUPABASE_URL      = process.env["SUPABASE_URL"]              ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"]         ?? "";
const SERVICE_ROLE_KEY  = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

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
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
    await serviceDb.from("tenants").delete().eq("id", tid);
  }
});

// ─── Alta y aislamiento ───────────────────────────────────────────────────────

describe("Mascotas: alta vía API", () => {
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

describe("Mascotas: aislamiento por tenant (RLS, bloqueante)", () => {
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

// ─── Catálogos globales por PostgREST directo ──────────────────────────────────

describe("Catálogos globales (PostgREST directo, sin endpoints Hono)", () => {
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
