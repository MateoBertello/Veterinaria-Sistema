/**
 * Tests de integración — endurecimiento del rol `authenticated`
 * (migración 20260725000003) y rate limit persistido (20260725000004).
 *
 * Cubren lo que NINGÚN unitario puede cubrir, porque el control lo aplica la
 * base: privilegios de tabla y políticas RLS. El hallazgo que originó esto es
 * que cualquier usuario logueado podía saltear la Edge Function y operar
 * directo contra PostgREST con su propio token válido (auto-asignarse permisos,
 * borrar la auditoría, revertir una eutanasia, leer historia clínica sin
 * permiso).
 *
 * Requieren un Supabase real con las migraciones aplicadas.
 * Configurar en .env: TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY /
 * TEST_SUPABASE_SERVICE_ROLE_KEY. Para correr: npx vitest run tests/integration
 */

import { it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SERVICE_ROLE_KEY,
  HAS_INTEGRATION_CONFIG,
  describeIntegration,
} from "./_env.ts";
import { crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.WebSocket = class FakeWebSocket {} as any;

const EMAIL_USUARIO = "hardening-rls@test.local";
const PASSWORD      = "Password123!";
// CUIT con prefijo 99- : convención del repo para datos sintéticos, para no
// chocar con los CUITs fijos de las otras suites.
const CUIT          = "99-88888888-1";

let serviceDb: SupabaseClient;
let tenantId  = "";
let userId    = "";
let rolId     = "";
let clienteId = "";
let jwt       = "";

/** Cliente con el JWT del usuario logueado (rol efectivo: authenticated). */
function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false },
  });
}

async function loguear(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email: EMAIL_USUARIO, password: PASSWORD }),
  });
  const body = await res.json() as { access_token?: string };
  return body.access_token ?? "";
}

beforeAll(async () => {
  if (!HAS_INTEGRATION_CONFIG) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Tenant propio, con sus roles y permisos de catálogo.
  const { data: nuevoTenant } = await serviceDb.rpc("crear_tenant", {
    p_nombre:         "QA Hardening RLS",
    p_cuit_rut:       CUIT,
    p_email_contacto: "qa-hardening@test.local",
    p_plan:           "premium",
  });
  tenantId = (nuevoTenant as { id?: string } | null)?.id
    ?? (Array.isArray(nuevoTenant) ? (nuevoTenant[0] as { id: string }).id : "");

  // Rol a medida con UN SOLO permiso: así el test es determinista y no depende
  // de cómo esté armada la matriz de roles del seed.
  const { data: rol } = await serviceDb
    .from("roles")
    .insert({ tenant_id: tenantId, name: "qa_acotado", display_name: "QA Acotado" })
    .select("id")
    .single();
  rolId = (rol as { id: string }).id;

  const { data: permisoClientes } = await serviceDb
    .from("permisos").select("id").eq("name", "manage_clients").single();
  await serviceDb.from("rol_permiso").insert({
    rol_id:     rolId,
    permiso_id: (permisoClientes as { id: string }).id,
  });

  // Usuario de ese tenant (cuenta de Auth + fila espejo).
  userId = await crearUsuarioAuth(EMAIL_USUARIO, { tenant_id: tenantId }, PASSWORD);

  await serviceDb.from("usuarios").insert({
    id:        userId,
    tenant_id: tenantId,
    username:  "qa_hardening",
    email:     EMAIL_USUARIO,
    full_name: "QA Hardening",
    rol_id:    rolId,
    active:    true,
  });

  // Un cliente del tenant, para tener algo que leer en el caso positivo.
  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({
      tenant_id: tenantId,
      full_name: "Cliente QA",
      dni_cuit:  "99-00011122-3",
      phone:     "1150000000",
    })
    .select("id")
    .single();
  clienteId = (cliente as { id: string } | null)?.id ?? "";

  jwt = await loguear();
});

afterAll(async () => {
  if (!HAS_INTEGRATION_CONFIG || !serviceDb) return;
  await limpiarTenant(serviceDb, tenantId);
  await serviceDb.rpc("limpiar_intentos_login", { p_claves: ["user:qa_rate_limit", "ip:203.0.113.7"] });
});

// ─────────────────────────────────────────────────────────────────────────────

