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
import { crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

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

  // Limpieza defensiva de ejecuciones previas, por la misma vía que el teardown.
  for (const cuit of ["30-11111111-1", "30-22222222-2"]) {
    const { data: prev } = await serviceDb.from("tenants").select("id").eq("cuit_rut", cuit);
    for (const row of prev ?? []) await limpiarTenant(serviceDb, row.id);
  }

  const cuitA = `30-${Date.now().toString().slice(-6)}11-1`;
  const cuitB = `30-${Date.now().toString().slice(-6)}22-2`;

  // Crear tenant A (plan basico) y tenant B (plan premium)
  const { data: tA, error: eA } = await serviceDb
    .from("tenants")
    .insert({ nombre: "Clínica Test A", cuit_rut: cuitA, email_contacto: "a@test.com", plan: "basico" })
    .select("id")
    .single();
  if (eA || !tA) throw new Error(`No se pudo crear tenant A: ${eA?.message}`);
  tenantAId = tA.id;

  const { data: tB, error: eB } = await serviceDb
    .from("tenants")
    .insert({ nombre: "Clínica Test B", cuit_rut: cuitB, email_contacto: "b@test.com", plan: "premium" })
    .select("id")
    .single();
  if (eB || !tB) throw new Error(`No se pudo crear tenant B: ${eB?.message}`);
  tenantBId = tB.id;

  // Aprovisionar con on_tenant_created
  await rpc("on_tenant_created", { p_tenant_id: tenantAId });
  await rpc("on_tenant_created", { p_tenant_id: tenantBId });

  // Crear usuarios en auth.users via API de admin
  const emailA = `usera_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.com`;
  const emailB = `userb_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.com`;

  userAId = await crearUsuarioAuth(emailA, { tenant_id: tenantAId }, "Password123!");
  userBId = await crearUsuarioAuth(emailB, { tenant_id: tenantBId }, "Password123!");

  // Obtener JWTs de los usuarios (sign-in)
  const signInA = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: emailA, password: "Password123!" }),
  });
  const tokenA = await signInA.json() as { access_token?: string };
  jwtA = tokenA.access_token ?? "";

  const signInB = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: emailB, password: "Password123!" }),
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
      username: `usera_${Date.now()}`,
      email: emailA,
      full_name: "Usuario A",
      rol_id: rolAId,
      active: true,
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
      username: `userb_${Date.now()}`,
      email: emailB,
      full_name: "Usuario B",
      rol_id: rolBId,
      active: true,
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

  // Antes: borrado a mano hijo → padre, ignorando todos los errores. El primer
  // DELETE de la lista (`movimientos_stock`) lo rechaza siempre el trigger de
  // inmutabilidad, y el DELETE de `tenants` también por la misma cascada, así
  // que esta suite no borró nunca sus dos clínicas — sumaban dos residuales por
  // corrida. `limpiarTenant` usa la vía legítima (`dar_de_baja_tenant`), borra
  // también las cuentas de Auth y revienta si el tenant sobrevive.
  for (const tid of [tenantAId, tenantBId]) await limpiarTenant(serviceDb, tid);
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
        entity_id: crypto.randomUUID(),
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

