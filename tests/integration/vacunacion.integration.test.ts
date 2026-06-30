/**
 * Tests de integración — Plan de Vacunación CRUD (Etapa 8, RN-PV1..PV5, PV8, PV9).
 *
 * Dos candados de seguridad que los tests unitarios no pueden verificar porque
 * dependen de la base real:
 *
 *   1. Aislamiento de tenant en las 4 operaciones (GET, POST, PUT, PATCH /cancelar):
 *      el aislamiento lo garantiza el filtro `tenant_id` explícito del código porque
 *      `getServiceDb()` bypasea RLS. Un fallo de filtro en cualquiera de las 4 rutas
 *      expone datos de otro tenant.
 *
 *   2. Cruce con eutanasia (RN-PV4, dos caras):
 *      (a) La eutanasia cancela las dosis Pendiente vía el RPC de la Etapa 5 — el
 *          CRUD de vacunación no debe romper esa transacción.
 *      (b) Tras la eutanasia, el CRUD debe rechazar programar (PET_DECEASED) y editar
 *          la dosis ya cancelada (VACCINE_PLAN_ALREADY_APPLIED).
 *
 * Requiere un proyecto Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración vacunación omitidos: falta configuración Supabase en .env");
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

async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Vacunación ${sufijo}`,
      cuit_rut:       `30-${Date.now().toString().slice(-7)}${sufijo}-7`,
      email_contacto: `vacunacion-${sufijo}@test.com`,
      plan:           "basico", // basico → módulo historial_clinico habilitado
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-vacunacion-${sufijo}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  const { data: rolAdmin } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_vac_${sufijo}`,
    email, full_name: `Admin Vac ${sufijo}`, rol_id: rolAdmin?.id, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño Vac ${sufijo}`, phone: "1122334455" })
    .select("id")
    .single();

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

// ─── Estado global del arnés ──────────────────────────────────────────────────

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let especieId    = "";
let tipoVacunaId = "";

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: esp } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = esp?.id ?? "";
  const { data: tv } = await serviceDb.from("tipos_vacuna").select("id").eq("active", true).limit(1).single();
  tipoVacunaId = tv?.id ?? "";

  tenantA = await provisionTenant(serviceDb, "VA");
  tenantB = await provisionTenant(serviceDb, "VB");
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) {
    if (!tid) continue;
    const { data: usuarios } = await serviceDb.from("usuarios").select("id").eq("tenant_id", tid);
    for (const u of (usuarios ?? []) as { id: string }[]) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders() });
    }
    await serviceDb.from("tenants").delete().eq("id", tid);
  }
});

// ─── Helpers de datos ──────────────────────────────────────────────────────────

async function crearMascota(jwt: string, clienteId: string, name: string): Promise<string> {
  const res = await callApp("/mascotas", {
    method: "POST", jwt,
    body: { name, clientId: clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

/** Siembra una dosis Pendiente para una mascota del tenant indicado vía serviceDb. */
async function seedDosis(tenantId: string, petId: string, fechaEstimada = "2026-10-01"): Promise<string> {
  const { data } = await serviceDb
    .from("plan_vacunacion")
    .insert({
      tenant_id: tenantId, pet_id: petId, tipo_vacuna_id: tipoVacunaId,
      fecha_estimada: fechaEstimada, estado: "Pendiente",
    })
    .select("id")
    .single();
  return data?.id as string;
}

async function getEstadoDosis(dosisId: string): Promise<string> {
  const { data } = await serviceDb.from("plan_vacunacion").select("estado").eq("id", dosisId).single();
  return (data as { estado: string }).estado;
}

async function getDosis(dosisId: string): Promise<{ estado: string; evento_aplicacion_id: string | null }> {
  const { data } = await serviceDb
    .from("plan_vacunacion").select("estado, evento_aplicacion_id").eq("id", dosisId).single();
  return data as { estado: string; evento_aplicacion_id: string | null };
}

