/**
 * Tests de integración — JWT real de Supabase Auth → tenantContext.
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas.
 * Configurar en .env:
 *   SUPABASE_URL=...
 *   SUPABASE_ANON_KEY=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Para correr: npx vitest run tests/integration
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

// ─── Estado compartido del suite ──────────────────────────────────────────────

let serviceDb: SupabaseClient;
let tenantId:  string;
let userId:    string;
let jwtActivo: string;    // JWT de usuario activo
let jwtInactivo: string;  // JWT de usuario inactivo

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Crear tenant de prueba
  const { data: tenant, error: tenantErr } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         "Clínica Auth Test",
      cuit_rut:       "30-33333333-3",
      email_contacto: "auth@test.com",
      plan:           "basico",
    })
    .select("id")
    .single();
  if (tenantErr || !tenant) throw new Error(`No se pudo crear tenant: ${tenantErr?.message}`);
  tenantId = tenant.id;

  // 2. Aprovisionar tenant (roles, permisos, módulos)
  const { error: rpcErr } = await serviceDb.rpc("on_tenant_created", {
    p_tenant_id: tenantId,
  });
  if (rpcErr) throw new Error(`on_tenant_created falló: ${rpcErr.message}`);

  // 3. Crear usuario activo en Supabase Auth
  const adminHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
  };

  const resActivo = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email:         "activo@auth-test.com",
      password:      "TestPass123!",
      email_confirm: true,
      app_metadata:  { tenant_id: tenantId },
    }),
  });
  const userActivo = await resActivo.json() as { id?: string };
  userId = userActivo.id ?? "";

  // 4. Insertar en tabla usuarios (rol admin)
  const { data: rolAdmin } = await serviceDb
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();

  if (userId && rolAdmin) {
    await serviceDb.from("usuarios").insert({
      id:        userId,
      tenant_id: tenantId,
      username:  "activo_test",
      email:     "activo@auth-test.com",
      full_name: "Usuario Activo Test",
      rol_id:    rolAdmin.id,
      active:    true,
    });
  }

  // 5. Login para obtener JWT real
  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: "activo@auth-test.com", password: "TestPass123!" }),
  });
  const tokenData = await signIn.json() as { access_token?: string };
  jwtActivo = tokenData.access_token ?? "";

  // 6. Crear usuario inactivo para probar RN-AUT1
  const resInactivo = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email:         "inactivo@auth-test.com",
      password:      "TestPass123!",
      email_confirm: true,
      app_metadata:  { tenant_id: tenantId },
    }),
  });
  const userInactivo = await resInactivo.json() as { id?: string };

  if (userInactivo.id && rolAdmin) {
    await serviceDb.from("usuarios").insert({
      id:        userInactivo.id,
      tenant_id: tenantId,
      username:  "inactivo_test",
      email:     "inactivo@auth-test.com",
      full_name: "Usuario Inactivo Test",
      rol_id:    rolAdmin.id,
      active:    false,   // <-- inactivo
    });
  }

  // JWT del inactivo (puede hacer sign-in en Auth pero no en nuestra capa)
  const signInInactivo = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: "inactivo@auth-test.com", password: "TestPass123!" }),
  });
  const tokenInactivo = await signInInactivo.json() as { access_token?: string };
  jwtInactivo = tokenInactivo.access_token ?? "";
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;

  const adminHeaders = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
  };

  // Buscar los usuarios de auth creados para el tenant de prueba…
  const { data: usuarios } = await serviceDb
    .from("usuarios")
    .select("id")
    .eq("tenant_id", tenantId);

  // …borrar PRIMERO el tenant (su CASCADE se lleva usuarios y todo lo que los
  // referencia) y recién después las cuentas de Auth. Desde que `usuarios.id`
  // referencia a `auth.users` con ON DELETE CASCADE (migración 20260725000005),
  // borrar la cuenta primero arrastra la fila espejo y cualquier FK que apunte
  // al usuario frena el borrado, dejando cuentas huérfanas que rompen la
  // corrida siguiente.
  if (tenantId) await serviceDb.from("tenants").delete().eq("id", tenantId);

  for (const u of (usuarios ?? []) as { id: string }[]) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
      method: "DELETE", headers: adminHeaders,
    });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts   = token.split(".");
  const payload = parts[1];
  const base64  = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf-8")) as Record<string, unknown>;
}

async function callApp(path: string, opts: {
  method?: string;
  jwt?:    string;
  body?:   unknown;
}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;

  return app.request(`http://localhost/api/v1${path}`, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describeIntegration("JWT real → app_metadata.tenant_id", () => {
  it("el JWT emitido por Supabase Auth contiene app_metadata.tenant_id correcto", () => {
    if (skipIfNoCredentials() || !jwtActivo) return;

    const payload = decodeJwtPayload(jwtActivo);
    const appMeta = payload["app_metadata"] as Record<string, unknown> | undefined;
    expect(appMeta?.["tenant_id"]).toBe(tenantId);
  });
});

describeIntegration("tenantContext con JWT real de Supabase", () => {
  it("GET /modulos-habilitados con JWT válido → 200 con módulos del tenant", async () => {
    if (skipIfNoCredentials() || !jwtActivo) return;

    const res  = await callApp("/modulos-habilitados", { jwt: jwtActivo });
    const body = await res.json() as { success: boolean; data: unknown[] };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(3); // 3 módulos del plan básico
  });

  it("GET /modulos-habilitados sin JWT → 401", async () => {
    if (skipIfNoCredentials()) return;

    const res  = await callApp("/modulos-habilitados", {});
    const body = await res.json() as { success: boolean; error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /auth/me con JWT válido → perfil del usuario autenticado", async () => {
    if (skipIfNoCredentials() || !jwtActivo) return;

    const res  = await callApp("/auth/me", { jwt: jwtActivo });
    const body = await res.json() as { success: boolean; data: { username: string } };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.username).toBe("activo_test");
  });
});

describeIntegration("RN-AUT1: login vía POST /auth/login", () => {
  it("RN-AUT1: credenciales correctas → 200 con token, rol y permisos", async () => {
    if (skipIfNoCredentials()) return;

    const res  = await callApp("/auth/login", {
      method: "POST",
      body:   { username: "activo_test", password: "TestPass123!" },
    });
    const body = await res.json() as {
      success: boolean;
      data: { token: string; user: { username: string; permissions: string[] } };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.username).toBe("activo_test");
    expect(body.data.user.permissions.length).toBeGreaterThan(0);
    // RN-S1: sin password en respuesta
    expect(body.data.user).not.toHaveProperty("password");
    expect(body.data.user).not.toHaveProperty("passwordHash");
  });

  it("RN-AUT1: usuario inactivo → 401 UNAUTHORIZED con mensaje genérico", async () => {
    if (skipIfNoCredentials() || !jwtInactivo) return;

    const res  = await callApp("/auth/login", {
      method: "POST",
      body:   { username: "inactivo_test", password: "TestPass123!" },
    });
    const body = await res.json() as { success: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // El mensaje es genérico — no revela si fue el usuario o la contraseña
    expect(body.error.message).toBe("Credenciales inválidas");
  });

  it("RN-AUT1: contraseña incorrecta → 401 con mensaje genérico", async () => {
    if (skipIfNoCredentials()) return;

    const res  = await callApp("/auth/login", {
      method: "POST",
      body:   { username: "activo_test", password: "contraseña_incorrecta" },
    });
    const body = await res.json() as { error: { message: string } };

    expect(res.status).toBe(401);
    expect(body.error.message).toBe("Credenciales inválidas");
  });
});

describeIntegration("RN-AUT4: auditoría de logout", () => {
  it("RN-AUT4: logout registra fila en registros_auditoria con action=LOGOUT", async () => {
    if (skipIfNoCredentials() || !jwtActivo) return;

    // Contar filas de auditoría antes
    const { count: antes } = await serviceDb
      .from("registros_auditoria")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("action", "LOGOUT");

    await callApp("/auth/logout", { method: "POST", jwt: jwtActivo });

    // Contar después
    const { count: despues } = await serviceDb
      .from("registros_auditoria")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("action", "LOGOUT");

    expect((despues ?? 0)).toBeGreaterThan((antes ?? 0));
  });

  it("RN-AUT4: logout con token forjado → 401 y NO contamina la auditoría del tenant víctima", async () => {
    if (skipIfNoCredentials()) return;

    // El ataque real: JWT bien formado que apunta al tenant_id de un tenant
    // EXISTENTE (la víctima) con un usuario inventado, firmado con basura.
    // Pasa el decode de tenantContext; GoTrue lo rechaza (bad_jwt). Antes del
    // fix, el asiento LOGOUT se escribía igual en la auditoría de la víctima
    // (tenant_id tiene FK a tenants: un tenant inexistente no reproduce el bug).
    const usuarioForjado = "88888888-8888-4888-8888-888888888888";
    const b64url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const jwtForjado = [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({
        sub:          usuarioForjado,
        role:         "authenticated",
        exp:          Math.floor(Date.now() / 1000) + 3600,
        app_metadata: { tenant_id: tenantId },
      }),
      "firma-forjada",
    ].join(".");

    const res = await callApp("/auth/logout", { method: "POST", jwt: jwtForjado });
    expect(res.status).toBe(401);

    // Ningún asiento LOGOUT quedó escrito a nombre de la identidad forjada.
    const { count } = await serviceDb
      .from("registros_auditoria")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("user_id", usuarioForjado)
      .eq("action", "LOGOUT");

    expect(count ?? 0).toBe(0);
  });
});