describeIntegration("C2·T1 / RN-SC4: Aislamiento RLS del Libro Mayor, Lotes y Existencias", () => {
  let prodAId = "";
  let loteAId = "";
  let movAId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !userAId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    // Crear producto para Tenant A
    const { data: prod } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: `PROD-RLS-STOCK-${Date.now()}`,
      nombre: "Prod RLS Stock",
      unidad_medida_id: unidadId,
    }).select("id").single();
    prodAId = prod?.id ?? "";

    // Crear lote para Tenant A
    const { data: lote } = await serviceDb.from("lotes").insert({
      tenant_id: tenantAId,
      producto_id: prodAId,
      codigo_lote: `LOTE-RLS-A-${Date.now()}`,
      costo_unitario_neto: 200,
      costo_unitario_efectivo: 200,
      origen: "compra",
      usuario_id: userAId,
    }).select("id").single();
    loteAId = lote?.id ?? "";

    // Crear movimiento para Tenant A
    const { data: mov } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: prodAId,
      lote_id: loteAId,
      cantidad: 10,
      usuario_id: userAId,
    }).select("id").single();
    movAId = mov?.id ?? "";
  });

  it("RN-SC4: el usuario B no ve lotes, movimientos_stock ni existencias_lote del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: lotes } = await db.from("lotes").select("id, tenant_id").eq("id", loteAId);
    expect(lotes ?? []).toHaveLength(0);

    const { data: movs } = await db.from("movimientos_stock").select("id, tenant_id").eq("id", movAId);
    expect(movs ?? []).toHaveLength(0);

    const { data: ext } = await db.from("existencias_lote").select("lote_id, tenant_id").eq("lote_id", loteAId);
    expect(ext ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario A sí ve sus propios lotes, movimientos y existencias_lote", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data: lotes, error: errLote } = await db.from("lotes").select("id, tenant_id").eq("id", loteAId);
    expect(errLote).toBeNull();
    expect((lotes ?? []).length).toBe(1);

    const { data: movs, error: errMov } = await db.from("movimientos_stock").select("id, tenant_id").eq("id", movAId);
    expect(errMov).toBeNull();
    expect((movs ?? []).length).toBe(1);

    const { data: ext, error: errExt } = await db.from("existencias_lote").select("lote_id, tenant_id").eq("lote_id", loteAId);
    expect(errExt).toBeNull();
    expect((ext ?? []).length).toBe(1);
  });

  it("RN-SC4: B no puede escribir lotes, movimientos_stock ni existencias_lote por PostgREST", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // Intento de INSERT directo en lotes
    const { error: errLote } = await db.from("lotes").insert({
      tenant_id: tenantBId,
      producto_id: prodAId,
      codigo_lote: "LOTE-HACK",
      costo_unitario_neto: 10,
      costo_unitario_efectivo: 10,
      origen: "compra",
      usuario_id: userAId,
    });
    expect(errLote).not.toBeNull();

    // Intento de INSERT directo en movimientos_stock
    const { error: errMov } = await db.from("movimientos_stock").insert({
      tenant_id: tenantBId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: prodAId,
      lote_id: loteAId,
      cantidad: 5,
      usuario_id: userAId,
    });
    expect(errMov).not.toBeNull();

    // Intento de INSERT directo en existencias_lote
    const { error: errExt } = await db.from("existencias_lote").insert({
      lote_id: loteAId,
      tenant_id: tenantBId,
      producto_id: prodAId,
      cantidad: 999,
    });
    expect(errExt).not.toBeNull();
  });
});