/** Eventos clínicos 'Vacunación' de una mascota (para verificar atomicidad). */
async function getEventosVacunacion(petId: string): Promise<{ id: string }[]> {
  const { data } = await serviceDb
    .from("historial_clinico").select("id").eq("pet_id", petId).eq("event_type", "Vacunación");
  return (data ?? []) as { id: string }[];
}

/** Asientos de auditoría UPDATE sobre una dosis (entity_id = dosisId). */
async function getAuditoriaDosis(dosisId: string): Promise<{ action: string; user_id: string }[]> {
  const { data } = await serviceDb
    .from("registros_auditoria").select("action, user_id")
    .eq("entity_id", dosisId).eq("module", "medical_records").eq("action", "UPDATE");
  return (data ?? []) as { action: string; user_id: string }[];
}

function futureDate(offsetDays = 30): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ─── Candado 1: Aislamiento de tenant en las 4 operaciones ────────────────────

describeIntegration("Vacunación: aislamiento de tenant en las 4 operaciones (bloqueante)", () => {
  // Las mascotas y dosis se crean para Tenant A y los intentos los hace Tenant B.
  // Si el filtro tenant_id falla en cualquiera de las 4 rutas, hay fuga de datos.

  it("GET /mascotas/:petId/plan-vacunacion — B no lista dosis de mascota de A → 404 MASCOTA_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "MascotaGET_B");
    await seedDosis(tenantA.tenantId, petId);

    const res  = await callApp(`/mascotas/${petId}/plan-vacunacion`, { jwt: tenantB.jwt });
    const body = await res.json() as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");
  });

  it("POST /mascotas/:petId/plan-vacunacion — B no programa dosis para mascota de A → 404 MASCOTA_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "MascotaPOST_B");

    const res  = await callApp(`/mascotas/${petId}/plan-vacunacion`, {
      method: "POST", jwt: tenantB.jwt,
      body: { tipoVacunaId, fechaEstimada: futureDate(30) },
    });
    const body = await res.json() as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");
  });

  it("PUT /plan-vacunacion/:id — B no edita dosis de A → 404 VACCINE_PLAN_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "MascotaPUT_B");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    const res  = await callApp(`/plan-vacunacion/${dosisId}`, {
      method: "PUT", jwt: tenantB.jwt,
      body: { fechaEstimada: futureDate(60) },
    });
    const body = await res.json() as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("VACCINE_PLAN_NOT_FOUND");

    // La dosis de A no fue tocada
    expect(await getEstadoDosis(dosisId)).toBe("Pendiente");
  });

  it("PATCH /plan-vacunacion/:id/cancelar — B no cancela dosis de A → 404 VACCINE_PLAN_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "MascotaPATCH_B");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    const res  = await callApp(`/plan-vacunacion/${dosisId}/cancelar`, {
      method: "PATCH", jwt: tenantB.jwt,
      body: {},
    });
    const body = await res.json() as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("VACCINE_PLAN_NOT_FOUND");

    // La dosis de A sigue Pendiente
    expect(await getEstadoDosis(dosisId)).toBe("Pendiente");
  });
});

// ─── Candado 2: Cruce con eutanasia (RN-PV4, dos caras) ──────────────────────

