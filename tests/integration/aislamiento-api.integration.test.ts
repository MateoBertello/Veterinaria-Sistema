/**
 * BLOQUEANTE — Aislamiento por tenant EN EL CAMINO DE LA API.
 *
 * Por qué existe este archivo, además de `rls.test.ts`:
 *
 *   `rls.test.ts` consulta PostgREST directamente con el JWT de cada tenant, así
 *   que valida las POLÍTICAS RLS de la base. Es el camino que usa el frontend
 *   para los catálogos globales, pero NO es el camino por el que pasan los datos
 *   de negocio: 14 de los 17 Services abren la conexión con `getServiceDb()`
 *   (service role), que bypassea RLS por diseño. En ese camino el aislamiento no
 *   lo impone la base: lo impone que cada consulta escriba su
 *   `.eq("tenant_id", ctx.tenantId)`. Es disciplina, no una barrera.
 *
 *   El CLAUDE.md declara bloqueante desde la Etapa 1 el test de "un tenant no ve
 *   datos de otro". Hasta ahora ese test existía solo contra la capa DB. Esta
 *   suite lo ejerce contra la capa por la que realmente pasa la aplicación:
 *   HTTP → controller → service → DB, montando el app de Hono in-process y
 *   pegándole con el JWT del tenant B a los ids del tenant A.
 *
 * Qué afirma, para CADA entidad de negocio y por el camino real:
 *   1. LECTURA  — B no puede leer una entidad de A por su id (ni en el detalle
 *      ni en los listados).
 *   2. ESCRITURA — B no puede modificar, dar de baja ni cambiarle el estado a
 *      una entidad de A. Y no alcanza con el status de la respuesta: se compara
 *      un snapshot de las filas de A tomado con service role antes y después del
 *      intento. Un endpoint que respondiera 404 después de haber escrito seguiría
 *      siendo una fuga; acá se cae.
 *   3. Regresiones puntuales de las consultas sin `tenant_id` (hallazgo A3).
 *
 * Ambos tenants son `premium` (los tres módulos vendibles licenciados) y sus
 * usuarios son admin (todos los permisos): así el único control que puede
 * rechazar el pedido es el aislamiento, no `requireModule` ni `requirePermission`.
 * Un 403 MODULE_NOT_LICENSED daría un verde por el motivo equivocado.
 *
 * Requiere un Supabase real con TODAS las migraciones aplicadas y .env con
 * TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY.
 * Correr:  npx vitest run tests/integration/aislamiento-api.integration.test.ts
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { adminHeaders, borrarUsuarioAuth, crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de aislamiento por API omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? "";
}

/**
 * Limpia lo que haya quedado de una corrida anterior con ese email.
 *
 * El teardown puede no completarse (una corrida interrumpida, un assert que
 * corta antes) y GoTrue exige email único global: la cuenta huérfana hacía
 * fallar el alta de la corrida SIGUIENTE. Y como el alta fallaba devolviendo un
 * id vacío, el fixture quedaba a medias y los pedidos salían contra rutas como
 * `/historial/undefined`, que responden 500 — el test los contaba como
 * "rechazado" y daba verde por el motivo equivocado.
 *
 * Borrar la cuenta sola no alcanza: si su tenant sigue existiendo, la fila
 * espejo de `usuarios` la referencia y el DELETE de Auth se cae con un 23503.
 * Por eso se limpia primero el tenant entero.
 */
async function limpiarResiduosDe(email: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders() });
  const { users } = await res.json() as { users?: Array<{ id: string; email: string }> };
  const huerfanos = (users ?? []).filter((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());

  for (const u of huerfanos) {
    const { data: fila } = await serviceDb
      .from("usuarios").select("tenant_id").eq("id", u.id).maybeSingle();
    const tenantHuerfano = (fila as { tenant_id?: string } | null)?.tenant_id;
    if (tenantHuerfano) {
      await limpiarTenant(serviceDb, tenantHuerfano);
    } else {
      await borrarUsuarioAuth(u.id);
    }
  }
}

async function createAuthUser(email: string, appMetadata: Record<string, unknown>): Promise<string> {
  await limpiarResiduosDe(email);
  return crearUsuarioAuth(email, appMetadata);
}