describeIntegration("C3·T1 / RN-SC4: Aislamiento RLS de Cajas, Sesiones de Caja y Movimientos de Caja", () => {
  let cajaAId = "";
  let sesionAId = "";
  let movCajaAId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !userAId) return;

    // 1. Crear caja para Tenant A
    const { data: caja } = await serviceDb.from("cajas").insert({
      tenant_id: tenantAId,
      nombre: `Caja Principal RLS-${Date.now()}`,
    }).select("id").single();
    cajaAId = caja?.id ?? "";

    // 2. Crear sesión para Tenant A
    const { data: sesion } = await serviceDb.from("sesiones_caja").insert({
      tenant_id: tenantAId,
      caja_id: cajaAId,
      estado: "abierta",
      apertura_usuario_id: userAId,
      saldo_inicial: 1000,
    }).select("id").single();
    sesionAId = sesion?.id ?? "";

    // 3. Medio de pago
    const { data: mp } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();
    const medioPagoId = mp?.id as string;

    // 4. Crear movimiento de caja para Tenant A
    const { data: mov } = await serviceDb.from("movimientos_caja").insert({
      tenant_id: tenantAId,
      sesion_caja_id: sesionAId,
      tipo: "ingreso_manual",
      medio_pago_id: medioPagoId,
      importe: 500,
      usuario_id: userAId,
      motivo: "Fondo inicial extra",
    }).select("id").single();
    movCajaAId = mov?.id ?? "";
  });

  it("RN-SC4: el usuario B no ve cajas, sesiones_caja ni movimientos_caja del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: cajas } = await db.from("cajas").select("id, tenant_id").eq("id", cajaAId);
    expect(cajas ?? []).toHaveLength(0);

    const { data: sesiones } = await db.from("sesiones_caja").select("id, tenant_id").eq("id", sesionAId);
    expect(sesiones ?? []).toHaveLength(0);

    const { data: movs } = await db.from("movimientos_caja").select("id, tenant_id").eq("id", movCajaAId);
    expect(movs ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario A sí ve sus propias cajas, sesiones_caja y movimientos_caja", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data: cajas, error: errCaja } = await db.from("cajas").select("id, tenant_id").eq("id", cajaAId);
    expect(errCaja).toBeNull();
    expect((cajas ?? []).length).toBe(1);

    const { data: sesiones, error: errSesion } = await db.from("sesiones_caja").select("id, tenant_id").eq("id", sesionAId);
    expect(errSesion).toBeNull();
    expect((sesiones ?? []).length).toBe(1);

    const { data: movs, error: errMov } = await db.from("movimientos_caja").select("id, tenant_id").eq("id", movCajaAId);
    expect(errMov).toBeNull();
    expect((movs ?? []).length).toBe(1);
  });

  it("RN-SC4: B no puede escribir cajas, sesiones_caja ni movimientos_caja por PostgREST", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // Intento de INSERT directo en cajas
    const { error: errCaja } = await db.from("cajas").insert({
      tenant_id: tenantBId,
      nombre: "Caja Hack",
    });
    expect(errCaja).not.toBeNull();

    // Intento de INSERT directo en sesiones_caja
    const { error: errSesion } = await db.from("sesiones_caja").insert({
      tenant_id: tenantBId,
      caja_id: cajaAId,
      estado: "abierta",
      apertura_usuario_id: userAId,
      saldo_inicial: 500,
    });
    expect(errSesion).not.toBeNull();

    // Intento de INSERT directo en movimientos_caja
    const { error: errMov } = await db.from("movimientos_caja").insert({
      tenant_id: tenantBId,
      sesion_caja_id: sesionAId,
      tipo: "ingreso_manual",
      medio_pago_id: "00000000-0000-0000-0000-000000000000",
      importe: 100,
      usuario_id: userAId,
    });
    expect(errMov).not.toBeNull();
  });
});

