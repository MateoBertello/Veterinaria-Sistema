/**
 * Tests de integración — Eutanasia transaccional (Etapa 5, RN-EC10..EC12, RN-PV4).
 *
 * La eutanasia es la ÚNICA operación irreversible del sistema (CLAUDE.md regla 8)
 * y se resuelve en UNA transacción vía el RPC `registrar_eutanasia`. Ningún otro
 * test de integración ejerce ese RPC, así que esta suite es la que lo ejecuta DE
 * VERDAD contra la base con las migraciones aplicadas.
 *
 * Cubre los 4 casos pactados:
 *   1. Happy path (RN-EC11 + RN-PV4 + asiento de auditoría atómico con el ejecutor).
 *   2. Rollback atómico REAL: si la transacción falla, NO persiste NADA — ni el
 *      evento, ni el cambio a 'Fallecida', ni la cancelación de dosis, NI el
 *      asiento de auditoría (la mascota no queda "media muerta").
 *   3. Aislamiento por tenant (RLS): B no puede eutanasiar una mascota de A.
 *   4. RN-EC10 vía RPC: sin confirmación explícita el RPC se niega (defensa en
 *      profundidad), sin efectos colaterales.
 *   + Bonus de endurecimiento: `anon` no puede ejecutar el RPC (EXECUTE revocado).
 *
 * Requieren un proyecto Supabase real con TODAS las migraciones aplicadas (incl.
 * 20260623000002_registrar_eutanasia_rpc.sql) y .env con SUPABASE_URL,
 * SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.  Para correr: npx vitest run tests/integration
 *
 * NOTA sobre el punto de inyección del fallo (caso 2): el harness de integración
 * sólo dispone de supabase-js (sin SQL crudo / triggers), por lo que el fallo
 * determinista se inyecta vía inputs del RPC y aterriza en el INSERT del evento
 * (primera escritura) usando un weight_kg fuera del CHECK del DDL. La función es
 * UNA transacción: por semántica de PostgreSQL, un fallo en cualquier sentencia
 * posterior revierte igual lo ya escrito. La pareja "happy path (asiento presente)
 * + rollback (asiento ausente)" demuestra que la auditoría es atómica con la
 * operación.
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración eutanasia omitidos: falta configuración Supabase en .env");
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

/** Aprovisiona un tenant con su admin (rol con manage_medical_history) y un cliente. */
async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Eutanasia ${sufijo}`,
      cuit_rut:       `33-${Date.now().toString().slice(-7)}${sufijo}-9`,
      email_contacto: `eutanasia-${sufijo}@test.com`,
      plan:           "basico", // basico → módulo historial_clinico habilitado
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-eutanasia-${sufijo}@test.com`;
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

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let especieId   = "";
let tipoVacunaId = "";

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: especie } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = especie?.id ?? "";
  const { data: tv } = await serviceDb.from("tipos_vacuna").select("id").limit(1).single();
  tipoVacunaId = tv?.id ?? "";

  tenantA = await provisionTenant(serviceDb, "EA");
  tenantB = await provisionTenant(serviceDb, "EB");
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
    if (!tid) continue;
    // ORDEN IMPORTANTE: primero el tenant, después las cuentas de Auth.
    // Desde que `usuarios.id` referencia a `auth.users` con ON DELETE CASCADE
    // (migración 20260725000005), borrar la cuenta arrastra la fila espejo — y
    // eso lo frena cualquier FK que apunte al usuario, como
    // `historial_clinico.professional_id`. Borrando primero el tenant, su
    // cascade se lleva todo lo dependiente y la cuenta sale limpia. Al revés,
    // el DELETE de Auth falla en silencio y deja cuentas huérfanas que hacen
    // fallar la corrida SIGUIENTE (el email ya existe).
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    await serviceDb.from("tenants").delete().eq("id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
  }
});

// ─── Helpers de datos ──────────────────────────────────────────────────────────