describeIntegration("authenticated no puede ESCRIBIR (privilegios revocados)", () => {
  it("no puede modificar su propia fila de usuarios (escalada de rol)", async () => {
    const { error } = await userClient(jwt)
      .from("usuarios")
      .update({ full_name: "HACKEADO" })
      .eq("id", userId);

    expect(error?.code).toBe("42501");
  });

  it("no puede auto-asignarse permisos insertando en rol_permiso", async () => {
    const { data: permiso } = await serviceDb
      .from("permisos").select("id").eq("name", "manage_users").single();

    const { error } = await userClient(jwt)
      .from("rol_permiso")
      .insert({ rol_id: rolId, permiso_id: (permiso as { id: string }).id });

    expect(error?.code).toBe("42501");
  });

  it("no puede borrar la auditoría que lo delata (RN-S3)", async () => {
    const { error } = await userClient(jwt)
      .from("registros_auditoria")
      .delete()
      .eq("tenant_id", tenantId);

    expect(error?.code).toBe("42501");
  });

  it("no puede revertir una eutanasia por la ventana de PostgREST (regla 8)", async () => {
    const { error } = await userClient(jwt)
      .from("mascotas")
      .update({ estado: "Activa" })
      .eq("estado", "Fallecida");

    expect(error?.code).toBe("42501");
  });

  it("no puede insertar clientes aunque TENGA manage_clients (las escrituras van por la API)", async () => {
    const { error } = await userClient(jwt)
      .from("clientes")
      .insert({ tenant_id: tenantId, full_name: "Colado", dni_cuit: "99-00022233-4" });

    expect(error?.code).toBe("42501");
  });
});

describeIntegration("authenticated lee SOLO lo que su permiso habilita (RN-S2 en la base)", () => {
  it("lee clientes: tiene manage_clients", async () => {
    const { data, error } = await userClient(jwt).from("clientes").select("id");

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("NO ve historia clínica: le falta view_medical_history", async () => {
    const { data, error } = await userClient(jwt).from("historial_clinico").select("id");

    // RLS no es un error: simplemente no hay filas visibles.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("NO ve la auditoría: le falta view_audit", async () => {
    const { data, error } = await userClient(jwt).from("registros_auditoria").select("id");

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("sigue leyendo los catálogos globales (sin regresión)", async () => {
    const { data, error } = await userClient(jwt).from("especies").select("id");

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describeIntegration("un usuario DESACTIVADO no lee nada, aunque su token siga vivo", () => {
  it("active=false deja el token vigente sin acceso a los datos del tenant", async () => {
    // El agujero: `active` vivía solo en la tabla espejo. La API lo frenaba,
    // pero contra PostgREST el token seguía sirviendo hasta vencer.
    const tokenVigente = jwt;

    const { data: antes } = await userClient(tokenVigente).from("clientes").select("id");
    expect((antes ?? []).length).toBeGreaterThan(0);

    await serviceDb.from("usuarios").update({ active: false }).eq("id", userId);

    const { data: despues, error } = await userClient(tokenVigente).from("clientes").select("id");
    expect(error).toBeNull();
    expect(despues ?? []).toHaveLength(0);

    // Se restablece para no ensuciar otros tests del archivo.
    await serviceDb.from("usuarios").update({ active: true }).eq("id", userId);
  });
});

describeIntegration("rate limit del login: el conteo vive en la base", () => {
  const CLAVES  = ["user:qa_rate_limit", "ip:203.0.113.7"];
  const MAXIMOS = [5, 50];

  it("bloquea recién cuando la cuenta supera SU máximo", async () => {
    await serviceDb.rpc("limpiar_intentos_login", { p_claves: CLAVES });

    for (let intento = 1; intento <= 5; intento += 1) {
      const { data } = await serviceDb.rpc("registrar_intento_login", {
        p_claves: CLAVES, p_maximos: MAXIMOS, p_ventana_minutos: 15,
      });
      expect(data).toBe(false);
    }

    const { data: sexto } = await serviceDb.rpc("registrar_intento_login", {
      p_claves: CLAVES, p_maximos: MAXIMOS, p_ventana_minutos: 15,
    });
    expect(sexto).toBe(true);
  });

  it("limpiar los buckets desbloquea (es lo que hace el login exitoso)", async () => {
    await serviceDb.rpc("limpiar_intentos_login", { p_claves: CLAVES });

    const { data } = await serviceDb.rpc("registrar_intento_login", {
      p_claves: CLAVES, p_maximos: MAXIMOS, p_ventana_minutos: 15,
    });
    expect(data).toBe(false);
  });

  it("authenticated NO puede tocar el limitador (si no, se desbloquea solo)", async () => {
    const db = userClient(jwt);

    const { error: errRegistrar } = await db.rpc("registrar_intento_login", {
      p_claves: CLAVES, p_maximos: MAXIMOS, p_ventana_minutos: 15,
    });
    expect(errRegistrar?.code).toBe("42501");

    const { error: errLimpiar } = await db.rpc("limpiar_intentos_login", { p_claves: CLAVES });
    expect(errLimpiar?.code).toBe("42501");

    const { error: errTabla } = await db.from("intentos_login").select("clave");
    expect(errTabla).not.toBeNull();
  });
});
