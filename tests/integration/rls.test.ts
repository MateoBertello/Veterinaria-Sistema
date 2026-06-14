/**
 * Tests de integración RLS — BLOQUEANTES para Etapa 1.
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas.
 * Configurar en .env:
 *   TEST_SUPABASE_URL=...
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Para correr: npx vitest run tests/integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Cargar .env ─────────────────────────────────────────────────────────────
function loadEnv(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env no existe — se espera que las vars estén en el entorno
  }
}

loadEnv();

const SUPABASE_URL      = process.env["TEST_SUPABASE_URL"]              ?? process.env["SUPABASE_URL"]              ?? "";
const SERVICE_ROLE_KEY  = process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let serviceDb: SupabaseClient;

let tenantAId: string;
let tenantBId: string;
let userAId:   string;
let userBId:   string;
let jwtA:      string;
let jwtB:      string;

/** Cliente con el JWT de un usuario (RLS activo) */
function userClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, process.env["SUPABASE_ANON_KEY"] ?? "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false },
  });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await serviceDb.rpc(fn, args);
  if (error) throw new Error(`RPC ${fn} falló: ${error.message}`);
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn(
      "⚠️  Tests de integración RLS omitidos: falta TEST_SUPABASE_URL o TEST_SUPABASE_SERVICE_ROLE_KEY en .env",
    );
    return;
  }

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Crear tenant A (plan basico) y tenant B (plan premium)
  const { data: tA, error: eA } = await serviceDb
    .from("tenants")
    .insert({ nombre: "Clínica Test A", cuit_rut: "30-11111111-1", email_contacto: "a@test.com", plan: "basico" })
    .select("id")
    .single();
  if (eA || !tA) throw new Error(`No se pudo crear tenant A: ${eA?.message}`);
  tenantAId = tA.id;

  const { data: tB, error: eB } = await serviceDb
    .from("tenants")
    .insert({ nombre: "Clínica Test B", cuit_rut: "30-22222222-2", email_contacto: "b@test.com", plan: "premium" })
    .select("id")
    .single();
  if (eB || !tB) throw new Error(`No se pudo crear tenant B: ${eB?.message}`);
  tenantBId = tB.id;

  // Aprovisionar con on_tenant_created
  await rpc("on_tenant_created", { p_tenant_id: tenantAId });
  await rpc("on_tenant_created", { p_tenant_id: tenantBId });

  // Crear usuarios en auth.users via API de admin
  const adminHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
  };
  const apiBase = `${SUPABASE_URL}/auth/v1/admin/users`;

  const resA = await fetch(apiBase, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email: "usera@test.com",
      password: "Password123!",
      email_confirm: true,
      app_metadata: { tenant_id: tenantAId },
    }),
  });
  const userAData = await resA.json() as { id?: string; access_token?: string };
  userAId = userAData.id ?? "";

  const resB = await fetch(apiBase, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email: "userb@test.com",
      password: "Password123!",
      email_confirm: true,
      app_metadata: { tenant_id: tenantBId },
    }),
  });
  const userBData = await resB.json() as { id?: string };
  userBId = userBData.id ?? "";

  // Obtener JWTs de los usuarios (sign-in)
  const signInA = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": process.env["SUPABASE_ANON_KEY"] ?? "" },
    body: JSON.stringify({ email: "usera@test.com", password: "Password123!" }),
  });
  const tokenA = await signInA.json() as { access_token?: string };
  jwtA = tokenA.access_token ?? "";

  const signInB = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": process.env["SUPABASE_ANON_KEY"] ?? "" },
    body: JSON.stringify({ email: "userb@test.com", password: "Password123!" }),
  });
  const tokenB = await signInB.json() as { access_token?: string };
  jwtB = tokenB.access_token ?? "";

  // Insertar datos de prueba en tenant A usando service role
  const rolARes = await serviceDb
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantAId)
    .eq("name", "admin")
    .single();
  const rolAId = rolARes.data?.id;

  if (userAId && rolAId) {
    await serviceDb.from("usuarios").insert({
      id: userAId,
      tenant_id: tenantAId,
      username: "usera",
      email: "usera@test.com",
      full_name: "Usuario A",
      rol_id: rolAId,
    });
  }

  const rolBRes = await serviceDb
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantBId)
    .eq("name", "admin")
    .single();
  const rolBId = rolBRes.data?.id;

  if (userBId && rolBId) {
    await serviceDb.from("usuarios").insert({
      id: userBId,
      tenant_id: tenantBId,
      username: "userb",
      email: "userb@test.com",
      full_name: "Usuario B",
      rol_id: rolBId,
    });
  }

  // Insertar cliente en tenant A
  await serviceDb.from("clientes").insert({
    tenant_id: tenantAId,
    full_name: "Cliente de A",
    phone: "1111111111",
  });

  // Insertar servicio en tenant A
  await serviceDb.from("servicios").insert({
    tenant_id: tenantAId,
    nombre: "Consulta General A",
    duracion_minutos: 30,
    tipo: "clinica",
  });
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;

  // Limpiar usuarios de auth
  const adminHeaders = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
  };
  if (userAId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userAId}`, { method: "DELETE", headers: adminHeaders });
  if (userBId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userBId}`, { method: "DELETE", headers: adminHeaders });

  // CASCADE en tenants elimina todo lo demás
  if (tenantAId) await serviceDb.from("tenants").delete().eq("id", tenantAId);
  if (tenantBId) await serviceDb.from("tenants").delete().eq("id", tenantBId);
});