describeIntegration("Vacunación ↔ Eutanasia: cruce RN-PV4 (dos caras)", () => {
  /**
   * Cara 1: el RPC registrar_eutanasia (Etapa 5) cancela las dosis Pendiente.
   *   El CRUD de vacunación (Etapa 8) no debe romper ese contrato.
   *
   * Cara 2a: POST en mascota Fallecida → 422 PET_DECEASED.
   * Cara 2b: PUT sobre dosis Cancelada (por la eutanasia) → 422 VACCINE_PLAN_ALREADY_APPLIED.
   */

  it("cara 1 (RPC): eutanasia cancela dosis Pendiente de la mascota", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "EutanasiaCaraUno");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    // Verificar punto de partida
    expect(await getEstadoDosis(dosisId)).toBe("Pendiente");

    // Registrar eutanasia vía API (igual que el test de Etapa 5)
    const res = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantA.jwt,
      body: {
        date:                 "2026-07-01",
        professionalId:       tenantA.userId,
        description:          "Enfermedad terminal — candado RN-PV4",
        euthanasiaConfirmed:  true,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { cancelledDoses: number } };
    expect(body.data.cancelledDoses).toBeGreaterThanOrEqual(1); // RN-PV4

    // La dosis Pendiente quedó Cancelada vía la transacción del RPC
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada");
  });

  it("cara 2a: POST en mascota Fallecida → 422 PET_DECEASED", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    // Crear una mascota nueva y matarla
    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "EutanasiaCaraDosA");
    const res1 = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantA.jwt,
      body: { date: "2026-07-02", professionalId: tenantA.userId, description: "Test PET_DECEASED", euthanasiaConfirmed: true },
    });
    expect(res1.status).toBe(201);

    // Intentar programar una dosis para la mascota ya Fallecida
    const res2 = await callApp(`/mascotas/${petId}/plan-vacunacion`, {
      method: "POST", jwt: tenantA.jwt,
      body: { tipoVacunaId, fechaEstimada: futureDate(30) },
    });
    const body2 = await res2.json() as { error: { code: string } };

    expect(res2.status).toBe(422);
    expect(body2.error.code).toBe("PET_DECEASED");
  });

  it("cara 2b: PUT sobre dosis Cancelada por eutanasia → 422 VACCINE_PLAN_ALREADY_APPLIED", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    // Crear mascota con dosis Pendiente y luego registrar eutanasia
    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "EutanasiaCaraDosB");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    const res1 = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantA.jwt,
      body: { date: "2026-07-03", professionalId: tenantA.userId, description: "Test ALREADY_APPLIED", euthanasiaConfirmed: true },
    });
    expect(res1.status).toBe(201);
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada"); // RN-PV4 activó

    // Intentar editar la dosis que el RPC ya canceló
    const res2 = await callApp(`/plan-vacunacion/${dosisId}`, {
      method: "PUT", jwt: tenantA.jwt,
      body: { fechaEstimada: futureDate(60) },
    });
    const body2 = await res2.json() as { error: { code: string } };

    expect(res2.status).toBe(422);
    expect(body2.error.code).toBe("VACCINE_PLAN_ALREADY_APPLIED");
  });
});

// ─── Candado 3: marcar dosis Aplicada (transacción plan+evento, atómica) ─────

