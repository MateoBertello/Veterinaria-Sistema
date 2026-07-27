/**
 * Tests de integración — Dashboard / métricas agregadas (Etapa 12A).
 *
 * BLOQUEANTE: el aislamiento de conteos entre tenants. Los conteos del resumen
 * se hacen con el JWT del usuario (RLS activa) + filtro explícito por tenant_id;
 * este arnés verifica contra una base real que un tenant NUNCA ve números del
 * otro, ni siquiera agregados (un COUNT que se filtra mal no devuelve filas
 * ajenas, pero sí revela el volumen de negocio de otra clínica).
 *
 * Cubre además, contra datos reales:
 *   - el criterio de cada métrica (bajas lógicas, mascotas fallecidas, turnos
 *     cancelados, estadías vigentes de hoy, ventana de 30 días de vacunas);
 *   - el gate por permiso (RN-S2): un veterinario no ve clientes ni guardería;
 *   - el gate por módulo licenciado (regla 4): un tenant plan `basico` no ve
 *     turnos ni guardería.
 *
 * Requiere un proyecto Supabase real con TODAS las migraciones aplicadas y .env
 * con SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

globalThis.WebSocket = class FakeWebSocket {} as never;

import { it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración de dashboard omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

// ─── Helpers de arnés ─────────────────────────────────────────────────────────

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

function userClient(jwt: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false },
  });
}

interface Resumen {
  fecha:              string;
  clientes:           number | null;
  mascotasActivas:    number | null;
  turnosHoy:          number | null;
  estadiasHoy:        number | null;
  vacunasProximas30d: number | null;
}

async function getResumen(jwt: string): Promise<{ status: number; body: { success: boolean; data: Resumen; error?: { code: string } } }> {
  const res = await app.request("http://localhost/api/v1/dashboard/resumen", {
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
  });
  return { status: res.status, body: await res.json() as never };
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(dias: number): string {
  const d = new Date(`${hoyISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ─── Provisión de tenants ─────────────────────────────────────────────────────

interface TenantHarness {
  tenantId:   string;
  jwtAdmin:   string;
  jwtVet:     string;
  clienteId:  string;
  petId:      string;
  servicioId: string;
}

let serviceDb: SupabaseClient;
let especieId    = "";
let tipoVacunaId = "";
const tenantIdsCreados: string[] = [];

async function crearTenant(sufijo: string, plan: "basico" | "premium"): Promise<string> {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Dashboard ${sufijo}`,
      cuit_rut:       `99-${Date.now().toString().slice(-7)}${sufijo}-1`,
      email_contacto: `dashboard-${sufijo}-${Date.now()}@test.com`,
      plan,
    })
    .select("id")
    .single();

  const tenantId = tenant?.id as string;
  if (tenantId) {
    tenantIdsCreados.push(tenantId);
    await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });
  }
  return tenantId;
}

async function crearUsuario(
  tenantId: string,
  rol: "admin" | "veterinario",
  sufijo: string,
): Promise<string> {
  const email  = `${rol}-dashboard-${sufijo}-${Date.now()}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  const { data: rolRow } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", rol).single();

  await serviceDb.from("usuarios").insert({
    id:        userId,
    tenant_id: tenantId,
    username:  `${rol}_dash_${sufijo}`.slice(0, 30),
    email,
    full_name: `${rol} Dashboard ${sufijo}`,
    rol_id:    rolRow?.id,
    active:    true,
  });

  return signIn(email, "TestPass123!");
}

/** Provisiona un tenant con usuarios admin/veterinario y datos base. */
async function provisionTenant(sufijo: string, plan: "basico" | "premium"): Promise<TenantHarness> {
  const tenantId = await crearTenant(sufijo, plan);
  const jwtAdmin = await crearUsuario(tenantId, "admin", sufijo);
  const jwtVet   = await crearUsuario(tenantId, "veterinario", sufijo);

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño Dash ${sufijo}`, phone: "1122334455" })
    .select("id")
    .single();
  const clienteId = cliente?.id as string;

  const { data: mascota } = await serviceDb
    .from("mascotas")
    .insert({
      tenant_id: tenantId, name: `Mascota Dash ${sufijo}`, client_id: clienteId,
      especie_id: especieId, sex: "Macho", tamano: "Mediano",
    })
    .select("id")
    .single();
  const petId = mascota?.id as string;

  const { data: servicio } = await serviceDb
    .from("servicios")
    .insert({
      tenant_id: tenantId, nombre: `Consulta Dash ${sufijo}`, tipo: "clinica",
      duracion_minutos: 30, activo: true,
    })
    .select("id")
    .single();

  return { tenantId, jwtAdmin, jwtVet, clienteId, petId, servicioId: servicio?.id as string };
}

/** Mascota extra (para estadías/turnos que no pueden solaparse sobre la misma). */
async function crearMascotaExtra(t: TenantHarness, nombre: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data } = await serviceDb
    .from("mascotas")
    .insert({
      tenant_id: t.tenantId, name: nombre, client_id: t.clienteId,
      especie_id: especieId, sex: "Hembra", tamano: "Pequeño", ...over,
    })
    .select("id")
    .single();
  return data?.id as string;
}

// ─── Estado global ────────────────────────────────────────────────────────────

let tenantA: TenantHarness;   // premium (3 módulos) — el tenant "bajo prueba"
let tenantB: TenantHarness;   // premium — el vecino que NO debe filtrarse
let tenantC: TenantHarness;   // basico  — solo historial_clinico

// Conteos esperados del tenant A tras el seed (ver seedTenantA).
const ESPERADO_A = {
  clientes:           2,   // 3 creados, 1 dado de baja lógica
  mascotasActivas:    2,   // 4 creadas: 1 fallecida y 1 eliminada no cuentan
  turnosHoy:          2,   // 3 hoy (1 cancelado no cuenta) + 1 de mañana
  estadiasHoy:        1,   // 1 vigente hoy + 1 finalizada ayer + 1 futura
  vacunasProximas30d: 1,   // 1 en ventana + 1 a 60 días + 1 vencida + 1 cancelada
};

async function seedTenantA(): Promise<void> {
  const t = tenantA;

  // Clientes: 1 del provisionamiento + 1 activo + 1 eliminado (RN-CL8).
  // `deleted` va explícito en AMBAS filas: en un insert múltiple PostgREST arma
  // un único juego de columnas y manda NULL donde una fila no trae la clave, lo
  // que rompería el NOT NULL en vez de tomar el DEFAULT.
  await serviceDb.from("clientes").insert([
    { tenant_id: t.tenantId, full_name: "Cliente Activo A",    phone: "111", deleted: false },
    { tenant_id: t.tenantId, full_name: "Cliente Eliminado A", phone: "222", deleted: true },
  ]);

  // Mascotas: 1 del provisionamiento + 1 activa + 1 fallecida + 1 eliminada.
  const petActiva = await crearMascotaExtra(t, "Activa A");
  await crearMascotaExtra(t, "Fallecida A", { estado: "Fallecida", deceased_date: "2026-01-15" });
  await crearMascotaExtra(t, "Eliminada A", { deleted: true });

  // Turnos: hoy Confirmado + hoy Completado + hoy Cancelado + mañana Confirmado.
  await serviceDb.from("turnos").insert([
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "09:00", end_time: "09:30", status: "Confirmado", reason: "Control" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "10:00", end_time: "10:30", status: "Completado", reason: "Vacuna" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "11:00", end_time: "11:30", status: "Cancelado", reason: "Baja" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: sumarDias(1), start_time: "09:00", end_time: "09:30", status: "Confirmado", reason: "Mañana" },
  ]);

  // Estadías: vigente hoy + finalizada (ayer) + futura. Mascotas distintas: el
  // EXCLUDE de la tabla prohíbe solapar dos estadías vigentes de la misma mascota.
  const petEstadiaFutura = await crearMascotaExtra(t, "Futura A", { deleted: true });
  await serviceDb.from("estadias").insert([
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId,
      check_in_date: sumarDias(-2), check_out_date: sumarDias(2), status: "EnCurso",   reason: "Vacaciones" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: petActiva,
      check_in_date: sumarDias(-5), check_out_date: sumarDias(-1), status: "Finalizada", reason: "Pasada" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: petEstadiaFutura,
      check_in_date: sumarDias(10), check_out_date: sumarDias(12), status: "Reservada",  reason: "Futura" },
  ]);

  // Vacunas: 1 pendiente dentro de la ventana + 1 a 60 días + 1 vencida + 1 cancelada
  // (no se usa 'Aplicada' porque el CHECK de la tabla exige evento_aplicacion_id).
  await serviceDb.from("plan_vacunacion").insert([
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(10),  estado: "Pendiente" },
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(60),  estado: "Pendiente" },
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(-10), estado: "Pendiente" },
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(5),   estado: "Cancelada" },
  ]);
}

/** Volumen deliberadamente distinto al de A, para que una fuga sea detectable. */
async function seedTenantB(): Promise<void> {
  const t = tenantB;

  await serviceDb.from("clientes").insert([
    { tenant_id: t.tenantId, full_name: "Cliente B1", phone: "301" },
    { tenant_id: t.tenantId, full_name: "Cliente B2", phone: "302" },
    { tenant_id: t.tenantId, full_name: "Cliente B3", phone: "303" },
    { tenant_id: t.tenantId, full_name: "Cliente B4", phone: "304" },
  ]);

  await crearMascotaExtra(t, "Mascota B2");
  await crearMascotaExtra(t, "Mascota B3");

  await serviceDb.from("turnos").insert([
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "08:00", end_time: "08:30", status: "Confirmado", reason: "B1" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "12:00", end_time: "12:30", status: "Confirmado", reason: "B2" },
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId, servicio_id: t.servicioId,
      date: hoyISO(), start_time: "13:00", end_time: "13:30", status: "Programado", reason: "B3" },
  ]);

  await serviceDb.from("estadias").insert([
    { tenant_id: t.tenantId, client_id: t.clienteId, pet_id: t.petId,
      check_in_date: sumarDias(-1), check_out_date: sumarDias(3), status: "EnCurso", reason: "B" },
  ]);

  await serviceDb.from("plan_vacunacion").insert([
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(3),  estado: "Pendiente" },
    { tenant_id: t.tenantId, pet_id: t.petId, tipo_vacuna_id: tipoVacunaId, fecha_estimada: sumarDias(20), estado: "Pendiente" },
  ]);
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: esp } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = esp?.id ?? "";
  const { data: tv } = await serviceDb.from("tipos_vacuna").select("id").eq("active", true).limit(1).single();
  tipoVacunaId = tv?.id ?? "";

  tenantA = await provisionTenant("DA", "premium");
  tenantB = await provisionTenant("DB", "premium");
  tenantC = await provisionTenant("DC", "basico");

  await seedTenantA();
  await seedTenantB();
}, 120_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of tenantIdsCreados) {
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

// ─── BLOQUEANTE: aislamiento de conteos entre tenants ─────────────────────────

describeIntegration("Dashboard: aislamiento de conteos entre tenants (BLOQUEANTE)", () => {
  it("el resumen del tenant A cuenta SOLO datos de A, con B cargado en paralelo", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { status, body } = await getResumen(tenantA.jwtAdmin);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject(ESPERADO_A);
  });

  it("el resumen del tenant B cuenta SOLO datos de B (números distintos a los de A)", async () => {
    if (skipIfNoCredentials() || !tenantB?.jwtAdmin) return;

    const { body } = await getResumen(tenantB.jwtAdmin);

    expect(body.data).toMatchObject({
      clientes:           5,  // 1 del provisionamiento + 4
      mascotasActivas:    3,
      turnosHoy:          3,
      estadiasHoy:        1,
      vacunasProximas30d: 2,
    });
    // Ninguna métrica coincide con la suma A+B: no hay fuga cruzada.
    expect(body.data.clientes).not.toBe(ESPERADO_A.clientes + 5);
  });

  it("RLS: con el JWT de A, un COUNT sin filtro de tenant sigue devolviendo solo filas de A", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const dbA = userClient(tenantA.jwtAdmin);

    // Sin .eq("tenant_id", …): el aislamiento lo tiene que poner la política RLS.
    const { count: clientesVisibles } = await dbA
      .from("clientes").select("*", { count: "exact", head: true }).eq("deleted", false);
    const { count: turnosVisibles } = await dbA
      .from("turnos").select("*", { count: "exact", head: true }).eq("date", hoyISO());

    expect(clientesVisibles).toBe(ESPERADO_A.clientes);
    expect(turnosVisibles).toBe(3);   // los 3 de hoy de A (incluye el cancelado), ninguno de B

    // Y explícitamente: cero filas del vecino.
    const { count: filasDeB } = await dbA
      .from("clientes").select("*", { count: "exact", head: true }).eq("tenant_id", tenantB.tenantId);
    expect(filasDeB).toBe(0);
  });

  it("el tenant_id sale del JWT: el mismo endpoint con otro JWT devuelve otros números", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin || !tenantB?.jwtAdmin) return;

    const resA = await getResumen(tenantA.jwtAdmin);
    const resB = await getResumen(tenantB.jwtAdmin);

    expect(resA.body.data.clientes).toBe(ESPERADO_A.clientes);
    expect(resB.body.data.clientes).toBe(5);
  });

  it("sin JWT → 401 UNAUTHORIZED (no hay métricas anónimas)", async () => {
    if (skipIfNoCredentials()) return;

    const res  = await app.request("http://localhost/api/v1/dashboard/resumen");
    const body = await res.json() as { success: boolean; error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ─── Criterio de las métricas contra datos reales ─────────────────────────────

describeIntegration("Dashboard: criterio de cada métrica", () => {
  it("clientes excluye las bajas lógicas y mascotasActivas excluye fallecidas y eliminadas", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { body } = await getResumen(tenantA.jwtAdmin);

    expect(body.data.clientes).toBe(ESPERADO_A.clientes);
    expect(body.data.mascotasActivas).toBe(ESPERADO_A.mascotasActivas);
  });

  it("turnosHoy excluye cancelados y turnos de otros días", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { body } = await getResumen(tenantA.jwtAdmin);

    expect(body.data.turnosHoy).toBe(2);
  });

  it("estadiasHoy cuenta solo las vigentes que ocupan hoy", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { body } = await getResumen(tenantA.jwtAdmin);

    expect(body.data.estadiasHoy).toBe(1);
  });

  it("vacunasProximas30d cuenta solo dosis Pendiente dentro de la ventana", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { body } = await getResumen(tenantA.jwtAdmin);

    expect(body.data.vacunasProximas30d).toBe(1);
  });

  it("la fecha del resumen es el día de hoy", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtAdmin) return;

    const { body } = await getResumen(tenantA.jwtAdmin);

    expect(body.data.fecha).toBe(hoyISO());
  });
});

// ─── RN-S2: gate por permiso, con roles reales ────────────────────────────────

describeIntegration("Dashboard: RN-S2 — cada métrica exige el permiso de su endpoint dueño", () => {
  it("veterinario (sin manage_daycare) → esa métrica viene null", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtVet) return;

    const { status, body } = await getResumen(tenantA.jwtVet);

    expect(status).toBe(200);
    expect(body.data.estadiasHoy).toBeNull();
    // Lo que sí tiene el rol veterinario, incluido manage_clients (el Documento
    // Maestro lo lista como actor de la gestión de clientes).
    expect(body.data.clientes).toBe(ESPERADO_A.clientes);
    expect(body.data.mascotasActivas).toBe(ESPERADO_A.mascotasActivas);
    expect(body.data.turnosHoy).toBe(ESPERADO_A.turnosHoy);
    expect(body.data.vacunasProximas30d).toBe(ESPERADO_A.vacunasProximas30d);
  });

  it("un rol acotado NO recibe 403: el dashboard sirve el subconjunto visible", async () => {
    if (skipIfNoCredentials() || !tenantA?.jwtVet) return;

    const { status } = await getResumen(tenantA.jwtVet);

    expect(status).toBe(200);
  });
});

// ─── Regla 4: gate por módulo licenciado ──────────────────────────────────────

describeIntegration("Dashboard: licenciamiento por módulo (regla 4)", () => {
  it("tenant plan 'basico' (solo historial_clinico) → turnosHoy y estadiasHoy null", async () => {
    if (skipIfNoCredentials() || !tenantC?.jwtAdmin) return;

    const { status, body } = await getResumen(tenantC.jwtAdmin);

    expect(status).toBe(200);
    expect(body.data.turnosHoy).toBeNull();
    expect(body.data.estadiasHoy).toBeNull();
    // El módulo que sí tiene licenciado responde con un número (0, no null).
    expect(body.data.vacunasProximas30d).toBe(0);
    expect(body.data.clientes).toBe(1);
  });

  it("deshabilitar historial_clinico deja vacunasProximas30d en null sin afectar las métricas core", async () => {
    if (skipIfNoCredentials() || !tenantC?.jwtAdmin) return;

    await serviceDb.from("modulos_contratados")
      .update({ habilitado: false })
      .eq("tenant_id", tenantC.tenantId)
      .eq("modulo", "historial_clinico");

    try {
      const { body } = await getResumen(tenantC.jwtAdmin);

      expect(body.data.vacunasProximas30d).toBeNull();
      expect(body.data.clientes).toBe(1);
      expect(body.data.mascotasActivas).toBe(1);
    } finally {
      await serviceDb.from("modulos_contratados")
        .update({ habilitado: true })
        .eq("tenant_id", tenantC.tenantId)
        .eq("modulo", "historial_clinico");
    }
  });
});

// ─── RN-SA3: tenant suspendido ────────────────────────────────────────────────

describeIntegration("Dashboard: RN-SA3 — tenant suspendido", () => {
  it("tenant suspendido → 403 TENANT_SUSPENDED (no se sirven métricas)", async () => {
    if (skipIfNoCredentials() || !tenantC?.jwtAdmin) return;

    await serviceDb.from("tenants").update({ activo: false }).eq("id", tenantC.tenantId);

    try {
      const { status, body } = await getResumen(tenantC.jwtAdmin);

      expect(status).toBe(403);
      expect(body.error?.code).toBe("TENANT_SUSPENDED");
    } finally {
      await serviceDb.from("tenants").update({ activo: true }).eq("id", tenantC.tenantId);
    }
  });
});