/** Pega al app de Hono in-process: mismo camino HTTP → controller → service. */
async function callApp(path: string, opts: { method?: string; jwt?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  return app.request(`http://localhost/api/v1${path}`, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface TenantFixture {
  tenantId:   string;
  jwt:        string;
  userId:     string;
  rolAdminId: string;
  rolVetId:   string;
  clienteId:  string;
  clienteAltId: string;
  mascotaId:  string;
  servicioId: string;
  /** Servicio sin turnos propios: sirve para el guard RN-SV3 (hallazgo A3). */
  servicioLibreId: string;
  doctorId:   string;
  horarioId:  string;
  turnoId:    string;
  estadiaId:  string;
  eventoId:   string;
  planVacId:  string;
}

// Fechas futuras fijas: nada de `new Date()` para que la suite no dependa del día
// en que corre. DOW se deriva de la fecha para sembrar la franja del doctor.
const FECHA_TURNO   = "2099-11-30";
const DOW_TURNO     = new Date(`${FECHA_TURNO}T00:00:00Z`).getUTCDay();
const FECHA_ESTADIA = "2099-12-01";
const FECHA_VACUNA  = "2099-12-15";
// `marcarDosisAplicada` rechaza fechas futuras ANTES de mirar el tenant (la
// aplicación ya ocurrió). Con una fecha de 2099 el intento moría en esa
// validación y nunca llegaba al control de aislamiento — verde vacío. Ayer en
// UTC siempre está en el pasado, corra la suite el día que corra.
const AYER = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

let serviceDb: SupabaseClient;
let especieId    = "";
let tipoVacunaId = "";
let A: TenantFixture;
let B: TenantFixture;

/**
 * Aprovisiona un tenant `premium` (historial + turnos + guardería licenciados)
 * con su admin y una fila de CADA entidad de negocio. Todo se siembra con
 * service role: el sujeto de esta suite es el camino de LECTURA/ESCRITURA de la
 * API, no el de alta.
 */
async function provisionTenant(sufijo: string): Promise<TenantFixture> {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Aislamiento ${sufijo}`,
      cuit_rut:       `98-${Date.now().toString().slice(-7)}-${sufijo === "AISLA" ? 1 : 2}`,
      email_contacto: `aislamiento-${sufijo}@test.com`,
      plan:           "premium", // premium → historial + turnos + guardería
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const { data: roles } = await serviceDb
    .from("roles").select("id, name").eq("tenant_id", tenantId);
  const rolAdminId = (roles ?? []).find((r) => (r as { name: string }).name === "admin")?.id as string;
  const rolVetId   = (roles ?? []).find((r) => (r as { name: string }).name === "veterinario")?.id as string;

  const email  = `admin-aislamiento-${sufijo}@test.com`;
  const userId = await createAuthUser(email, { tenant_id: tenantId });
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_${sufijo.toLowerCase()}`,
    email, full_name: `Admin ${sufijo}`, rol_id: rolAdminId, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: clientes } = await serviceDb
    .from("clientes")
    .insert([
      { tenant_id: tenantId, full_name: `Dueño ${sufijo}`,     phone: "1112223334" },
      { tenant_id: tenantId, full_name: `Dueño alt ${sufijo}`, phone: "1112223335" },
    ])
    .select("id");
  const clienteId    = (clientes ?? [])[0]?.id as string;
  const clienteAltId = (clientes ?? [])[1]?.id as string;

  const { data: mascota } = await serviceDb
    .from("mascotas")
    .insert({
      tenant_id: tenantId, name: `Mascota ${sufijo}`, client_id: clienteId,
      especie_id: especieId, sex: "Macho", tamano: "Mediano",
    })
    .select("id").single();
  const mascotaId = mascota?.id as string;

  const { data: servicios } = await serviceDb
    .from("servicios")
    .insert([
      { tenant_id: tenantId, nombre: `Consulta ${sufijo}`, tipo: "clinica",
        duracion_minutos: 30, requiere_profesional: true },
      { tenant_id: tenantId, nombre: `Baño ${sufijo}`, tipo: "peluqueria",
        duracion_minutos: 30, requiere_profesional: false },
    ])
    .select("id");
  const servicioId      = (servicios ?? [])[0]?.id as string;
  const servicioLibreId = (servicios ?? [])[1]?.id as string;

  const { data: doctor } = await serviceDb
    .from("doctores")
    .insert({ tenant_id: tenantId, name: `Dr ${sufijo}`, specialty: "Clínica general", available: true })
    .select("id").single();
  const doctorId = doctor?.id as string;

  const { data: horario } = await serviceDb
    .from("horarios_doctor")
    .insert({
      tenant_id: tenantId, doctor_id: doctorId, day_of_week: DOW_TURNO,
      start_time: "09:00", end_time: "18:00", active: true,
    })
    .select("id").single();
  const horarioId = horario?.id as string;

  const { data: turno } = await serviceDb
    .from("turnos")
    .insert({
      tenant_id: tenantId, client_id: clienteId, pet_id: mascotaId,
      servicio_id: servicioId, doctor_id: doctorId, date: FECHA_TURNO,
      start_time: "10:00", end_time: "10:30", status: "Confirmado",
      reason: `Control ${sufijo}`,
    })
    .select("id").single();
  const turnoId = turno?.id as string;

  const { data: estadia } = await serviceDb
    .from("estadias")
    .insert({
      tenant_id: tenantId, client_id: clienteId, pet_id: mascotaId,
      check_in_date: FECHA_ESTADIA, check_out_date: FECHA_ESTADIA,
      status: "Reservada", reason: `Guardería ${sufijo}`,
    })
    .select("id").single();
  const estadiaId = estadia?.id as string;

  const { data: evento } = await serviceDb
    .from("historial_clinico")
    .insert({
      tenant_id: tenantId, pet_id: mascotaId, professional_id: userId,
      date: "2026-01-15", event_type: "Consulta",
      description: `Evento clínico de ${sufijo}`,
      client_id_at_time: clienteId, client_name_at_time: `Dueño ${sufijo}`,
    })
    .select("id").single();
  const eventoId = evento?.id as string;

  const { data: plan } = await serviceDb
    .from("plan_vacunacion")
    .insert({
      tenant_id: tenantId, pet_id: mascotaId, tipo_vacuna_id: tipoVacunaId,
      fecha_estimada: FECHA_VACUNA, estado: "Pendiente", notas: `Plan ${sufijo}`,
    })
    .select("id").single();
  const planVacId = plan?.id as string;

  const fixture: TenantFixture = {
    tenantId, jwt, userId, rolAdminId, rolVetId, clienteId, clienteAltId,
    mascotaId, servicioId, servicioLibreId, doctorId, horarioId, turnoId,
    estadiaId, eventoId, planVacId,
  };

  // Un id vacío no puede pasar en silencio: la URL queda como
  // `/turnos/undefined`, la API responde 404/500 por parsear mal el parámetro y
  // el test lo lee como "aislamiento OK". Sería un verde que no prueba NADA.
  const faltantes = Object.entries(fixture)
    .filter(([, v]) => typeof v !== "string" || v.length === 0)
    .map(([k]) => k);
  if (faltantes.length > 0) {
    throw new Error(`Fixture incompleto para el tenant ${sufijo}: ${faltantes.join(", ")}`);
  }

  return fixture;
}

beforeAll(async () => {
  if (skipIfNoCredentials()) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: especie } = await serviceDb.from("especies").select("id").limit(1).single();
  especieId = especie?.id ?? "";
  const { data: tipoVacuna } = await serviceDb.from("tipos_vacuna").select("id").limit(1).single();
  tipoVacunaId = tipoVacuna?.id ?? "";

  A = await provisionTenant("AISLA");
  B = await provisionTenant("AISLB");
}, 120_000);

// El borrado hijo → padre (`limpiarTenant`, en `./_teardown.ts`) es el mismo
// para todas las suites de integración — ver el porqué ahí. Esta suite es la
// que siembra TODAS las entidades a la vez, así que fue la primera en pegarle.
afterAll(async () => {
  if (!serviceDb) return;
  for (const t of [A, B]) await limpiarTenant(serviceDb, t?.tenantId);
});

// ─── Utilidades de aserción ───────────────────────────────────────────────────

/** Tablas de negocio del tenant A cuyo contenido no puede cambiar por un pedido de B. */
const TABLAS_SNAPSHOT = [
  "clientes", "mascotas", "servicios", "doctores", "horarios_doctor",
  "turnos", "estadias", "historial_clinico", "plan_vacunacion", "usuarios",
] as const;

/** Foto ordenada y estable de todas las filas de A, para comparar antes/después. */
async function snapshotTenant(tenantId: string): Promise<Record<string, string>> {
  const foto: Record<string, string> = {};
  for (const tabla of TABLAS_SNAPSHOT) {
    const { data } = await serviceDb.from(tabla).select("*").eq("tenant_id", tenantId).order("id");
    foto[tabla] = JSON.stringify(data ?? []);
  }
  return foto;
}

interface Intento {
  nombre: string;
  method: string;
  path:   string;
  body?:  unknown;
}

/**
 * Un pedido cross-tenant no puede resolver 2xx. Devuelve el código de error del
 * envelope para poder reportarlo junto al nombre del caso cuando falla.
 */
/**
 * El rechazo tiene que venir del AISLAMIENTO, no de otra cosa. Un verde por el
 * motivo equivocado es peor que un rojo:
 *   • 5xx  — algo explotó (por ejemplo un id mal armado en el propio fixture);
 *            el control de tenant ni siquiera llegó a correr.
 *   • MODULE_NOT_LICENSED — lo frenó `requireModule`, no el tenant. Ambos
 *            tenants son premium justamente para que esto no pueda pasar.
 *   • VALIDATION_ERROR — lo frenó Zod sobre el body, antes de tocar el Service.
 */
function verificarMotivo(intento: Intento, status: number, code: string): void {
  expect(status, `${intento.nombre}: respondió ${status} — el control de tenant no llegó a correr`)
    .toBeLessThan(500);
  expect(code, `${intento.nombre}: lo frenó la licencia del módulo, no el aislamiento`)
    .not.toBe("MODULE_NOT_LICENSED");
  expect(code, `${intento.nombre}: lo frenó la validación del body, no el aislamiento`)
    .not.toBe("VALIDATION_ERROR");
}

async function esperarRechazo(intento: Intento): Promise<{ status: number; code: string }> {
  const res  = await callApp(intento.path, { method: intento.method, jwt: B.jwt, body: intento.body });
  const body = await res.json().catch(() => ({})) as {
    success?: boolean;
    error?:   { code?: string };
  };
  return { status: res.status, code: body.error?.code ?? "" };
}

// ─── 1. LECTURA cross-tenant ──────────────────────────────────────────────────

describeIntegration("Aislamiento por API — LECTURA: B no lee entidades de A por id", () => {
  it("ningún GET al detalle de una entidad de A responde 2xx con el JWT de B", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const lecturas: Intento[] = [
      { nombre: "cliente",           method: "GET", path: `/clientes/${A.clienteId}` },
      { nombre: "mascota",           method: "GET", path: `/mascotas/${A.mascotaId}` },
      { nombre: "cambios de dueño",  method: "GET", path: `/mascotas/${A.mascotaId}/cambios-dueno` },
      { nombre: "historial mascota", method: "GET", path: `/mascotas/${A.mascotaId}/historial` },
      { nombre: "resumen clínico",   method: "GET", path: `/mascotas/${A.mascotaId}/resumen-clinico` },
      { nombre: "export historial",  method: "GET", path: `/mascotas/${A.mascotaId}/historial/export` },
      { nombre: "plan vacunación",   method: "GET", path: `/mascotas/${A.mascotaId}/plan-vacunacion` },
      { nombre: "evento clínico",    method: "GET", path: `/historial/${A.eventoId}` },
      { nombre: "turno",             method: "GET", path: `/turnos/${A.turnoId}` },
      { nombre: "servicio",          method: "GET", path: `/servicios/${A.servicioId}` },
      { nombre: "doctor",            method: "GET", path: `/doctores/${A.doctorId}` },
      { nombre: "horarios doctor",   method: "GET", path: `/doctores/${A.doctorId}/horarios` },
    ];

    const filtrados: string[] = [];
    for (const intento of lecturas) {
      const { status, code } = await esperarRechazo(intento);
      if (status < 400) filtrados.push(`${intento.nombre} → ${status}`);
      verificarMotivo(intento, status, code);
    }

    expect(filtrados, "entidades de A legibles con el JWT de B").toEqual([]);
  });

  it("los listados de B no contienen ninguna fila de A", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const listados: Array<{ nombre: string; path: string; idDeA: string }> = [
      { nombre: "clientes",  path: "/clientes?limit=100",  idDeA: A.clienteId },
      { nombre: "mascotas",  path: "/mascotas?limit=100",  idDeA: A.mascotaId },
      { nombre: "servicios", path: "/servicios?limit=100", idDeA: A.servicioId },
      { nombre: "doctores",  path: "/doctores?limit=100",  idDeA: A.doctorId },
      { nombre: "usuarios",  path: "/usuarios?limit=100",  idDeA: A.userId },
      { nombre: "turnos",    path: `/turnos?date=${FECHA_TURNO}`, idDeA: A.turnoId },
      {
        nombre: "estadías",
        path:   `/estadias?dateFrom=${FECHA_ESTADIA}&dateTo=${FECHA_ESTADIA}`,
        idDeA:  A.estadiaId,
      },
      { nombre: "auditoría", path: "/auditoria?limit=100", idDeA: A.tenantId },
      { nombre: "roles",     path: "/usuarios/roles",      idDeA: A.rolAdminId },
    ];

    for (const l of listados) {
      const res  = await callApp(l.path, { jwt: B.jwt });
      const body = await res.json() as { success: boolean; data?: unknown };
      expect(res.status, `${l.nombre}: el listado no respondió 200`).toBe(200);
      // Búsqueda del id de A en el JSON crudo: alcanza y sobra, y no depende
      // de la forma del DTO de cada módulo.
      expect(
        JSON.stringify(body.data ?? []).includes(l.idDeA),
        `${l.nombre}: el listado de B contiene datos de A`,
      ).toBe(false);
    }
  });

  it("los slots de agenda de B no se calculan contra el doctor ni el servicio de A", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const res = await callApp(
      `/turnos/slots?doctorId=${A.doctorId}&servicioId=${A.servicioId}&date=${FECHA_TURNO}`,
      { jwt: B.jwt },
    );
    expect(res.status).not.toBe(200);
  });
});