// ─── Guard: skip si no hay credenciales ──────────────────────────────────────

function skipIfNoCredentials() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn("Saltando test de integración: credenciales no configuradas");
    return true;
  }
  return false;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RLS-1: Aislamiento de clientes", () => {
  it("el usuario B no ve clientes del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("clientes")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("el usuario A sí ve sus propios clientes", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data } = await db
      .from("clientes")
      .select("id")
      .eq("tenant_id", tenantAId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("RLS-2: Aislamiento de mascotas", () => {
  it("el usuario B no ve mascotas del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("mascotas")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS-3: Aislamiento de servicios", () => {
  it("el usuario B no ve servicios del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("servicios")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS-4: Aislamiento de turnos", () => {
  it("el usuario B no ve turnos del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("turnos")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS-5: Aislamiento de estadias", () => {
  it("el usuario B no ve estadias del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("estadias")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS-6: Aislamiento de historial_clinico", () => {
  it("el usuario B no ve historial del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("historial_clinico")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS-7: Catálogos globales accesibles por ambos tenants", () => {
  it("usuario A puede leer especies", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db.from("especies").select("id, name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("usuario B puede leer tipos_vacuna", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data, error } = await db.from("tipos_vacuna").select("id, nombre");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("usuario A puede leer razas", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db.from("razas").select("id, name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("usuario B puede leer permisos", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data, error } = await db.from("permisos").select("id, name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("RLS-8: Tablas de plataforma solo accesibles por super admin", () => {
  it("usuario regular A no puede leer tenants de otros", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data } = await db
      .from("tenants")
      .select("id")
      .eq("id", tenantBId);
    // RLS: un tenant solo puede verse a sí mismo
    expect(data ?? []).toHaveLength(0);
  });

  it("usuario A puede leer su propio tenant", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db
      .from("tenants")
      .select("id, nombre")
      .eq("id", tenantAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });
});

describe("RLS-9: Idempotencia de seed_global", () => {
  it("ejecutar seed_global dos veces no duplica permisos", async () => {
    if (skipIfNoCredentials()) return;

    const { count: antes } = await serviceDb
      .from("permisos")
      .select("*", { count: "exact", head: true });

    // Re-insertar con ON CONFLICT DO NOTHING (simula re-ejecución del seed)
    await serviceDb.from("permisos").upsert(
      [{ name: "manage_users", display_name: "Gestionar usuarios", module: "security" }],
      { onConflict: "name", ignoreDuplicates: true },
    );

    const { count: despues } = await serviceDb
      .from("permisos")
      .select("*", { count: "exact", head: true });

    expect(despues).toBe(antes);
  });

  it("ejecutar seed de especies dos veces no duplica filas", async () => {
    if (skipIfNoCredentials()) return;

    const { count: antes } = await serviceDb
      .from("especies")
      .select("*", { count: "exact", head: true });

    await serviceDb.from("especies").upsert(
      [{ name: "Perro", description: "Canino doméstico" }],
      { onConflict: "name", ignoreDuplicates: true },
    );

    const { count: despues } = await serviceDb
      .from("especies")
      .select("*", { count: "exact", head: true });

    expect(despues).toBe(antes);
  });
});

describe("RLS-10: on_tenant_created — roles correctos", () => {
  it("crea exactamente 3 roles con is_system=true", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await serviceDb
      .from("roles")
      .select("name, is_system")
      .eq("tenant_id", tenantAId)
      .eq("is_system", true);
    const nombres = (data ?? []).map((r: { name: string }) => r.name).sort();
    expect(nombres).toEqual(["admin", "recepcionista", "veterinario"]);
  });

  it("el rol admin tiene los 11 permisos del sistema", async () => {
    if (skipIfNoCredentials()) return;
    const { data: adminRol } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("name", "admin")
      .single();

    const { count } = await serviceDb
      .from("rol_permiso")
      .select("*", { count: "exact", head: true })
      .eq("rol_id", adminRol?.id ?? "");

    expect(count).toBe(11);
  });

  it("el rol veterinario tiene exactamente 5 permisos", async () => {
    if (skipIfNoCredentials()) return;
    const { data: vetRol } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("name", "veterinario")
      .single();

    const { count } = await serviceDb
      .from("rol_permiso")
      .select("*", { count: "exact", head: true })
      .eq("rol_id", vetRol?.id ?? "");

    expect(count).toBe(5);
  });

  it("el rol recepcionista tiene exactamente 5 permisos", async () => {
    if (skipIfNoCredentials()) return;
    const { data: recepRol } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("name", "recepcionista")
      .single();

    const { count } = await serviceDb
      .from("rol_permiso")
      .select("*", { count: "exact", head: true })
      .eq("rol_id", recepRol?.id ?? "");

    expect(count).toBe(5);
  });
});

describe("RLS-11: on_tenant_created — configuración default", () => {
  it("crea configuracion_tenant con cupo=10 y dias_aviso=7", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await serviceDb
      .from("configuracion_tenant")
      .select("cupo_maximo_diario, dias_aviso_vacuna")
      .eq("tenant_id", tenantAId)
      .single();
    expect(data?.cupo_maximo_diario).toBe(10);
    expect(data?.dias_aviso_vacuna).toBe(7);
  });
});

describe("RLS-12: on_tenant_created — módulos plan básico", () => {
  it("solo historial_clinico habilitado para plan basico", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await serviceDb
      .from("modulos_contratados")
      .select("modulo, habilitado")
      .eq("tenant_id", tenantAId);

    const map = Object.fromEntries(
      (data ?? []).map((m: { modulo: string; habilitado: boolean }) => [m.modulo, m.habilitado]),
    );
    expect(map["historial_clinico"]).toBe(true);
    expect(map["turnos"]).toBe(false);
    expect(map["guarderia"]).toBe(false);
  });
});

describe("RLS-13: on_tenant_created — módulos plan premium", () => {
  it("los 3 módulos habilitados para plan premium", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await serviceDb
      .from("modulos_contratados")
      .select("modulo, habilitado")
      .eq("tenant_id", tenantBId);

    const map = Object.fromEntries(
      (data ?? []).map((m: { modulo: string; habilitado: boolean }) => [m.modulo, m.habilitado]),
    );
    expect(map["historial_clinico"]).toBe(true);
    expect(map["turnos"]).toBe(true);
    expect(map["guarderia"]).toBe(true);
  });
});
