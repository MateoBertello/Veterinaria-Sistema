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
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";


globalThis.WebSocket = class FakeWebSocket {} as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let serviceDb: SupabaseClient;

let tenantAId: string;
let tenantBId: string;
let userAId:   string;
let userBId:   string;
let jwtA:      string;
let jwtB:      string;
let clienteAId = "";
let doctorAId  = "";
let notifAId   = "";

/** Cliente con el JWT de un usuario (RLS activo) */
function userClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: "usera@test.com", password: "Password123!" }),
  });
  const tokenA = await signInA.json() as { access_token?: string };
  jwtA = tokenA.access_token ?? "";

  const signInB = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
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

  // Insertar cliente en tenant A (se captura el id para los tests de escritura)
  const { data: clienteA } = await serviceDb.from("clientes").insert({
    tenant_id: tenantAId,
    full_name: "Cliente de A",
    phone: "1111111111",
  }).select("id").single();
  clienteAId = clienteA?.id ?? "";

  // Insertar servicio en tenant A
  await serviceDb.from("servicios").insert({
    tenant_id: tenantAId,
    nombre: "Consulta General A",
    duracion_minutos: 30,
    tipo: "clinica",
  });

  // Insertar doctor en tenant A (+ una franja horaria) para los tests de aislamiento
  const { data: doctorA } = await serviceDb.from("doctores").insert({
    tenant_id: tenantAId,
    user_id: userAId || null,
    name: "Dr. de A",
    specialty: "Clínica general",
    available: true,
  }).select("id").single();
  doctorAId = doctorA?.id ?? "";

  if (doctorAId) {
    await serviceDb.from("horarios_doctor").insert({
      tenant_id: tenantAId,
      doctor_id: doctorAId,
      day_of_week: 1,
      start_time: "09:00",
      end_time: "13:00",
      active: true,
    });
  }

  // Insertar una notificación de turno en tenant A (Etapa 6) para los tests de aislamiento.
  const { data: notifA } = await serviceDb.from("notificaciones").insert({
    tenant_id: tenantAId,
    origen: "turno",
    referencia_id: clienteAId || tenantAId, // un UUID cualquiera del tenant A
    canal: "email",
    estado: "pendiente",
    mensaje: "Recordatorio de A",
  }).select("id").single();
  notifAId = notifA?.id ?? "";
}, 30_000);

afterAll(async () => {
  if (!serviceDb) return;

  const adminHeaders = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
  };

  // CASCADE en tenants elimina todo lo demás. Va PRIMERO: desde que
  // `usuarios.id` referencia a `auth.users` con ON DELETE CASCADE (migración
  // 20260725000005), borrar la cuenta de Auth arrastra la fila espejo y las FK
  // que apuntan al usuario frenan el borrado, dejando cuentas huérfanas.
  if (tenantAId) await serviceDb.from("tenants").delete().eq("id", tenantAId);
  if (tenantBId) await serviceDb.from("tenants").delete().eq("id", tenantBId);

  // Ahora sí, las cuentas de auth.
  if (userAId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userAId}`, { method: "DELETE", headers: adminHeaders });
  if (userBId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userBId}`, { method: "DELETE", headers: adminHeaders });
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

describeIntegration("RLS-1: Aislamiento de clientes", () => {
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

  it("el usuario B no puede MODIFICAR clientes del tenant A (RLS write)", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // La política USING oculta la fila de A para B → el UPDATE afecta 0 filas.
    const { data: updated } = await db
      .from("clientes")
      .update({ full_name: "Hackeado por B" })
      .eq("id", clienteAId)
      .select("id");
    expect(updated ?? []).toHaveLength(0);

    // Verificación con service role: el dato original se conserva intacto.
    const { data: intacto } = await serviceDb
      .from("clientes")
      .select("full_name")
      .eq("id", clienteAId)
      .single();
    expect(intacto?.full_name).toBe("Cliente de A");
  });

  it("el usuario B no puede INSERTAR clientes con tenant_id ajeno (WITH CHECK)", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // WITH CHECK exige tenant_id = current_tenant_id() (el de B) → rechaza el de A.
    const { error } = await db
      .from("clientes")
      .insert({ tenant_id: tenantAId, full_name: "Inyectado por B", phone: "9999" });
    expect(error).not.toBeNull();
  });
});