describeIntegration("Vacunación: marcar dosis Aplicada (transacción plan+evento)", () => {
  /**
   * Marcar Aplicada es transaccional como la eutanasia: o quedan la dosis Aplicada
   * Y el evento clínico 'Vacunación' enlazado (con su asiento de auditoría), o
   * ninguna de las tres cosas. Lo garantiza el RPC marcar_dosis_aplicada.
   */

  it("happy path: dosis Aplicada + evento 'Vacunación' enlazado + auditoría, todo atómico", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AplicarOK");
    const dosisId = await seedDosis(tenantA.tenantId, petId);
    expect(await getEstadoDosis(dosisId)).toBe("Pendiente");

    const res = await callApp(`/plan-vacunacion/${dosisId}/aplicar`, {
      method: "PATCH", jwt: tenantA.jwt,
      body: { professionalId: tenantA.userId, weightKg: 12.5, temperatureC: 38.5, notes: "Sin reacción adversa" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { estado: string; estadoVisual: string; eventoAplicacionId: string } };
    expect(body.data.estado).toBe("Aplicada");
    expect(body.data.estadoVisual).toBe("Aplicada");
    expect(body.data.eventoAplicacionId).toBeTruthy();

    // (a) La dosis quedó Aplicada y enlazada al evento.
    const dosis = await getDosis(dosisId);
    expect(dosis.estado).toBe("Aplicada");
    expect(dosis.evento_aplicacion_id).toBe(body.data.eventoAplicacionId);

    // (b) Existe exactamente un evento clínico 'Vacunación' y es el enlazado.
    const eventos = await getEventosVacunacion(petId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].id).toBe(body.data.eventoAplicacionId);

    // (c) Asiento de auditoría atómico, con el usuario que ejecutó.
    const asientos = await getAuditoriaDosis(dosisId);
    expect(asientos).toHaveLength(1);
    expect(asientos[0].action).toBe("UPDATE");
    expect(asientos[0].user_id).toBe(tenantA.userId);
  });

  it("RN-PV5: aplicar una dosis ya Aplicada → 422 VACCINE_PLAN_ALREADY_APPLIED", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AplicarDosVeces");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    const res1 = await callApp(`/plan-vacunacion/${dosisId}/aplicar`, {
      method: "PATCH", jwt: tenantA.jwt, body: { professionalId: tenantA.userId },
    });
    expect(res1.status).toBe(200);

    const res2 = await callApp(`/plan-vacunacion/${dosisId}/aplicar`, {
      method: "PATCH", jwt: tenantA.jwt, body: { professionalId: tenantA.userId },
    });
    const body2 = await res2.json() as { error: { code: string } };
    expect(res2.status).toBe(422);
    expect(body2.error.code).toBe("VACCINE_PLAN_ALREADY_APPLIED");
  });

  it("rollback atómico: si falla el INSERT del evento, la dosis NO queda Aplicada (ni evento ni auditoría)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AplicarRollback");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    // Falla determinista: weight_kg fuera del CHECK (BETWEEN 0 AND 200) del evento.
    // El INSERT en historial_clinico (paso 1) revienta → toda la transacción rollbackea.
    const { error } = await serviceDb.rpc("marcar_dosis_aplicada", {
      p_tenant_id:       tenantA.tenantId,
      p_dosis_id:        dosisId,
      p_professional_id: tenantA.userId,
      p_user_id:         tenantA.userId,
      p_date:            "2026-06-30",
      p_weight_kg:       9999,
    });

    // El RPC falló (y no por "función no encontrada" → evita un falso verde).
    expect(error).toBeTruthy();
    expect(error?.message ?? "").not.toMatch(/could not find|schema cache/i);

    // (a) La dosis sigue Pendiente y sin evento enlazado.
    const dosis = await getDosis(dosisId);
    expect(dosis.estado).toBe("Pendiente");
    expect(dosis.evento_aplicacion_id).toBeNull();

    // (b) No quedó ningún evento 'Vacunación'.
    expect(await getEventosVacunacion(petId)).toHaveLength(0);

    // (c) No quedó asiento de auditoría (atómico con la operación).
    expect(await getAuditoriaDosis(dosisId)).toHaveLength(0);
  });

  it("cruce RN-PV4: una dosis cancelada por eutanasia NO puede marcarse Aplicada → 422", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AplicarTrasEutanasia");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    // Eutanasia (Etapa 5): cancela la dosis Pendiente vía RN-PV4.
    const resEut = await callApp(`/mascotas/${petId}/eutanasia`, {
      method: "POST", jwt: tenantA.jwt,
      body: { date: "2026-07-04", professionalId: tenantA.userId, description: "Cruce aplicar↔eutanasia", euthanasiaConfirmed: true },
    });
    expect(resEut.status).toBe(201);
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada");

    // Intentar aplicar la dosis ya Cancelada → rechazado por RN-PV5.
    const res = await callApp(`/plan-vacunacion/${dosisId}/aplicar`, {
      method: "PATCH", jwt: tenantA.jwt, body: { professionalId: tenantA.userId },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VACCINE_PLAN_ALREADY_APPLIED");

    // La dosis sigue Cancelada (no se volteó a Aplicada).
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada");
  });

  it("aislamiento: B no puede aplicar una dosis de A → 404 VACCINE_PLAN_NOT_FOUND, dosis de A intacta", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    const petId   = await crearMascota(tenantA.jwt, tenantA.clienteId, "AplicarAjena");
    const dosisId = await seedDosis(tenantA.tenantId, petId);

    const res = await callApp(`/plan-vacunacion/${dosisId}/aplicar`, {
      method: "PATCH", jwt: tenantB.jwt, body: { professionalId: tenantB.userId },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("VACCINE_PLAN_NOT_FOUND");

    // La dosis de A quedó intacta.
    const dosis = await getDosis(dosisId);
    expect(dosis.estado).toBe("Pendiente");
    expect(dosis.evento_aplicacion_id).toBeNull();
  });
});