// ─── 2. ESCRITURA cross-tenant ────────────────────────────────────────────────

describeIntegration("Aislamiento por API — ESCRITURA: B no modifica entidades de A", () => {
  it("ninguna escritura de B sobre una entidad de A prospera, y las filas de A quedan intactas", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const antes = await snapshotTenant(A.tenantId);

    const escrituras: Intento[] = [
      { nombre: "editar cliente",   method: "PUT",    path: `/clientes/${A.clienteId}`,
        body: { fullName: "Secuestrado por B" } },
      { nombre: "borrar cliente",   method: "DELETE", path: `/clientes/${A.clienteId}` },

      { nombre: "editar mascota",   method: "PUT",    path: `/mascotas/${A.mascotaId}`,
        body: { name: "Secuestrada por B" } },
      { nombre: "borrar mascota",   method: "DELETE", path: `/mascotas/${A.mascotaId}` },
      { nombre: "marcar fallecida", method: "POST",   path: `/mascotas/${A.mascotaId}/fallecimiento`,
        body: { deceasedReason: "Intruso", deceasedDate: "2026-06-10" } },
      { nombre: "cambiar dueño",    method: "POST",   path: `/mascotas/${A.mascotaId}/cambio-dueno`,
        body: { newClientId: B.clienteId, reason: "Intruso" } },
      // Mismo pedido pero con un destino VÁLIDO dentro de A: descarta que el
      // rechazo anterior venga del chequeo del cliente destino en vez del
      // aislamiento sobre la mascota.
      { nombre: "cambiar dueño (destino de A)", method: "POST", path: `/mascotas/${A.mascotaId}/cambio-dueno`,
        body: { newClientId: A.clienteAltId, reason: "Intruso" } },

      { nombre: "crear evento clínico", method: "POST", path: `/mascotas/${A.mascotaId}/historial`,
        body: { date: "2026-02-01", eventType: "Consulta", professionalId: B.userId,
                description: "Evento inyectado por B" } },
      { nombre: "eutanasia",            method: "POST", path: `/mascotas/${A.mascotaId}/eutanasia`,
        body: { date: "2026-02-01", professionalId: B.userId, description: "Intruso",
                euthanasiaConfirmed: true } },

      { nombre: "crear dosis",     method: "POST",  path: `/mascotas/${A.mascotaId}/plan-vacunacion`,
        body: { tipoVacunaId, fechaEstimada: FECHA_VACUNA, notas: "Inyectada por B" } },
      { nombre: "editar dosis",    method: "PUT",   path: `/plan-vacunacion/${A.planVacId}`,
        body: { fechaEstimada: "2099-12-20", notas: "Editada por B" } },
      { nombre: "cancelar dosis",  method: "PATCH", path: `/plan-vacunacion/${A.planVacId}/cancelar`,
        body: { notas: "Cancelada por B" } },
      { nombre: "aplicar dosis",   method: "PATCH", path: `/plan-vacunacion/${A.planVacId}/aplicar`,
        body: { professionalId: B.userId, date: AYER } },

      { nombre: "editar servicio", method: "PUT",   path: `/servicios/${A.servicioId}`,
        body: { nombre: "Servicio de B", tipo: "clinica", duracionMinutos: 45,
                requiereProfesional: true } },
      { nombre: "desactivar servicio", method: "PATCH", path: `/servicios/${A.servicioId}/estado`,
        body: { activo: false } },

      { nombre: "editar turno",    method: "PUT",   path: `/turnos/${A.turnoId}`,
        body: { reason: "Reagendado por B" } },
      { nombre: "cancelar turno",  method: "PATCH", path: `/turnos/${A.turnoId}/cancelar`,
        body: { cancellationReason: "Cancelado por B" } },
      { nombre: "cambiar estado turno", method: "PATCH", path: `/turnos/${A.turnoId}/estado`,
        body: { status: "Completado" } },
      { nombre: "borrar turno",    method: "DELETE", path: `/turnos/${A.turnoId}` },

      { nombre: "editar estadía",   method: "PUT",   path: `/estadias/${A.estadiaId}`,
        body: { reason: "Editada por B" } },
      { nombre: "check-in estadía", method: "PATCH", path: `/estadias/${A.estadiaId}/checkin` },
      { nombre: "check-out estadía", method: "PATCH", path: `/estadias/${A.estadiaId}/checkout` },
      { nombre: "cancelar estadía", method: "PATCH", path: `/estadias/${A.estadiaId}/cancelar`,
        body: { cancellationReason: "Cancelada por B" } },

      { nombre: "editar doctor",   method: "PATCH",  path: `/doctores/${A.doctorId}`,
        body: { available: false } },
      { nombre: "crear franja",    method: "POST",   path: `/doctores/${A.doctorId}/horarios`,
        body: { dayOfWeek: 1, startTime: "08:00", endTime: "09:00" } },
      { nombre: "editar franja",   method: "PATCH",  path: `/horarios/${A.horarioId}`,
        body: { active: false } },
      { nombre: "borrar franja",   method: "DELETE", path: `/horarios/${A.horarioId}` },

      { nombre: "editar usuario",  method: "PUT",    path: `/usuarios/${A.userId}`,
        body: { fullName: "Renombrado por B" } },
    ];

    const prosperaron: string[] = [];
    for (const intento of escrituras) {
      const { status, code } = await esperarRechazo(intento);
      if (status < 400) prosperaron.push(`${intento.nombre} → ${status}`);
      verificarMotivo(intento, status, code);
    }

    // El snapshot se compara PRIMERO: el status no alcanza como prueba. Un
    // endpoint que escribiera y DESPUÉS respondiera 404 seguiría siendo una
    // fuga, y es el caso que más fácil se pasa por alto. Si además el status
    // filtró, lo reporta el assert siguiente.
    const despues = await snapshotTenant(A.tenantId);
    for (const tabla of TABLAS_SNAPSHOT) {
      expect(despues[tabla], `los pedidos de B modificaron \`${tabla}\` del tenant A`)
        .toBe(antes[tabla]);
    }

    expect(prosperaron, "escrituras de B que la API aceptó sobre datos de A").toEqual([]);
  }, 120_000);

  it("B no puede asignarle a su propio usuario un rol de A (escalada cross-tenant)", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    // `usuarios.rol_id` referencia `roles(id)` a secas — sin el tenant en la FK,
    // el id de un rol ajeno entraba sin error. Como los permisos se resuelven
    // desde el rol, era un camino de escalada. Ver A3 en usuarios.service.ts.
    const res = await callApp(`/usuarios/${B.userId}`, {
      method: "PUT", jwt: B.jwt, body: { roleId: A.rolVetId },
    });
    const body = await res.json() as { error?: { code?: string } };

    expect(res.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_ERROR");

    const { data: usuario } = await serviceDb
      .from("usuarios").select("rol_id").eq("id", B.userId).single();
    expect((usuario as { rol_id: string }).rol_id).toBe(B.rolAdminId);
  });
});