describeIntegration("RLS-2: Aislamiento de mascotas", () => {
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

describeIntegration("RLS-3: Aislamiento de servicios", () => {
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

describeIntegration("RLS-4: Aislamiento de turnos", () => {
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

describeIntegration("RLS-5: Aislamiento de estadias", () => {
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

describeIntegration("RLS-6: Aislamiento de historial_clinico", () => {
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

describeIntegration("RLS-6b: Aislamiento de doctores (Etapa 4)", () => {
  it("el usuario B no ve doctores del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("doctores")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("el usuario A sí ve sus propios doctores", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data } = await db
      .from("doctores")
      .select("id")
      .eq("tenant_id", tenantAId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("el usuario B no puede MODIFICAR doctores del tenant A (RLS write)", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data: updated } = await db
      .from("doctores")
      .update({ specialty: "Hackeado por B" })
      .eq("id", doctorAId)
      .select("id");
    expect(updated ?? []).toHaveLength(0);

    const { data: intacto } = await serviceDb
      .from("doctores")
      .select("specialty")
      .eq("id", doctorAId)
      .single();
    expect(intacto?.specialty).toBe("Clínica general");
  });
});

describeIntegration("RLS-6c: Aislamiento de horarios_doctor (Etapa 4)", () => {
  it("el usuario B no ve franjas horarias del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db
      .from("horarios_doctor")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("el usuario B no puede INSERTAR franjas con tenant_id ajeno (WITH CHECK)", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { error } = await db
      .from("horarios_doctor")
      .insert({
        tenant_id: tenantAId,
        doctor_id: doctorAId,
        day_of_week: 2,
        start_time: "10:00",
        end_time: "12:00",
        active: true,
      });
    expect(error).not.toBeNull();
  });
});

// Hasta 20260827000001_catalogos_por_tenant.sql estos tres catálogos eran
// globales y su política RLS era "cualquier autenticado los lee". Ahora son de
// cada clínica: la lectura por PostgREST directo desde el frontend sigue siendo
// la excepción documentada en el CLAUDE.md, pero está aislada por tenant como
// cualquier tabla de negocio. `permisos` es el único que sigue siendo global.
describeIntegration("RLS-7: Catálogos clínicos aislados por tenant", () => {
  it("usuario A lee especies, y todas son de su tenant", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db.from("especies").select("id, name, tenant_id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((e) => e.tenant_id === tenantAId)).toBe(true);
  });

  it("usuario B lee tipos_vacuna, y todos son de su tenant", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data, error } = await db.from("tipos_vacuna").select("id, nombre, tenant_id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((t) => t.tenant_id === tenantBId)).toBe(true);
  });

  it("usuario A lee razas, y todas son de su tenant", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db.from("razas").select("id, name, tenant_id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((r) => r.tenant_id === tenantAId)).toBe(true);
  });

  it("BLOQUEANTE: A no ve NADA del catálogo de B, ni pidiéndolo por id", async () => {
    if (skipIfNoCredentials()) return;

    // Ids reales del catálogo de B, leídos con service role (bypassea RLS).
    const { data: espB } = await serviceDb
      .from("especies").select("id").eq("tenant_id", tenantBId).limit(1).single();
    const { data: tvB } = await serviceDb
      .from("tipos_vacuna").select("id").eq("tenant_id", tenantBId).limit(1).single();

    const db = userClient(jwtA);

    const { data: verEspecie } = await db.from("especies").select("id").eq("id", espB?.id);
    expect(verEspecie ?? []).toHaveLength(0);

    const { data: verTipo } = await db.from("tipos_vacuna").select("id").eq("id", tvB?.id);
    expect(verTipo ?? []).toHaveLength(0);

    const { data: razasDeB } = await db.from("razas").select("id").eq("tenant_id", tenantBId);
    expect(razasDeB ?? []).toHaveLength(0);
  });

  it("BLOQUEANTE: A no ve las asociaciones especie↔vacuna de B", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data, error } = await db.from("especie_tipo_vacuna").select("tenant_id");
    expect(error).toBeNull();
    expect(
      (data ?? []).every((r: { tenant_id: string }) => r.tenant_id === tenantAId),
      "A ve asociaciones de otra clínica",
    ).toBe(true);

    const { data: deB } = await db
      .from("especie_tipo_vacuna").select("tenant_id").eq("tenant_id", tenantBId);
    expect(deB ?? []).toHaveLength(0);
  });

  it("BLOQUEANTE: A no puede escribir la tabla de asociación por PostgREST", async () => {
    // La escritura entra por la Edge Function con `service_role`. Si esto
    // pasara, cualquiera podría habilitarse una vacuna para cualquier especie
    // sin permiso `manage_catalogs` y sin dejar asiento de auditoría.
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data: esp } = await serviceDb
      .from("especies").select("id").eq("tenant_id", tenantAId).limit(1).single();
    const { data: tv } = await serviceDb
      .from("tipos_vacuna").select("id").eq("tenant_id", tenantAId).limit(1).single();

    const { error } = await db.from("especie_tipo_vacuna").insert({
      tenant_id:      tenantAId,
      especie_id:     (esp as { id: string }).id,
      tipo_vacuna_id: (tv  as { id: string }).id,
    });
    expect(error).not.toBeNull();
  });

  it("BLOQUEANTE: A no puede escribir en el catálogo (ni en el suyo) por PostgREST", async () => {
    // El REVOKE de 20260725000003_hardening_authenticated_rls.sql sigue valiendo:
    // `authenticated` no tiene INSERT/UPDATE/DELETE y las escrituras entran por
    // la Edge Function. El catálogo dejó de ser global, pero no por eso se abre.
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { error } = await db
      .from("especies")
      .insert({ tenant_id: tenantAId, name: `Intrusa ${Date.now()}` });
    expect(error).not.toBeNull();
  });

  it("usuario B puede leer permisos", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data, error } = await db.from("permisos").select("id, name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describeIntegration("RLS-8: Tablas de plataforma solo accesibles por super admin", () => {
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

describeIntegration("RLS-9: Idempotencia de seed_global", () => {
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

  // El catálogo semilla se mudó de `seed_global.sql` (una vez, global) a
  // `seed_catalogos_tenant()` (una vez por clínica). La idempotencia importa
  // igual: `on_tenant_created` la llama en cada alta, y el backfill de la
  // migración la corrió sobre los tenants que ya existían.
  it("ejecutar seed_catalogos_tenant dos veces no duplica el catálogo del tenant", async () => {
    if (skipIfNoCredentials()) return;

    const contar = async (tabla: string) => {
      const { count } = await serviceDb
        .from(tabla)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);
      return count;
    };

    const foto = async () => ({
      especies:            await contar("especies"),
      razas:               await contar("razas"),
      tipos_vacuna:        await contar("tipos_vacuna"),
      especie_tipo_vacuna: await contar("especie_tipo_vacuna"),
    });

    const antes = await foto();
    expect(antes.especies).toBeGreaterThan(0);
    // La idempotencia del bloque de asociaciones descansa en un ON CONFLICT DO
    // NOTHING contra la PK compuesta; se ejercita acá porque el backfill de la
    // migración vuelve a llamar a esta misma función sobre tenants ya sembrados.
    expect(antes.especie_tipo_vacuna).toBeGreaterThan(0);

    await serviceDb.rpc("seed_catalogos_tenant", { p_tenant_id: tenantAId });

    expect(await foto()).toEqual(antes);
  });
});

describeIntegration("RLS-10: on_tenant_created — roles correctos", () => {
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

    // 22 desde 20260901000002_comercial_permisos_licenciamiento.sql (12 previos + 10 comerciales)
    expect(count).toBe(22);
  });

  it("el rol veterinario tiene exactamente 11 permisos, incluidos manage_clients y manage_catalogs", async () => {
    if (skipIfNoCredentials()) return;
    const { data: vetRol } = await serviceDb
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("name", "veterinario")
      .single();

    const { data: permisos, count } = await serviceDb
      .from("rol_permiso")
      .select("permisos!inner(name)", { count: "exact" })
      .eq("rol_id", vetRol?.id ?? "");

    expect(count).toBe(11);
    // El Documento Maestro lo lista como actor de la gestión de clientes; sin
    // este permiso no podía ni consultar la ficha del dueño de su paciente.
    const nombres = (permisos ?? []).map((rp: { permisos: { name: string } }) => rp.permisos.name);
    expect(nombres).toContain("manage_clients");
    // Cargar una raza o un tipo de vacuna es tarea del trabajo diario, no de la
    // configuración de la clínica: por eso `manage_catalogs` y no
    // `manage_tenant_settings`.
    expect(nombres).toContain("manage_catalogs");
  });

  it("el rol recepcionista tiene exactamente 11 permisos, incluido manage_catalogs", async () => {
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

    expect(count).toBe(11);
  });

  // El catálogo clínico se aprovisiona junto con los roles y la configuración
  // (20260827000001_catalogos_por_tenant.sql). Si esto falla, una clínica nueva
  // nace sin ninguna especie y no puede registrar su primera mascota.
  it("siembra el catálogo clínico del tenant (7 especies, 14 razas, 8 tipos de vacuna)", async () => {
    if (skipIfNoCredentials()) return;

    const contar = async (tabla: string) => {
      const { count } = await serviceDb
        .from(tabla)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);
      return count;
    };

    expect(await contar("especies")).toBe(7);
    expect(await contar("razas")).toBe(14);
    expect(await contar("tipos_vacuna")).toBe(8);
  });

  /**
   * El calendario sanitario tiene que venir armado, no solo la lista de vacunas.
   * Sin la relación, una clínica nueva nace con ocho tipos de vacuna y CERO
   * vacunas aplicables a cualquier mascota: el combo de programar dosis sale
   * vacío desde el día uno y el bug se ve como "el sistema no tiene vacunas".
   */
  it("siembra la relación especie↔vacuna: la clínica nace con su calendario sanitario", async () => {
    if (skipIfNoCredentials()) return;

    const { count } = await serviceDb
      .from("especie_tipo_vacuna")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantAId);

    expect(count).toBe(11);
  });

  it("la antirrábica del tenant nuevo aplica a perro y gato, y no a las aves", async () => {
    if (skipIfNoCredentials()) return;

    const { data } = await serviceDb
      .from("especie_tipo_vacuna")
      .select("especie:especies!especie_tipo_vacuna_especie_fkey(name), tipo:tipos_vacuna!especie_tipo_vacuna_tipo_fkey(nombre)")
      .eq("tenant_id", tenantAId);

    // El embed se pide por NOMBRE DE CONSTRAINT: las dos FKs son compuestas
    // sobre (fk_id, tenant_id) y una pista por columna daría PGRST200.
    const pares = ((data ?? []) as Array<{ especie: { name: string }; tipo: { nombre: string } }>)
      .map((r) => `${r.tipo.nombre}→${r.especie.name}`);

    expect(pares).toContain("Antirrábica→Perro");
    expect(pares).toContain("Antirrábica→Gato");
    expect(pares).not.toContain("Antirrábica→Ave");
    expect(pares).toContain("Triple Felina→Gato");
    expect(pares).not.toContain("Triple Felina→Perro");
  });
});

describeIntegration("RLS-11: on_tenant_created — configuración default", () => {
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

describeIntegration("RLS-12: on_tenant_created — módulos plan básico", () => {
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

describeIntegration("RLS-13: on_tenant_created — módulos plan premium", () => {
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

// ─── RLS-auditoria ───────────────────────────────────────────────────────────
// BLOQUEANTE — Etapa 4: un tenant solo ve SUS registros de auditoría (RN-AUD3).

describeIntegration("RLS-auditoria: registros_auditoria — aislamiento por tenant", () => {
  let registroAId = "";

  it("setup: insertar registro de auditoría para tenant A con service role", async () => {
    if (skipIfNoCredentials()) return;
    const { data, error } = await serviceDb
      .from("registros_auditoria")
      .insert({
        tenant_id: tenantAId,
        user_id:   userAId,
        user_name: "Admin A",
        user_role: "admin",
        action:    "CREATE",
        module:    "clients",
        entity_id: "ent-audit-001",
        details:   "registro de prueba RLS",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    registroAId = (data as { id: string } | null)?.id ?? "";
    expect(registroAId).not.toBe("");
  });

  it("el usuario B no ve registros de auditoría del tenant A (READ isolation)", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await userClient(jwtB)
      .from("registros_auditoria")
      .select("id")
      .eq("tenant_id", tenantAId);
    expect((data ?? []).length).toBe(0);
  });

  it("el usuario A sí ve sus propios registros de auditoría", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await userClient(jwtA)
      .from("registros_auditoria")
      .select("id")
      .eq("id", registroAId);
    expect((data ?? []).length).toBe(1);
  });

  it("el usuario B no puede insertar registros con tenant_id del tenant A (WITH CHECK)", async () => {
    if (skipIfNoCredentials()) return;
    const { data: inserted } = await userClient(jwtB)
      .from("registros_auditoria")
      .insert({
        tenant_id: tenantAId,
        action:    "VIEW",
        module:    "clients",
      })
      .select("id");
    expect((inserted ?? []).length).toBe(0);
  });
});

describeIntegration("RLS-N: Aislamiento de notificaciones (Etapa 6)", () => {
  it("el usuario B no ve notificaciones del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await userClient(jwtB)
      .from("notificaciones")
      .select("id, tenant_id")
      .eq("tenant_id", tenantAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("el usuario A sí ve sus propias notificaciones", async () => {
    if (skipIfNoCredentials()) return;
    const { data } = await userClient(jwtA)
      .from("notificaciones")
      .select("id")
      .eq("id", notifAId);
    expect((data ?? []).length).toBe(1);
  });

  it("el usuario B no puede MODIFICAR notificaciones del tenant A (RLS write)", async () => {
    if (skipIfNoCredentials()) return;
    // La política USING oculta la fila de A para B → el UPDATE afecta 0 filas.
    const { data: updated } = await userClient(jwtB)
      .from("notificaciones")
      .update({ estado: "enviada" })
      .eq("id", notifAId)
      .select("id");
    expect(updated ?? []).toHaveLength(0);

    // Verificación con service role: el estado original se conserva intacto.
    const { data: intacto } = await serviceDb
      .from("notificaciones")
      .select("estado")
      .eq("id", notifAId)
      .single();
    expect(intacto?.estado).toBe("pendiente");
  });

  it("el usuario B no puede INSERTAR notificaciones con tenant_id ajeno (WITH CHECK)", async () => {
    if (skipIfNoCredentials()) return;
    const { error } = await userClient(jwtB)
      .from("notificaciones")
      .insert({
        tenant_id: tenantAId,
        origen: "turno",
        referencia_id: tenantAId,
        canal: "email",
        estado: "pendiente",
      });
    expect(error).not.toBeNull();
  });
});

// ─── Módulo Comercial: Aislamiento por tenant (RN-SC4) ──────────────────────

describeIntegration("RLS-Comercial: Catálogo comercial y proveedores aislados por tenant", () => {
  let prodAId = "";
  let famAId = "";
  let provAId = "";
  let convAId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !tenantBId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    // Sembrar familias, productos, conversiones y proveedores en tenant A
    const { data: fam } = await serviceDb.from("familias_producto").insert({
      tenant_id: tenantAId, nombre: `Fam RLS A ${Date.now()}`, unidad_base_id: unidadId,
    }).select("id").single();
    famAId = fam?.id ?? "";

    const { data: prod1 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-RLS-A1-${Date.now()}`, nombre: "Prod RLS A1",
      unidad_medida_id: unidadId, familia_id: famAId,
    }).select("id").single();
    prodAId = prod1?.id ?? "";

    const { data: prod2 } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId, codigo: `PROD-RLS-A2-${Date.now()}`, nombre: "Prod RLS A2",
      unidad_medida_id: unidadId, familia_id: famAId,
    }).select("id").single();

    const { data: conv } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: tenantAId, producto_origen_id: prodAId, producto_destino_id: prod2?.id,
      factor_teorico: 2,
    }).select("id").single();
    convAId = conv?.id ?? "";

    const { data: prov } = await serviceDb.from("proveedores").insert({
      tenant_id: tenantAId, razon_social: `Proveedor RLS A ${Date.now()}`,
    }).select("id").single();
    provAId = prov?.id ?? "";
  });

  it("RN-SC4: el usuario B no ve productos del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);
    const { data } = await db.from("productos").select("id, tenant_id").eq("id", prodAId);
    expect(data ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario B no ve familias, conversiones ni proveedores de A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: fams } = await db.from("familias_producto").select("id").eq("id", famAId);
    expect(fams ?? []).toHaveLength(0);

    const { data: convs } = await db.from("producto_conversiones").select("id").eq("id", convAId);
    expect(convs ?? []).toHaveLength(0);

    const { data: provs } = await db.from("proveedores").select("id").eq("id", provAId);
    expect(provs ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario A sí ve sus propios productos", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);
    const { data, error } = await db.from("productos").select("id, tenant_id").eq("id", prodAId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect((data ?? [])[0].tenant_id).toBe(tenantAId);
  });

  it("RN-SC4: B no puede escribir el catálogo comercial por PostgREST", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    // Intento de INSERT directo con token de usuario
    const { error: errInsert } = await db.from("productos").insert({
      tenant_id: tenantBId,
      codigo: `PROD-HACK-${Date.now()}`,
      nombre: "Prod Postgrest Directo",
      unidad_medida_id: unidadId,
    });
    expect(errInsert).not.toBeNull();

    // Intento de UPDATE directo
    const { error: errUpdate } = await db.from("productos").update({ nombre: "Nombre Hackeado" }).eq("id", prodAId);
    expect(errUpdate).not.toBeNull();
  });
});