// ─── Smoke CRUD básico ────────────────────────────────────────────────────────
// Precondición de los dos candados: si el CRUD básico no funciona, los tests
// de aislamiento podrían fallar por la razón equivocada.

describeIntegration("Vacunación: CRUD básico (happy path end-to-end)", () => {
  it("programar → listar (Proxima) → editar → cancelar", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "CrudBasico");
    const fecha1 = futureDate(20);
    const fecha2 = futureDate(40);

    // Programar
    const resPost = await callApp(`/mascotas/${petId}/plan-vacunacion`, {
      method: "POST", jwt: tenantA.jwt,
      body: { tipoVacunaId, fechaEstimada: fecha1 },
    });
    expect(resPost.status).toBe(201);
    const postBody = await resPost.json() as { data: { id: string; estadoVisual: string; estado: string } };
    expect(postBody.data.estadoVisual).toBe("Proxima");
    expect(postBody.data.estado).toBe("Pendiente");
    const dosisId = postBody.data.id;

    // Listar — debe aparecer con estadoVisual=Proxima
    const resGet = await callApp(`/mascotas/${petId}/plan-vacunacion`, { jwt: tenantA.jwt });
    expect(resGet.status).toBe(200);
    const getBody = await resGet.json() as { data: { id: string; estadoVisual: string }[]; meta: { total: number } };
    expect(getBody.meta.total).toBe(1);
    expect(getBody.data[0].estadoVisual).toBe("Proxima");

    // Editar
    const resPut = await callApp(`/plan-vacunacion/${dosisId}`, {
      method: "PUT", jwt: tenantA.jwt,
      body: { fechaEstimada: fecha2 },
    });
    expect(resPut.status).toBe(200);
    const putBody = await resPut.json() as { data: { fechaEstimada: string; estadoVisual: string } };
    expect(putBody.data.fechaEstimada).toBe(fecha2);
    expect(putBody.data.estadoVisual).toBe("Proxima");

    // Cancelar
    const resPatch = await callApp(`/plan-vacunacion/${dosisId}/cancelar`, {
      method: "PATCH", jwt: tenantA.jwt, body: {},
    });
    expect(resPatch.status).toBe(200);
    const patchBody = await resPatch.json() as { data: { estado: string } };
    expect(patchBody.data.estado).toBe("Cancelada");

    // Verificar en base que el estado persiste
    expect(await getEstadoDosis(dosisId)).toBe("Cancelada");
  });

  it("RN-PV1: dosis con fecha pasada → estadoVisual=Vencida en el listado", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId = await crearMascota(tenantA.jwt, tenantA.clienteId, "DosisVencida");

    // Sembrar directamente con fecha en el pasado (no se puede programar via API RN-PV2)
    await seedDosis(tenantA.tenantId, petId, "2026-01-01");

    const resGet = await callApp(`/mascotas/${petId}/plan-vacunacion`, { jwt: tenantA.jwt });
    expect(resGet.status).toBe(200);
    const getBody = await resGet.json() as { data: { estadoVisual: string }[] };
    expect(getBody.data[0].estadoVisual).toBe("Vencida");
  });
});