// ─── 3. Regresiones del hallazgo A3 (consultas sin filtro de tenant) ──────────

describeIntegration("A3 — consultas con service role que no filtraban por tenant", () => {
  it("RN-SV3: un turno futuro de B no bloquea la baja del servicio de A", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    // `turnos.servicio_id` referencia `servicios(id)` sin el tenant en la FK, así
    // que un turno de B puede apuntar a un servicio de A. El guard corría con
    // service role y contaba turnos de TODAS las clínicas: el turno de B
    // bloqueaba la baja del servicio de A (y confirmaba su existencia de rebote).
    const { error: insertError } = await serviceDb.from("turnos").insert({
      tenant_id: B.tenantId, client_id: B.clienteId, pet_id: B.mascotaId,
      servicio_id: A.servicioLibreId, doctor_id: null, date: FECHA_TURNO,
      start_time: "15:00", end_time: "15:30", status: "Confirmado",
      reason: "Turno de B contra un servicio de A",
    });
    expect(insertError, "no se pudo sembrar el turno cruzado").toBeNull();

    const res = await callApp(`/servicios/${A.servicioLibreId}/estado`, {
      method: "PATCH", jwt: A.jwt, body: { activo: false },
    });
    const body = await res.json() as { success: boolean; data?: { activo: boolean } };

    expect(res.status, "el turno de otra clínica bloqueó la baja").toBe(200);
    expect(body.data?.activo).toBe(false);
  });

  it("RN-SEC6: el rol que decide LAST_ADMIN se lee del propio tenant", async () => {
    if (skipIfNoCredentials() || !A?.jwt) return;

    // La lectura del rol actual corría sin `tenant_id`. Con `roles` siendo una
    // tabla POR TENANT (UNIQUE (tenant_id, name)), el nombre podía venir de otra
    // clínica y decidir mal si aplicaba la protección del último admin.
    // A tiene un solo admin activo: desactivarlo tiene que dar LAST_ADMIN.
    const res = await callApp(`/usuarios/${A.userId}`, {
      method: "PUT", jwt: A.jwt, body: { active: false },
    });
    const body = await res.json() as { error?: { code?: string } };

    expect(res.status).toBe(409);
    expect(body.error?.code).toBe("LAST_ADMIN");
  });

  it("recuperar usuario con un email repetido en dos tenants no rompe (no 500)", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    // La unicidad del esquema es UNIQUE (tenant_id, email): dos clínicas pueden
    // tener filas con el mismo email. Lo que hoy lo evita es GoTrue, no la
    // tabla. Con `.single()`, PostgREST devolvía error ante dos filas y el
    // pedido se descartaba en silencio — la forma del bug DT-19 del login.
    const emailCompartido = `homonimo-aislamiento@test.com`;
    const userExtraId = await createAuthUser(`otro-${emailCompartido}`, { tenant_id: B.tenantId });
    await serviceDb.from("usuarios").insert({
      id: userExtraId, tenant_id: B.tenantId, username: "homonimo_b",
      email: emailCompartido, full_name: "Homónimo B", rol_id: B.rolAdminId, active: true,
    });
    await serviceDb.from("usuarios").update({ email: emailCompartido }).eq("id", A.userId);

    const res = await callApp("/auth/recuperar-usuario", {
      method: "POST", body: { email: emailCompartido },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