describe("Módulo Comercial: Ventas, ítems, pagos y contadores", () => {
  let ventaAId = "";
  let ventaItemAId = "";
  let pagoAId = "";
  let cajaAId = "";
  let sesionAId = "";
  let productoAId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !userAId) return;

    // 1. Caja y Sesión para Tenant A
    const { data: caja } = await serviceDb.from("cajas").insert({
      tenant_id: tenantAId,
      nombre: `Caja Ventas RLS-${Date.now()}`,
    }).select("id").single();
    cajaAId = caja?.id ?? "";

    const { data: sesion } = await serviceDb.from("sesiones_caja").insert({
      tenant_id: tenantAId,
      caja_id: cajaAId,
      estado: "abierta",
      apertura_usuario_id: userAId,
      saldo_inicial: 1000,
    }).select("id").single();
    sesionAId = sesion?.id ?? "";

    // 2. Producto para Tenant A
    const { data: um } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const { data: prod } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: `RLS-VNT-${Date.now()}`,
      nombre: "Producto Ventas RLS",
      unidad_medida_id: um?.id,
      precio_venta: 1000,
      alicuota_iva: 21.00,
      activo: true,
      es_vendible: true,
    }).select("id").single();
    productoAId = prod?.id ?? "";

    // 3. Contador para Tenant A
    await serviceDb.from("contadores_tenant").insert({
      tenant_id: tenantAId,
      nombre: "venta",
      valor: 1,
    });

    // 4. Venta para Tenant A
    const { data: venta } = await serviceDb.from("ventas").insert({
      tenant_id: tenantAId,
      numero_operacion: 1,
      sesion_caja_id: sesionAId,
      usuario_id: userAId,
      subtotal_neto: 826.45,
      total_iva: 173.55,
      total: 1000,
    }).select("id").single();
    ventaAId = venta?.id ?? "";

    // 5. Item de venta
    const { data: item } = await serviceDb.from("ventas_items").insert({
      tenant_id: tenantAId,
      venta_id: ventaAId,
      tipo_item: "producto",
      producto_id: productoAId,
      descripcion_snapshot: "Producto Ventas RLS",
      cantidad: 1,
      precio_unitario: 1000,
      alicuota_iva: 21.00,
      neto_unitario: 826.45,
      iva_unitario: 173.55,
      importe_total: 1000,
    }).select("id").single();
    ventaItemAId = item?.id ?? "";

    // 6. Pago de venta
    const { data: mp } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();
    const { data: pago } = await serviceDb.from("ventas_pagos").insert({
      tenant_id: tenantAId,
      venta_id: ventaAId,
      medio_pago_id: mp?.id,
      importe: 1000,
    }).select("id").single();
    pagoAId = pago?.id ?? "";
  });

  it("RN-SC4: el usuario B no ve ventas, ventas_items, ventas_pagos ni contadores_tenant del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: ventas } = await db.from("ventas").select("id, tenant_id").eq("id", ventaAId);
    expect(ventas ?? []).toHaveLength(0);

    const { data: items } = await db.from("ventas_items").select("id, tenant_id").eq("id", ventaItemAId);
    expect(items ?? []).toHaveLength(0);

    const { data: pagos } = await db.from("ventas_pagos").select("id, tenant_id").eq("id", pagoAId);
    expect(pagos ?? []).toHaveLength(0);

    const { data: contadores } = await db.from("contadores_tenant").select("nombre, tenant_id").eq("tenant_id", tenantAId);
    expect(contadores ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario A sí ve sus propias ventas, ventas_items, ventas_pagos y contadores_tenant", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data: ventas, error: errV } = await db.from("ventas").select("id, tenant_id").eq("id", ventaAId);
    expect(errV).toBeNull();
    expect((ventas ?? []).length).toBe(1);

    const { data: items, error: errI } = await db.from("ventas_items").select("id, tenant_id").eq("id", ventaItemAId);
    expect(errI).toBeNull();
    expect((items ?? []).length).toBe(1);

    const { data: pagos, error: errP } = await db.from("ventas_pagos").select("id, tenant_id").eq("id", pagoAId);
    expect(errP).toBeNull();
    expect((pagos ?? []).length).toBe(1);

    const { data: contadores, error: errC } = await db.from("contadores_tenant").select("nombre, tenant_id").eq("tenant_id", tenantAId);
    expect(errC).toBeNull();
    expect((contadores ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("RN-SC4: B no puede escribir ventas, ventas_items, ventas_pagos ni contadores_tenant por PostgREST", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // Intento de INSERT directo en ventas
    const { error: errV } = await db.from("ventas").insert({
      tenant_id: tenantBId,
      numero_operacion: 999,
      sesion_caja_id: sesionAId,
      usuario_id: userAId,
    });
    expect(errV).not.toBeNull();

    // Intento de INSERT directo en ventas_items
    const { error: errI } = await db.from("ventas_items").insert({
      tenant_id: tenantBId,
      venta_id: ventaAId,
      tipo_item: "producto",
      producto_id: productoAId,
      descripcion_snapshot: "hack",
      cantidad: 1,
      precio_unitario: 10,
      alicuota_iva: 21,
      neto_unitario: 8.26,
      iva_unitario: 1.74,
      importe_total: 10,
    });
    expect(errI).not.toBeNull();

    // Intento de INSERT directo en ventas_pagos
    const { error: errP } = await db.from("ventas_pagos").insert({
      tenant_id: tenantBId,
      venta_id: ventaAId,
      medio_pago_id: "00000000-0000-0000-0000-000000000000",
      importe: 10,
    });
    expect(errP).not.toBeNull();

    // Intento de INSERT directo en contadores_tenant
    const { error: errC } = await db.from("contadores_tenant").insert({
      tenant_id: tenantBId,
      nombre: "venta",
      valor: 999,
    });
    expect(errC).not.toBeNull();
  });
});

describe("C5·T1 / RN-SC4: Aislamiento RLS de Recuentos y Recuentos Detalle", () => {
  let recAId = "";
  let recDetAId = "";
  let prodAId = "";
  let loteAId = "";

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !userAId) return;

    // 1. Producto y Lote para Tenant A
    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const { data: prod } = await serviceDb.from("productos").insert({
      tenant_id: tenantAId,
      codigo: `PROD-RLS-REC-${Date.now()}`,
      nombre: "Prod RLS Recuento",
      unidad_medida_id: unidadId,
    }).select("id").single();
    prodAId = prod?.id ?? "";

    const { data: lote } = await serviceDb.from("lotes").insert({
      tenant_id: tenantAId,
      producto_id: prodAId,
      codigo_lote: `LOTE-RLS-REC-${Date.now()}`,
      costo_unitario_neto: 100,
      costo_unitario_efectivo: 100,
      origen: "compra",
      usuario_id: userAId,
    }).select("id").single();
    loteAId = lote?.id ?? "";

    // 2. Recuento y Recuento Detalle para Tenant A
    const { data: rec } = await serviceDb.from("recuentos").insert({
      tenant_id: tenantAId,
      usuario_id: userAId,
      estado: "borrador",
      observaciones: "Recuento RLS A",
    }).select("id").single();
    recAId = rec?.id ?? "";

    const { data: det } = await serviceDb.from("recuentos_detalle").insert({
      tenant_id: tenantAId,
      recuento_id: recAId,
      lote_id: loteAId,
      cantidad_contada: 10,
    }).select("id").single();
    recDetAId = det?.id ?? "";
  });

  it("RN-SC4: el usuario B no ve recuentos ni recuentos_detalle del tenant A", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    const { data: recs } = await db.from("recuentos").select("id, tenant_id").eq("id", recAId);
    expect(recs ?? []).toHaveLength(0);

    const { data: dets } = await db.from("recuentos_detalle").select("id, tenant_id").eq("id", recDetAId);
    expect(dets ?? []).toHaveLength(0);
  });

  it("RN-SC4: el usuario A sí ve sus propios recuentos y recuentos_detalle", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const { data: recs, error: errR } = await db.from("recuentos").select("id, tenant_id").eq("id", recAId);
    expect(errR).toBeNull();
    expect((recs ?? []).length).toBe(1);

    const { data: dets, error: errD } = await db.from("recuentos_detalle").select("id, tenant_id").eq("id", recDetAId);
    expect(errD).toBeNull();
    expect((dets ?? []).length).toBe(1);
  });

  it("RN-SC4: B no puede escribir recuentos ni recuentos_detalle por PostgREST", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // Intento de INSERT directo en recuentos
    const { error: errR } = await db.from("recuentos").insert({
      tenant_id: tenantBId,
      usuario_id: userAId,
      estado: "borrador",
    });
    expect(errR).not.toBeNull();

    // Intento de INSERT directo en recuentos_detalle
    const { error: errD } = await db.from("recuentos_detalle").insert({
      tenant_id: tenantBId,
      recuento_id: recAId,
      lote_id: loteAId,
      cantidad_contada: 5,
    });
    expect(errD).not.toBeNull();
  });
});



