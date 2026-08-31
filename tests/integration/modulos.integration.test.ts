/**
 * Tests de integración — Gestionar Módulos Contratados (Addendum §7).
 *
 * Requieren un proyecto Supabase real con las migraciones de la Etapa 1 aplicadas
 * (NO se agregan migraciones nuevas en esta tanda). Configurar .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Para correr: npx vitest run tests/integration
 *
 * Cubre: RN-SM2 (deshabilitar no borra datos), RN-SM3 (vigencia inmediata),
 * RN-SM4 (auditoría platform/UPDATE), aislamiento (solo super_admin; cross-tenant).
 *
 * Nota: el criterio "deshabilitar turnos → su endpoint responde 403
 * MODULE_NOT_LICENSED" no se prueba aquí porque los endpoints de `turnos` son de
 * la Etapa 6; el gate de requireModule (toggle reflejado, invalidación, TTL) está
 * cubierto en tests/unit/requireModule.test.ts y se cerrará e2e en la Etapa 6.
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { adminHeaders, crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración de módulos omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

let serviceDb:        SupabaseClient;
let jwtSuperAdmin:    string;   // platform_role=super_admin
let jwtTenantA:       string;   // usuario del tenant A (sin platform_role)
let jwtNormalNoSA:    string;   // alias del usuario del tenant A para aislamiento
let tenantAId        = "";
let tenantBId        = "";
const createdTenantIds: string[] = [];

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? "";
}

async function crearTenant(nombre: string, cuit: string): Promise<string> {
  const { data } = await serviceDb
    .from("tenants")
    .insert({ nombre, cuit_rut: cuit, email_contacto: `${cuit}@test.com`, plan: "profesional" })
    .select("id")
    .single();
  const id = (data?.id as string) ?? "";
  if (id) {
    createdTenantIds.push(id);
    await serviceDb.rpc("on_tenant_created", { p_tenant_id: id });
  }
  return id;
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

async function moduloRow(tenantId: string, modulo: string) {
  const { data } = await serviceDb
    .from("modulos_contratados")
    .select("modulo, habilitado, fecha_alta")
    .eq("tenant_id", tenantId)
    .eq("modulo", modulo)
    .single();
  return data as { modulo: string; habilitado: boolean; fecha_alta: string | null } | null;
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Super Admin de plataforma.
  await crearUsuarioAuth("super@modtest.com", { platform_role: "super_admin" });
  jwtSuperAdmin = await signIn("super@modtest.com", "TestPass123!");

  const suffix = Date.now().toString().slice(-8);

  // Tenant A (plan profesional → turnos habilitado) + usuario.
  tenantAId = await crearTenant("Clínica Mod A", `30-${suffix}-1`);
  if (tenantAId) {
    const userId = await crearUsuarioAuth("user@modtest-a.com", { tenant_id: tenantAId });
    const { data: rolAdmin } = await serviceDb
      .from("roles").select("id").eq("tenant_id", tenantAId).eq("name", "admin").single();
    if (userId && rolAdmin) {
      await serviceDb.from("usuarios").insert({
        id: userId, tenant_id: tenantAId, username: "user_mod_a",
        email: "user@modtest-a.com", full_name: "Usuario Mod A", rol_id: rolAdmin.id, active: true,
      });
    }
    jwtTenantA    = await signIn("user@modtest-a.com", "TestPass123!");
    jwtNormalNoSA = jwtTenantA;
  }

  // Tenant B (plan profesional → turnos habilitado) — para aislamiento cross-tenant.
  tenantBId = await crearTenant("Clínica Mod B", `30-${suffix}-2`);
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of createdTenantIds) await limpiarTenant(serviceDb, tid);
  const { data: list } = await serviceDb.auth.admin.listUsers();
  const sa = list?.users?.find((u) => u.email === "super@modtest.com");
  if (sa) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${sa.id}`, { method: "DELETE", headers: adminHeaders() });
});

// ─── Aislamiento ────────────────────────────────────────────────────────────

describeIntegration("Aislamiento del toggle", () => {
  it("usuario normal (sin platform_role) → 403 FORBIDDEN", async () => {
    if (skipIfNoCredentials() || !jwtNormalNoSA || !tenantAId) return;

    const res  = await callApp(`/admin/tenants/${tenantAId}/modulos/turnos`, {
      method: "PUT", jwt: jwtNormalNoSA, body: { habilitado: false },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("módulo desconocido → 422 MODULE_UNKNOWN", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin || !tenantAId) return;

    const res  = await callApp(`/admin/tenants/${tenantAId}/modulos/inexistente`, {
      method: "PUT", jwt: jwtSuperAdmin, body: { habilitado: true },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("MODULE_UNKNOWN");
  });
});

// ─── RN-SM2 / RN-SM3 / RN-SM4 ─────────────────────────────────────────────────

describeIntegration("RN-SM: deshabilitar 'turnos' en el tenant A", () => {
  it("GET /admin/tenants/:id/modulos (super_admin) → 3 módulos en camelCase", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin || !tenantAId) return;

    const res  = await callApp(`/admin/tenants/${tenantAId}/modulos`, { jwt: jwtSuperAdmin });
    const body = await res.json() as { success: boolean; data: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(5);
    expect(Object.keys(body.data[0]).sort()).toEqual(["fechaAlta", "habilitado", "modulo"]);
  });

  it("RN-SM3: PUT deshabilitar turnos → 200 y GET /modulos-habilitados lo refleja", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin || !jwtTenantA || !tenantAId) return;

    const put = await callApp(`/admin/tenants/${tenantAId}/modulos/turnos`, {
      method: "PUT", jwt: jwtSuperAdmin, body: { habilitado: false },
    });
    const putBody = await put.json() as { data: { modulo: string; habilitado: boolean } };
    expect(put.status).toBe(200);
    expect(putBody.data).toMatchObject({ modulo: "turnos", habilitado: false });

    const list = await callApp("/modulos-habilitados", { jwt: jwtTenantA });
    const listBody = await list.json() as { data: Array<{ modulo: string; habilitado: boolean }> };
    const turnos = listBody.data.find((m) => m.modulo === "turnos");
    expect(turnos?.habilitado).toBe(false);
  });

  it("RN-SM2: la fila de turnos sigue existiendo con habilitado=false (no se borró)", async () => {
    if (skipIfNoCredentials() || !tenantAId) return;

    const row = await moduloRow(tenantAId, "turnos");
    expect(row).not.toBeNull();
    expect(row?.habilitado).toBe(false);
  });

  it("RN-SM4: se registró auditoría platform/UPDATE del toggle", async () => {
    if (skipIfNoCredentials() || !tenantAId) return;

    const { data } = await serviceDb
      .from("registros_auditoria")
      .select("action, module, entity_id, new_values")
      .eq("module", "platform")
      .eq("action", "UPDATE")
      .eq("entity_id", tenantAId)
      .order("timestamp", { ascending: false })
      .limit(5);

    const rows = (data ?? []) as Array<{ new_values: Record<string, unknown> | null }>;
    const match = rows.find((r) => r.new_values?.["modulo"] === "turnos");
    expect(match).toBeTruthy();
  });

  it("Aislamiento cross-tenant: el módulo turnos del tenant B no cambió", async () => {
    if (skipIfNoCredentials() || !tenantBId) return;

    const row = await moduloRow(tenantBId, "turnos");
    expect(row?.habilitado).toBe(true);
  });

  it("re-habilitar turnos en A → 200 (restaura estado)", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin || !tenantAId) return;

    const res = await callApp(`/admin/tenants/${tenantAId}/modulos/turnos`, {
      method: "PUT", jwt: jwtSuperAdmin, body: { habilitado: true },
    });
    expect(res.status).toBe(200);

    const row = await moduloRow(tenantAId, "turnos");
    expect(row?.habilitado).toBe(true);
  });
});
