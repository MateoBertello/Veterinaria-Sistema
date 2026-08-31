/**
 * Tests de integración — GRANTs de `anon` (DT-5, Etapa 9 — S3)
 * y EXECUTE de funciones (hardening pre-deploy).
 *
 * Verifica que la migración `20260706000001_revoke_anon_grants.sql` dejó a
 * `anon` sin privilegios sobre `public` (DML y SELECT), que `authenticated`
 * sigue pudiendo leer los catálogos clínicos sin regresión, y que
 * `20260710000001_revoke_execute_funciones.sql` dejó las RPCs sensibles
 * (SECURITY DEFINER con p_tenant_id por parámetro) ejecutables SOLO por
 * service_role: ni `anon` ni `authenticated` pueden invocarlas por
 * /rest/v1/rpc saltándose la Edge Function.
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas.
 * Configurar en .env: TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { borrarUsuarioAuth, crearUsuarioAuth } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let userId = "";
let jwt = "";

/** Cliente `anon` puro — sin JWT de usuario (rol efectivo: anon). */
function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

/** Cliente con el JWT de un usuario logueado (rol efectivo: authenticated). */
function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

function skipIfNoCredentials() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn("Saltando test de integración: credenciales no configuradas");
    return true;
  }
  return false;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn(
      "⚠️  Tests de integración de GRANTs omitidos: falta TEST_SUPABASE_URL o TEST_SUPABASE_SERVICE_ROLE_KEY en .env",
    );
    return;
  }

  userId = await crearUsuarioAuth("grants-dt5@test.com", {}, "Password123!");

  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: "grants-dt5@test.com", password: "Password123!" }),
  });
  const tokenData = (await signIn.json()) as { access_token?: string };
  jwt = tokenData.access_token ?? "";
});

afterAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  await borrarUsuarioAuth(userId);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describeIntegration("DT-5: anon sin privilegios sobre tablas de negocio", () => {
  it("anon no puede INSERTAR en una tabla de negocio (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await anonClient().from("clientes").insert({ full_name: "x" });
    expect(error?.code).toBe("42501");
  });
});

describeIntegration("DT-5: anon sin SELECT sobre los catálogos clínicos", () => {
  it("anon no puede leer especies (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await anonClient().from("especies").select("*");
    expect(error?.code).toBe("42501");
  });
});

describeIntegration("pre-deploy: EXECUTE de funciones acotado a service_role", () => {
  // Argumentos dummy con nombres exactos: PostgREST resuelve la función por
  // firma, y el chequeo de EXECUTE ocurre ANTES de ejecutar el cuerpo, así
  // que ningún test produce efectos.
  const argsCambiarDueno = {
    p_tenant_id:     "00000000-0000-0000-0000-000000000001",
    p_pet_id:        "00000000-0000-0000-0000-000000000002",
    p_new_client_id: "00000000-0000-0000-0000-000000000003",
    p_recorded_by:   "00000000-0000-0000-0000-000000000004",
  };

  it("anon no puede ejecutar cambiar_dueno_mascota (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await anonClient().rpc("cambiar_dueno_mascota", argsCambiarDueno);
    expect(error?.code).toBe("42501");
  });

  it("anon no puede ejecutar crear_tenant (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await anonClient().rpc("crear_tenant", {
      p_nombre: "x", p_cuit_rut: "x", p_email_contacto: "x@x.com", p_plan: "basico",
    });
    expect(error?.code).toBe("42501");
  });

  it("anon no puede ejecutar on_tenant_created (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await anonClient().rpc("on_tenant_created", {
      p_tenant_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(error?.code).toBe("42501");
  });

  it("authenticated tampoco puede ejecutar cambiar_dueno_mascota (42501)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await userClient(jwt).rpc("cambiar_dueno_mascota", argsCambiarDueno);
    expect(error?.code).toBe("42501");
  });

  it("service_role conserva EXECUTE (llega al error de negocio, no a 42501)", async () => {
    if (skipIfNoCredentials()) return;
    const serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error } = await serviceDb.rpc("cambiar_dueno_mascota", argsCambiarDueno);
    // P0001 = RAISE EXCEPTION 'MASCOTA_NOT_FOUND': la función SÍ se ejecutó.
    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("MASCOTA_NOT_FOUND");
  });
});

describeIntegration("DT-5: catálogos siguen respondiendo para authenticated (sin regresión)", () => {
  // Esta suite mide GRANTs, no RLS: lo que afirma es que `authenticated` NO
  // perdió el SELECT sobre estas tablas (el error sería 42501, "permission
  // denied"), que es la lectura por PostgREST directo de la que depende el
  // frontend.
  //
  // Cuántas filas devuelve ya no se puede afirmar acá. Desde
  // 20260827000001_catalogos_por_tenant.sql el catálogo es de cada clínica y su
  // política RLS exige tenant + usuario activo; el usuario de esta suite es una
  // cuenta de Auth suelta, sin tenant ni fila en `usuarios`, así que ve cero
  // filas — y está bien que así sea. Que un usuario REAL de un tenant vea su
  // catálogo completo lo cubre `rls.test.ts` (RLS-7).
  it("un usuario logueado conserva el SELECT sobre especies/razas/tipos_vacuna (no 42501)", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwt);

    for (const tabla of ["especies", "razas", "tipos_vacuna"]) {
      const { error } = await db.from(tabla).select("*");
      expect(error, `${tabla} debería seguir siendo legible por authenticated`).toBeNull();
    }
  });
});