// ─────────────────────────────────────────────────────────────────────────────
// RLS-Vistas — las 7 vistas comerciales
//
// POR QUÉ EXISTE ESTE BLOQUE
//
// Hasta la auditoría del Módulo Comercial este archivo probaba 30 tablas y CERO
// vistas, y las 7 vistas comerciales se habían creado sin `security_invoker`.
// Una vista sin esa opción se ejecuta con los privilegios de SU DUEÑO (aquí
// `postgres`, que tiene BYPASSRLS), no con los de quien la consulta: la RLS de
// las tablas de abajo NO se aplica. Como además `authenticated` tenía SELECT
// sobre las 7, cualquier usuario logueado de cualquier clínica podía pedirlas
// por PostgREST directo y leer las filas de TODAS las demás. No hacía falta un
// bug en ningún Service: la fuga estaba en la definición de la vista.
//
// El control de abajo es el que define si el hardening sirvió: se siembra el
// tenant A con datos que aparecen en las 7 vistas y se consulta con el JWT del
// tenant B, filtrando explícitamente por el tenant_id de A. Esperado: cero
// filas ajenas, siempre.
//
// El segundo test cubre la otra mitad del hardening (el REVOKE). Son dos
// controles distintos a propósito: `security_invoker` hace que la vista respete
// la RLS, y el REVOKE hace que ni siquiera se pueda pedir. Si mañana alguien
// re-otorga el SELECT, el primer test sigue en verde (la RLS lo cubre) y este
// se pone rojo — que es exactamente la señal que se quiere.
// ─────────────────────────────────────────────────────────────────────────────