/** Crea una mascota Activa del tenant A vía API y devuelve su id. */
async function crearMascota(name: string): Promise<string> {
  const res = await callApp("/mascotas", {
    method: "POST", jwt: tenantA.jwt,
    body: { name, clientId: tenantA.clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

/** Siembra una dosis Pendiente para la mascota (RN-PV4) y devuelve su id. */
async function seedDosisPendiente(petId: string): Promise<string> {
  const { data } = await serviceDb
    .from("plan_vacunacion")
    .insert({
      tenant_id: tenantA.tenantId, pet_id: petId, tipo_vacuna_id: tipoVacunaId,
      fecha_estimada: "2026-09-01", estado: "Pendiente",
    })
    .select("id")
    .single();
  return data?.id as string;
}

async function getMascota(petId: string) {
  const { data } = await serviceDb
    .from("mascotas")
    .select("estado, deceased_date, deceased_reason")
    .eq("id", petId)
    .single();
  return data as { estado: string; deceased_date: string | null; deceased_reason: string | null };
}

async function getEventosEutanasia(petId: string) {
  const { data } = await serviceDb
    .from("historial_clinico")
    .select("id")
    .eq("pet_id", petId)
    .eq("event_type", "Eutanasia");
  return (data ?? []) as { id: string }[];
}

async function getEstadoDosis(dosisId: string): Promise<string> {
  const { data } = await serviceDb.from("plan_vacunacion").select("estado").eq("id", dosisId).single();
  return (data as { estado: string }).estado;
}

/** Asientos de auditoría de eutanasia (module=medical_records) de una mascota.
 *  Filtra el pet_id en JS sobre new_values para no depender del filtro jsonb de PostgREST. */
async function getAuditoriaEutanasia(petId: string) {
  const { data } = await serviceDb
    .from("registros_auditoria")
    .select("user_id, user_name, action, module, entity_id, new_values")
    .eq("tenant_id", tenantA.tenantId)
    .eq("module", "medical_records");
  type Row = { user_id: string; user_name: string | null; action: string; entity_id: string; new_values: { pet_id?: string } | null };
  return ((data ?? []) as Row[]).filter((r) => r.new_values?.pet_id === petId);
}

// Mismos 11 args que envía el Service (los opcionales explícitos en null), para
// no depender de la resolución de overloads por subconjunto de PostgREST.
function eutanasiaRpcParams(petId: string, over: Record<string, unknown> = {}) {
  return {
    p_tenant_id:       tenantA.tenantId,
    p_pet_id:          petId,
    p_professional_id: tenantA.userId,
    p_user_id:         tenantA.userId,
    p_date:            "2026-06-15",
    p_description:     "Eutanasia humanitaria por enfermedad terminal",
    p_confirmed:       true,
    p_weight_kg:       null,
    p_temperature_c:   null,
    p_diagnosis:       null,
    p_notes:           null,
    ...over,
  };
}

// ─── Caso 1: Happy path (RN-EC11 + RN-PV4 + auditoría atómica) ──────────────────

describeIntegration("Eutanasia: happy path (RN-EC11, RN-PV4)", () => {
  it("registra evento + Fallecida + cancela dosis + asiento de auditoría, todo atómico", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota("EutanasiaOK");
    const dosisId = await seedDosisPendiente(petId);

    const res = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantA.jwt,
      body: { date: "2026-06-15", professionalId: tenantA.userId, description: "Procedimiento humanitario", euthanasiaConfirmed: true },
    });
    const body = await res.json() as {
      success: boolean;
      data: { evento: { id: string; eventType: string }; mascota: { estado: string; deceasedReason: string; deceasedDate: string }; cancelledDoses: number };
    };

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.evento.eventType).toBe("Eutanasia");
    expect(body.data.mascota.estado).toBe("Fallecida");
    expect(body.data.mascota.deceasedReason).toBe("Eutanasia");
    expect(body.data.mascota.deceasedDate).toBe("2026-06-15");
    expect(body.data.cancelledDoses).toBe(1); // RN-PV4

    // (a) la mascota quedó Fallecida en la base.
    const m = await getMascota(petId);
    expect(m.estado).toBe("Fallecida");
    expect(m.deceased_date).toBe("2026-06-15");
    expect(m.deceased_reason).toBe("Eutanasia");

    // (b) existe el evento clínico 'Eutanasia'.
    const eventos = await getEventosEutanasia(petId);
    expect(eventos.length).toBe(1);
    expect(eventos[0].id).toBe(body.data.evento.id);

    // (c) RN-PV4: la dosis Pendiente quedó Cancelada.
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada");

    // (d) asiento de auditoría ATÓMICO, con el usuario que ejecutó (no 'unknown').
    const asientos = await getAuditoriaEutanasia(petId);
    expect(asientos.length).toBe(1);
    expect(asientos[0].action).toBe("CREATE");
    expect(asientos[0].entity_id).toBe(body.data.evento.id);
    expect(asientos[0].user_id).toBe(tenantA.userId);
    expect(asientos[0].user_name).toBeTruthy();
  });
});

// ─── Caso 2: Rollback atómico REAL ─────────────────────────────────────────────

