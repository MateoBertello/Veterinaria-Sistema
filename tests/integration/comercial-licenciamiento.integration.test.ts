/**
 * Tests de integración — Licenciamiento y Permisos del Módulo Comercial (C1·T2).
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
    console.warn("⚠️  Tests de integración de licenciamiento comercial omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

let serviceDb: SupabaseClient;
let jwtSuperAdmin: string;
const createdTenantIds: string[] = [];

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? "";
}

async function crearTenantConPlan(nombre: string, plan: "basico" | "profesional" | "premium"): Promise<string> {
  const cuit = `30-${Date.now().toString().slice(-7)}-${createdTenantIds.length + 1}`;
  const { data } = await serviceDb
    .from("tenants")
    .insert({ nombre, cuit_rut: cuit, email_contacto: `${cuit}@test.com`, plan })
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
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  await crearUsuarioAuth("super-lic@test.com", { platform_role: "super_admin" });
  jwtSuperAdmin = await signIn("super-lic@test.com", "TestPass123!");
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of createdTenantIds) {
    await limpiarTenant(serviceDb, tid);
  }
  const { data: list } = await serviceDb.auth.admin.listUsers();
  const sa = list?.users?.find((u) => u.email === "super-lic@test.com");
  if (sa) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${sa.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
  }
});

describeIntegration("C1·T2: Licenciamiento de módulos y permisos por rol", () => {
  it("un tenant basico nace sin stock ni ventas", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Básica", "basico");

    const { data: modulos } = await serviceDb
      .from("modulos_contratados")
      .select("modulo, habilitado")
      .eq("tenant_id", tid);

    expect(modulos).toHaveLength(5);
    const stock = modulos?.find((m) => m.modulo === "stock");
    const ventas = modulos?.find((m) => m.modulo === "ventas");
    expect(stock?.habilitado).toBe(false);
    expect(ventas?.habilitado).toBe(false);
  });

  it("un tenant profesional nace con stock y sin ventas", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Pro", "profesional");

    const { data: modulos } = await serviceDb
      .from("modulos_contratados")
      .select("modulo, habilitado")
      .eq("tenant_id", tid);

    const stock = modulos?.find((m) => m.modulo === "stock");
    const ventas = modulos?.find((m) => m.modulo === "ventas");
    expect(stock?.habilitado).toBe(true);
    expect(ventas?.habilitado).toBe(false);
  });

  it("un tenant premium nace con los dos", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Prem", "premium");

    const { data: modulos } = await serviceDb
      .from("modulos_contratados")
      .select("modulo, habilitado")
      .eq("tenant_id", tid);

    const stock = modulos?.find((m) => m.modulo === "stock");
    const ventas = modulos?.find((m) => m.modulo === "ventas");
    expect(stock?.habilitado).toBe(true);
    expect(ventas?.habilitado).toBe(true);
  });

  it("el admin de un tenant nuevo tiene los diez permisos", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Permisos Admin", "profesional");

    const { data: rolAdmin } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tid)
      .eq("name", "admin")
      .single();

    const { data: permisos } = await serviceDb
      .from("rol_permiso")
      .select("permisos!inner(name)")
      .eq("rol_id", rolAdmin?.id);

    const nombresPermisos = (permisos ?? []).map((p: any) => p.permisos.name);
    const permisosComerciales = [
      "view_stock",
      "manage_stock",
      "split_stock",
      "consume_stock",
      "manage_products",
      "manage_suppliers",
      "view_sales",
      "manage_sales",
      "void_sales",
      "manage_cash",
    ];

    for (const p of permisosComerciales) {
      expect(nombresPermisos).toContain(p);
    }
  });

  it("el veterinario tiene exactamente cuatro y no más", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Permisos Vet", "profesional");

    const { data: rolVet } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tid)
      .eq("name", "veterinario")
      .single();

    const { data: permisos } = await serviceDb
      .from("rol_permiso")
      .select("permisos!inner(name)")
      .eq("rol_id", rolVet?.id);

    const nombresPermisos = (permisos ?? []).map((p: any) => p.permisos.name);

    // Positivos
    expect(nombresPermisos).toContain("view_stock");
    expect(nombresPermisos).toContain("split_stock");
    expect(nombresPermisos).toContain("consume_stock");
    expect(nombresPermisos).toContain("manage_sales");

    // Negativos
    expect(nombresPermisos).not.toContain("manage_stock");
    expect(nombresPermisos).not.toContain("manage_products");
    expect(nombresPermisos).not.toContain("manage_suppliers");
    expect(nombresPermisos).not.toContain("view_sales");
    expect(nombresPermisos).not.toContain("void_sales");
    expect(nombresPermisos).not.toContain("manage_cash");
  });

  it("la recepcionista tiene exactamente cinco y no más", async () => {
    if (skipIfNoCredentials()) return;
    const tid = await crearTenantConPlan("Clínica Permisos Recep", "profesional");

    const { data: rolRecep } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tid)
      .eq("name", "recepcionista")
      .single();

    const { data: permisos } = await serviceDb
      .from("rol_permiso")
      .select("permisos!inner(name)")
      .eq("rol_id", rolRecep?.id);

    const nombresPermisos = (permisos ?? []).map((p: any) => p.permisos.name);

    // Positivos
    expect(nombresPermisos).toContain("view_stock");
    expect(nombresPermisos).toContain("split_stock");
    expect(nombresPermisos).toContain("manage_suppliers");
    expect(nombresPermisos).toContain("manage_sales");
    expect(nombresPermisos).toContain("manage_cash");

    // Negativos
    expect(nombresPermisos).not.toContain("consume_stock");
    expect(nombresPermisos).not.toContain("manage_stock");
    expect(nombresPermisos).not.toContain("manage_products");
    expect(nombresPermisos).not.toContain("view_sales");
    expect(nombresPermisos).not.toContain("void_sales");
  });

  it("ventas no se habilita sin stock", async () => {
    if (skipIfNoCredentials() || !jwtSuperAdmin) return;
    const tid = await crearTenantConPlan("Clínica Dep Toggle", "premium");

    // Intentar deshabilitar stock cuando ventas está habilitado
    const resDeshabilitarStock = await callApp(`/admin/tenants/${tid}/modulos/stock`, {
      method: "PUT",
      jwt: jwtSuperAdmin,
      body: { habilitado: false },
    });
    expect(resDeshabilitarStock.status).toBe(422);
    const bodyDesh = (await resDeshabilitarStock.json()) as { error: { code: string; message: string } };
    expect(bodyDesh.error.code).toBe("VALIDATION_ERROR");

    // Deshabilitamos ventas primero
    const resDeshVentas = await callApp(`/admin/tenants/${tid}/modulos/ventas`, {
      method: "PUT",
      jwt: jwtSuperAdmin,
      body: { habilitado: false },
    });
    expect(resDeshVentas.status).toBe(200);

    // Ahora deshabilitamos stock
    const resDeshStock2 = await callApp(`/admin/tenants/${tid}/modulos/stock`, {
      method: "PUT",
      jwt: jwtSuperAdmin,
      body: { habilitado: false },
    });
    expect(resDeshStock2.status).toBe(200);

    // Ahora intentamos habilitar ventas cuando stock está deshabilitado
    const resHabVentas = await callApp(`/admin/tenants/${tid}/modulos/ventas`, {
      method: "PUT",
      jwt: jwtSuperAdmin,
      body: { habilitado: true },
    });
    expect(resHabVentas.status).toBe(422);
    const bodyHab = (await resHabVentas.json()) as { error: { code: string; message: string } };
    expect(bodyHab.error.code).toBe("VALIDATION_ERROR");
  });
});