/** Las 7 vistas comerciales, con la columna que sirve para pedir una fila. */
const VISTAS_COMERCIALES = [
  "v_lotes_por_vencer",
  "v_items_vendidos",
  "v_margen_venta",
  "v_costo_fraccionamiento",
  "v_stock_familia_unidad_base",
  "v_consumo_clinico",
  "v_atenciones_sin_consumo",
] as const;

describeIntegration("RLS-Vistas / RN-SC4: las 7 vistas comerciales no filtran datos de otro tenant", () => {
  /** Filas que el tenant A tiene en cada vista. Se llena en el beforeAll. */
  const filasDeA: Record<string, number> = {};

  /**
   * Insert del fixture que NO puede fallar en silencio. Sin esto, un valor de
   * enum equivocado (pasó: `origen: "fraccionamiento"` en vez de "conversion")
   * deja la vista vacía y el control de aislamiento da verde por falta de
   * datos. El chequeo de conteo de abajo es la red; esto es el diagnóstico.
   */
  async function sembrar<T = { id: string }>(tabla: string, fila: Record<string, unknown> | Array<Record<string, unknown>>): Promise<T> {
    const { data, error } = await serviceDb.from(tabla).insert(fila as never).select("*");
    if (error) throw new Error(`Fixture RLS-Vistas: no se pudo sembrar ${tabla}: ${error.message}`);
    return (data?.[0] ?? {}) as T;
  }

  beforeAll(async () => {
    if (skipIfNoCredentials() || !tenantAId || !userAId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;


    // ── Catálogo: familia + producto padre + producto hijo (fraccionamiento) ──
    const fam = await sembrar("familias_producto", {
      tenant_id: tenantAId, nombre: `Fam Vistas A ${sufijo}`, unidad_base_id: unidadId,
    });

    const prodPadre = await sembrar("productos", {
      tenant_id: tenantAId, codigo: `PROD-VISTA-PADRE-${sufijo}`, nombre: "Prod Vistas Padre",
      unidad_medida_id: unidadId, familia_id: fam.id,
    });
    const prodHijo = await sembrar("productos", {
      tenant_id: tenantAId, codigo: `PROD-VISTA-HIJO-${sufijo}`, nombre: "Prod Vistas Hijo",
      unidad_medida_id: unidadId, familia_id: fam.id,
    });

    await sembrar("producto_conversiones", {
      tenant_id: tenantAId, producto_origen_id: prodPadre.id, producto_destino_id: prodHijo.id,
      factor_teorico: 10,
    });

    // ── Lotes: el padre CON vencimiento (v_lotes_por_vencer) y el hijo ────────
    const vencimiento = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const lotePadre = await sembrar("lotes", {
      tenant_id: tenantAId, producto_id: prodPadre.id, codigo_lote: `LOTE-VISTA-P-${sufijo}`,
      fecha_vencimiento: vencimiento, costo_unitario_neto: 100, costo_unitario_efectivo: 100,
      origen: "compra", usuario_id: userAId,
    });
    const loteHijo = await sembrar("lotes", {
      tenant_id: tenantAId, producto_id: prodHijo.id, codigo_lote: `LOTE-VISTA-H-${sufijo}`,
      fecha_vencimiento: vencimiento, costo_unitario_neto: 12, costo_unitario_efectivo: 12,
      origen: "conversion", lote_padre_id: lotePadre.id, usuario_id: userAId,
    });

    // Existencia inicial (v_lotes_por_vencer, v_stock_familia_unidad_base)
    await sembrar("movimientos_stock", {
      tenant_id: tenantAId, operacion_id: crypto.randomUUID(), tipo: "entrada_inicial",
      producto_id: prodPadre.id, lote_id: lotePadre.id, cantidad: 100,
      costo_unitario: 100, costo_total: 10000, usuario_id: userAId,
    });

    // ── Fraccionamiento: una operación con salida + entrada (v_costo_fraccionamiento) ──
    const opFrac = crypto.randomUUID();
    await sembrar("movimientos_stock", [
      {
        tenant_id: tenantAId, operacion_id: opFrac, tipo: "salida_conversion",
        producto_id: prodPadre.id, lote_id: lotePadre.id, cantidad: 1,
        costo_unitario: 100, costo_total: 100, lote_destino_id: loteHijo.id, usuario_id: userAId,
      },
      {
        tenant_id: tenantAId, operacion_id: opFrac, tipo: "entrada_conversion",
        producto_id: prodHijo.id, lote_id: loteHijo.id, cantidad: 9,
        costo_unitario: 11.1111, costo_total: 100, usuario_id: userAId,
      },
    ]);

    // ── Historial clínico: uno CON consumo y otro SIN (las dos vistas de C7) ──
    const { data: esp } = await serviceDb.from("especies").select("id").eq("tenant_id", tenantAId).limit(1);
    const especieId = esp?.[0]?.id;

    const cli = await sembrar<{ id: string; full_name: string }>("clientes", {
      tenant_id: tenantAId, full_name: `Cliente Vistas A ${sufijo}`, phone: "1122334455",
    });

    const masc = await sembrar("mascotas", {
      tenant_id: tenantAId, name: "Mascota Vistas A", client_id: cli.id,
      especie_id: especieId, sex: "Macho", tamano: "Mediano",
    });

    const historialBase = {
      tenant_id: tenantAId, pet_id: masc.id, professional_id: userAId,
      date: new Date().toISOString().slice(0, 10), description: "Atención de prueba",
      client_id_at_time: cli.id, client_name_at_time: cli.full_name,
    };

    const hcConConsumo = await sembrar("historial_clinico", { ...historialBase, event_type: "Consulta" });
    // Segundo evento SIN consumo asociado → v_atenciones_sin_consumo
    await sembrar("historial_clinico", { ...historialBase, event_type: "Control" });

    await sembrar("movimientos_stock", {
      tenant_id: tenantAId, operacion_id: crypto.randomUUID(), tipo: "consumo_clinico",
      producto_id: prodPadre.id, lote_id: lotePadre.id, cantidad: 2,
      costo_unitario: 100, costo_total: 200,
      historial_id: hcConConsumo.id, mascota_id: masc.id, usuario_id: userAId,
    });

    // ── Venta: caja + sesión + venta + item (v_items_vendidos, v_margen_venta) ──
    const caja = await sembrar("cajas", { tenant_id: tenantAId, nombre: `Caja Vistas ${sufijo}` });
    const sesion = await sembrar("sesiones_caja", {
      tenant_id: tenantAId, caja_id: caja.id, apertura_usuario_id: userAId, saldo_inicial: 0,
    });
    const venta = await sembrar("ventas", {
      tenant_id: tenantAId, numero_operacion: 900000 + Math.floor(Math.random() * 90000),
      sesion_caja_id: sesion.id, subtotal_neto: 200, total_iva: 42, total: 242,
      estado: "registrada", usuario_id: userAId,
    });
    await sembrar("ventas_items", {
      tenant_id: tenantAId, venta_id: venta.id, tipo_item: "producto", producto_id: prodPadre.id,
      descripcion_snapshot: "Prod Vistas Padre", cantidad: 2, precio_unitario: 121,
      alicuota_iva: 21, neto_unitario: 100, iva_unitario: 21, importe_total: 242,
      costo_unitario_efectivo: 100,
    });

    // Se registra cuántas filas tiene A en cada vista: si alguna quedara en 0,
    // el test de aislamiento daría verde sin haber probado nada.
    for (const vista of VISTAS_COMERCIALES) {
      const { count } = await serviceDb
        .from(vista)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantAId);
      filasDeA[vista] = count ?? 0;
    }
  }, 60_000);

  it("el fixture siembra datos del tenant A en las 7 vistas (si no, el test siguiente no probaría nada)", () => {
    if (skipIfNoCredentials()) return;
    for (const vista of VISTAS_COMERCIALES) {
      expect(
        filasDeA[vista],
        `La vista ${vista} no tiene ninguna fila del tenant A: el control de aislamiento de abajo ` +
        `daría verde por falta de datos, no por estar aislada.`,
      ).toBeGreaterThan(0);
    }
  });

  it("BLOQUEANTE: el usuario B no obtiene NI UNA fila del tenant A en ninguna de las 7 vistas", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtB);

    // Se recorren las 7 y recién al final se asevera, para que el mensaje liste
    // TODAS las vistas que filtran y no solo la primera.
    const fugas: string[] = [];
    for (const vista of VISTAS_COMERCIALES) {
      const { data } = await db.from(vista).select("tenant_id").eq("tenant_id", tenantAId);
      if ((data ?? []).length > 0) fugas.push(`${vista} (${(data ?? []).length} fila/s)`);
    }

    expect(
      fugas,
      `FUGA CROSS-TENANT: estas vistas le devolvieron filas del tenant A a un usuario del ` +
      `tenant B: ${fugas.join(", ")}. Una vista sin security_invoker = true corre con los ` +
      `privilegios de su dueño (postgres, BYPASSRLS) y no aplica la RLS de las tablas de abajo.`,
    ).toEqual([]);
  });

  it("BLOQUEANTE: authenticated no tiene SELECT sobre ninguna de las 7 vistas", async () => {
    if (skipIfNoCredentials()) return;
    const db = userClient(jwtA);

    const legibles: string[] = [];
    for (const vista of VISTAS_COMERCIALES) {
      const { error } = await db.from(vista).select("tenant_id").limit(1);
      if (error?.code !== "42501") legibles.push(`${vista} (${error?.code ?? "sin error"})`);
    }

    expect(
      legibles,
      `Estas vistas siguen siendo legibles por el rol authenticated: ${legibles.join(", ")}. ` +
      `Las vistas comerciales se consultan por la API con service_role; ningún JWT de usuario ` +
      `debería poder pedirlas por PostgREST directo (§4.13 de la adenda).`,
    ).toEqual([]);
  });
});
