/**
 * Tests de integración — Consola Super Admin (Addendum §7).
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas (incluida
 * 20260618000001_admin_tenant_rpc.sql). Configurar .env con SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
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
    console.warn("⚠️  Tests de integración admin omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

const CUIT_BASE = `30-${Date.now().toString().slice(-8)}-9`;

let serviceDb:        SupabaseClient;
let jwtSuperAdmin:    string;   // platform_role=super_admin
let jwtTenantNormal:  string;   // usuario de un tenant (sin platform_role)
let createdTenantIds: string[] = [];
let tenantNormalId:   string;

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

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Super Admin de plataforma (sin tenant_id, con platform_role).
  await createAuthUser("super@admin-test.com", { platform_role: "super_admin" });
  jwtSuperAdmin = await signIn("super@admin-test.com", "TestPass123!");

  // 2. Tenant "normal" + usuario para probar aislamiento y suspensión (RN-SA3).
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({ nombre: "Clínica Normal Test", cuit_rut: `30-${Date.now().toString().slice(-8)}-1`, email_contacto: "normal@test.com", plan: "basico" })
    .select("id")
    .single();
  tenantNormalId = tenant?.id ?? "";
  if (tenantNormalId) {
    createdTenantIds.push(tenantNormalId);
    await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantNormalId });

    const userId = await createAuthUser("user@normal-test.com", { tenant_id: tenantNormalId });
    const { data: rolAdmin } = await serviceDb
      .from("roles").select("id").eq("tenant_id", tenantNormalId).eq("name", "admin").single();
    if (userId && rolAdmin) {
      await serviceDb.from("usuarios").insert({
        id: userId, tenant_id: tenantNormalId, username: "user_normal",
        email: "user@normal-test.com", full_name: "Usuario Normal", rol_id: rolAdmin.id, active: true,
      });
    }
    jwtTenantNormal = await signIn("user@normal-test.com", "TestPass123!");
  }
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;
  // Eliminar usuarios de auth de los tenants de prueba.
  for (const tid of createdTenantIds) {
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
    await serviceDb.from("tenants").delete().eq("id", tid);
  }
  // Borrar el super admin.
  const { data: list } = await serviceDb.auth.admin.listUsers();
  const sa = list?.users?.find((u) => u.email === "super@admin-test.com");
  if (sa) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${sa.id}`, { method: "DELETE", headers: adminHeaders() });
});

// ─── Aislamiento ────────────────────────────────────────────────────────────

describeIntegration("Aislamiento /admin/*", () => {
  it("JWT sin platform_role → 403 FORBIDDEN antes del service", async () => {
    if (skipIfNoCredentials() || !jwtTenantNormal) return;
    const res = await callApp("/admin/tenants", { jwt: jwtTenantNormal });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("sin JWT → 401", async () => {
    if (skipIfNoCredentials()) return;
    const res = await callApp("/admin/tenants", {});
    expect(res.status).toBe(401);
  });
});

// ─── RN-SA1 / RN-SA2 ──────────────────────────────────────────────────────────

describeIntegration("RN-SA1 / RN-SA2: alta de tenant", () => {
  it("RN-SA2: POST /admin/tenants crea el tenant y lo aprovisiona (roles + config + módulos)", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin) return;

    const res = await callApp("/admin/tenants", {
      method: "POST", jwt: jwtSuperAdmin,
      body: { nombre: "Clínica Alta Test", cuitRut: CUIT_BASE, emailContacto: "alta@test.com", plan: "profesional" },
    });
    const body = await res.json() as { success: boolean; data: { id: string } };
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    createdTenantIds.push(body.data.id);

    // Aprovisionamiento atómico verificado vía service role.
    const { count: roles } = await serviceDb
      .from("roles").select("*", { count: "exact", head: true }).eq("tenant_id", body.data.id);
    const { count: modulos } = await serviceDb
      .from("modulos_contratados").select("*", { count: "exact", head: true }).eq("tenant_id", body.data.id);
    expect(roles).toBe(3);
    expect(modulos).toBe(3);
  });

  it("RN-SA1: CUIT/RUT duplicado → 409 TENANT_DUPLICATE_TAXID", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin) return;

    const res = await callApp("/admin/tenants", {
      method: "POST", jwt: jwtSuperAdmin,
      body: { nombre: "Clínica Duplicada", cuitRut: CUIT_BASE, emailContacto: "dup@test.com", plan: "basico" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("TENANT_DUPLICATE_TAXID");
  });
});

// ─── RN-SA3 ───────────────────────────────────────────────────────────────────

describeIntegration("RN-SA3: suspensión efectiva", () => {
  it("RN-SA3: tenant suspendido → 403 TENANT_SUSPENDED en datos del tenant; login sigue disponible", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin || !jwtTenantNormal) return;

    // Suspender vía consola Super Admin.
    const susp = await callApp(`/admin/tenants/${tenantNormalId}/estado`, {
      method: "PATCH", jwt: jwtSuperAdmin, body: { activo: false },
    });
    expect(susp.status).toBe(200);

    // El usuario del tenant ya no accede a datos.
    const datos = await callApp("/modulos-habilitados", { jwt: jwtTenantNormal });
    const body  = await datos.json() as { error: { code: string } };
    expect(datos.status).toBe(403);
    expect(body.error.code).toBe("TENANT_SUSPENDED");

    // Pero puede autenticarse (login sigue 200).
    const login = await callApp("/auth/login", {
      method: "POST", body: { username: "user_normal", password: "TestPass123!" },
    });
    expect(login.status).toBe(200);

    // Reactivar para no dejar efectos colaterales.
    await callApp(`/admin/tenants/${tenantNormalId}/estado`, {
      method: "PATCH", jwt: jwtSuperAdmin, body: { activo: true },
    });
  });
});

// ─── RN-SA4 ───────────────────────────────────────────────────────────────────

describeIntegration("RN-SA4: aislamiento de datos de negocio", () => {
  it("RN-SA4: el listado expone solo metadatos comerciales", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin) return;

    const res  = await callApp("/admin/tenants", { jwt: jwtSuperAdmin });
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) {
      expect(t).not.toHaveProperty("clientes");
      expect(t).not.toHaveProperty("mascotas");
      expect(t).toHaveProperty("cuitRut");
    }
  });
});