describeIntegration("Eutanasia: rollback atómico (RN-EC11) — el más crítico", () => {
  it("si la transacción falla, NO persiste nada: ni evento, ni Fallecida, ni dosis, NI auditoría", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota("EutanasiaRollback");
    const dosisId = await seedDosisPendiente(petId);

    // Fallo determinista: weight_kg fuera del CHECK (BETWEEN 0 AND 200) del DDL hace
    // abortar el INSERT del evento → toda la transacción rollbackea. Llamada DIRECTA
    // al RPC (bypass del Service) para poder inyectar el valor inválido.
    const { data, error } = await serviceDb.rpc("registrar_eutanasia", eutanasiaRpcParams(petId, { p_weight_kg: 9999 }));

    // El RPC ejecutó de verdad y falló POR EL CHECK (no por "function not found":
    // ese error daría un falso verde — error truthy sin haber tocado nada).
    expect(error).toBeTruthy();
    expect(error?.message ?? "").not.toMatch(/could not find|schema cache/i);
    expect(data ?? []).toHaveLength(0);

    // (a) NO se insertó el evento (la primera escritura se revirtió).
    expect(await getEventosEutanasia(petId)).toHaveLength(0);

    // (b) la mascota sigue 'Activa' — NO quedó "media muerta".
    const m = await getMascota(petId);
    expect(m.estado).toBe("Activa");
    expect(m.deceased_date).toBeNull();

    // (c) RN-PV4 no se aplicó: la dosis sigue Pendiente.
    expect(await getEstadoDosis(dosisId)).toBe("Pendiente");

    // (d) el asiento de auditoría TAMPOCO quedó (atómico con la operación).
    expect(await getAuditoriaEutanasia(petId)).toHaveLength(0);
  });
});

// ─── Caso 3: Aislamiento por tenant (RLS) ──────────────────────────────────────

describeIntegration("Eutanasia: aislamiento por tenant (RLS, bloqueante)", () => {
  it("B no puede eutanasiar una mascota de A vía API → 404, y A queda intacta", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId = await crearMascota("AjenaEutanasia");

    const res = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantB.jwt,
      body: { date: "2026-06-15", professionalId: tenantB.userId, description: "Intento ajeno", euthanasiaConfirmed: true },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");

    // La mascota de A no fue tocada.
    const m = await getMascota(petId);
    expect(m.estado).toBe("Activa");
    expect(await getEventosEutanasia(petId)).toHaveLength(0);
  });

  it("el RPC con p_tenant_id de B sobre mascota de A no la encuentra (scoping explícito)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota("RpcCrossTenant");

    const { error } = await serviceDb.rpc("registrar_eutanasia", eutanasiaRpcParams(petId, { p_tenant_id: tenantB.tenantId }));
    expect(error).toBeTruthy();
    expect((error?.message ?? "")).toContain("MASCOTA_NOT_FOUND");

    const m = await getMascota(petId);
    expect(m.estado).toBe("Activa");
  });
});

// ─── Caso 4: RN-EC10 vía RPC (confirmación obligatoria) ─────────────────────────

describeIntegration("Eutanasia: RN-EC10 confirmación vía RPC", () => {
  it("sin p_confirmed el RPC se niega (EUTHANASIA_CONFIRMATION_REQUIRED) y no toca nada", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota("SinConfirmar");

    const { error } = await serviceDb.rpc("registrar_eutanasia", eutanasiaRpcParams(petId, { p_confirmed: false }));
    expect(error).toBeTruthy();
    expect((error?.message ?? "")).toContain("EUTHANASIA_CONFIRMATION_REQUIRED");

    // Defensa en profundidad: la confirmación se valida ANTES de cualquier escritura.
    const m = await getMascota(petId);
    expect(m.estado).toBe("Activa");
    expect(await getEventosEutanasia(petId)).toHaveLength(0);
    expect(await getAuditoriaEutanasia(petId)).toHaveLength(0);
  });
});

// ─── Bonus: endurecimiento de EXECUTE (REVOKE FROM PUBLIC) ──────────────────────

describeIntegration("Eutanasia: endurecimiento del RPC (anon no puede ejecutarlo)", () => {
  it("un cliente anon no puede invocar registrar_eutanasia (EXECUTE revocado de PUBLIC)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota("AnonNoPuede");
    const anonDb  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    const { error } = await anonDb.rpc("registrar_eutanasia", eutanasiaRpcParams(petId));
    // Debe ser permiso denegado (no "function not found": eso sería falso verde).
    expect(error?.message ?? "").toMatch(/permission denied/i);

    // La mascota no fue tocada por el intento anon.
    const m = await getMascota(petId);
    expect(m.estado).toBe("Activa");
  });
});
