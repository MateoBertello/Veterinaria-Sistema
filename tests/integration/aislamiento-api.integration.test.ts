/**
 * BLOQUEANTE — Aislamiento por tenant EN EL CAMINO DE LA API.
 *
 * Por qué existe este archivo, además de `rls.test.ts`:
 *
 *   `rls.test.ts` consulta PostgREST directamente con el JWT de cada tenant, así
 *   que valida las POLÍTICAS RLS de la base. Es el camino que usa el frontend
 *   para los catálogos clínicos, pero NO es el camino por el que pasan los datos
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
 *   4. CATÁLOGOS CLÍNICOS (especies, razas, tipos_vacuna): por tenant desde
 *      20260827000001_catalogos_por_tenant.sql. Todavía no tienen endpoints
 *      propios, así que se ejercen por los dos caminos que existen hoy — la
 *      lectura por PostgREST directo del frontend y los endpoints que consumen
 *      un id de catálogo en el body (alta de mascota, alta de dosis).
 *   5. INTEGRIDAD EN LA BASE: que las FK compuestas (especie_id, tenant_id) y
 *      compañía frenen el cruce aunque se saltee el Service — el aislamiento
 *      deja de depender solo de la disciplina del `.eq("tenant_id", ...)`.
 *   6. Que una clínica recién creada nazca con catálogo utilizable: el seed se
 *      mudó de global a por-tenant, y si esa mudanza falla el síntoma es una
 *      clínica que no puede registrar su primera mascota.
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
import { adminHeaders, borrarUsuarioAuth, catalogoDelTenant, crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

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
  /** Catálogo clínico propio (20260827000001_catalogos_por_tenant.sql). */
  especieId:     string;
  razaId:        string;
  tipoVacunaId:  string;
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

  // Catálogo clínico DE ESTA CLÍNICA. Antes se tomaba "la primera especie que
  // aparezca" en el catálogo global; hoy eso elegiría la de otro tenant y el
  // INSERT de la mascota moriría en la FK compuesta (especie_id, tenant_id).
  const catalogo = await catalogoDelTenant(serviceDb, tenantId);

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
      especie_id: catalogo.especieId, sex: "Macho", tamano: "Mediano",
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
      tenant_id: tenantId, pet_id: mascotaId, tipo_vacuna_id: catalogo.tipoVacunaId,
      fecha_estimada: FECHA_VACUNA, estado: "Pendiente", notas: `Plan ${sufijo}`,
    })
    .select("id").single();
  const planVacId = plan?.id as string;

  const fixture: TenantFixture = {
    tenantId, jwt, userId, rolAdminId, rolVetId, clienteId, clienteAltId,
    mascotaId, servicioId, servicioLibreId, doctorId, horarioId, turnoId,
    estadiaId, eventoId, planVacId, ...catalogo,
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
  // Catálogos clínicos: entidades de negocio del tenant desde
  // 20260827000001_catalogos_por_tenant.sql, así que entran a la matriz.
  "especies", "razas", "tipos_vacuna",
  // Qué vacuna aplica a qué especie (20260828000001_vacunas_por_especie.sql).
  // Entra por la misma regla del CLAUDE.md: toda entidad de negocio nueva se
  // suma acá. Y no es cosmético — de esta tabla depende qué se le puede
  // inyectar a un animal, así que una escritura cruzada no es solo un dato
  // ajeno: habilita una vacuna equivocada en la clínica de al lado.
  "especie_tipo_vacuna",
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
        body: { tipoVacunaId: B.tipoVacunaId, fechaEstimada: FECHA_VACUNA, notas: "Inyectada por B" } },
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
    const emailAux = `aux-b-${Date.now()}@test.com`;
    const userAuxId = await createAuthUser(emailAux, { tenant_id: B.tenantId });
    await serviceDb.from("usuarios").insert({
      id: userAuxId, tenant_id: B.tenantId, username: `aux_b_${Date.now()}`,
      email: emailAux, full_name: "Aux B", rol_id: B.rolVetId, active: true,
    });

    const res = await callApp(`/usuarios/${userAuxId}`, {
      method: "PUT", jwt: B.jwt, body: { roleId: A.rolVetId },
    });
    const body = await res.json() as { error?: { code?: string } };

    expect(res.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_ERROR");

    const { data: usuario } = await serviceDb
      .from("usuarios").select("rol_id").eq("id", userAuxId).single();
    expect((usuario as { rol_id: string }).rol_id).toBe(B.rolVetId);
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
    // Usamos otro usuario con manage_users para que no lo intercepte RN-SEC8 (auto-desactivación).
    const emailVet = `vet-admin-test-${Date.now()}@test.com`;
    const userVetId = await createAuthUser(emailVet, { tenant_id: A.tenantId });
    await serviceDb.from("usuarios").insert({
      id: userVetId, tenant_id: A.tenantId, username: `vet_${Date.now()}`,
      email: emailVet, full_name: "Vet Test", rol_id: A.rolVetId, active: true,
    });
    const { data: permManageUsers } = await serviceDb
      .from("permisos").select("id").eq("name", "manage_users").single();
    if (permManageUsers) {
      try {
        await serviceDb.from("rol_permiso").insert({
          rol_id: A.rolVetId, permiso_id: (permManageUsers as { id: string }).id,
        });
      } catch {
        // ignore duplicate
      }
    }
    const jwtVet = await signIn(emailVet, "TestPass123!");

    const res = await callApp(`/usuarios/${A.userId}`, {
      method: "PUT", jwt: jwtVet, body: { active: false },
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


// ─── 4. CATÁLOGOS CLÍNICOS POR TENANT ─────────────────────────────────────────
//
// `especies`, `razas` y `tipos_vacuna` dejaron de ser globales en
// 20260827000001_catalogos_por_tenant.sql: son entidades del tenant y entran a
// esta matriz como cualquier otra. Con una diferencia: todavía no tienen
// endpoints propios (el CRUD va en el PR siguiente), así que el aislamiento se
// ejerce por los dos caminos que HOY existen — la lectura por PostgREST directo
// del frontend, y los endpoints que CONSUMEN un id de catálogo en el body.

describeIntegration("Aislamiento por API — CATÁLOGOS: B no ve ni usa el catálogo de A", () => {
  it("por PostgREST directo, B solo ve su propio catálogo", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const dbB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${B.jwt}` } },
      auth:   { persistSession: false },
    });

    for (const tabla of ["especies", "razas", "tipos_vacuna"] as const) {
      const { data, error } = await dbB.from(tabla).select("id, tenant_id");
      expect(error, `${tabla}: la lectura del propio catálogo no debería fallar`).toBeNull();
      expect((data ?? []).length, `${tabla}: B nace sin catálogo`).toBeGreaterThan(0);
      expect(
        (data ?? []).every((f: { tenant_id: string }) => f.tenant_id === B.tenantId),
        `${tabla}: B ve filas del catálogo de otra clínica`,
      ).toBe(true);
    }

    // Y pedir por id una fila de A tampoco la devuelve.
    const { data: espDeA } = await dbB.from("especies").select("id").eq("id", A.especieId);
    expect(espDeA ?? []).toHaveLength(0);
  });

  it("B no puede crear una mascota con una especie ni una raza de A", async () => {
    if (skipIfNoCredentials() || !B?.jwt) return;

    const antes = await snapshotTenant(B.tenantId);

    const intentos: Intento[] = [
      {
        nombre: "mascota con especie de A",
        method: "POST",
        path:   "/mascotas",
        body:   { name: "EspecieAjena", clientId: B.clienteId, especieId: A.especieId,
                  sex: "Macho", tamano: "Mediano" },
      },
      {
        nombre: "mascota con raza de A",
        method: "POST",
        path:   "/mascotas",
        body:   { name: "RazaAjena", clientId: B.clienteId, especieId: B.especieId,
                  razaId: A.razaId, sex: "Macho", tamano: "Mediano" },
      },
    ];

    for (const intento of intentos) {
      const res = await callApp(intento.path, { method: intento.method, jwt: B.jwt, body: intento.body });
      const body = await res.json().catch(() => ({})) as { error?: { code?: string } };

      // Rechazado — y por el motivo correcto: un 500 significaría que el pedido
      // llegó hasta la FK de la base y explotó ahí, no que el Service lo frenó.
      expect(res.status, `${intento.nombre}: respondió ${res.status}`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${intento.nombre}: llegó hasta la base y reventó`).toBeLessThan(500);
      expect(body.error?.code).toBe("VALIDATION_ERROR");
    }

    expect(await snapshotTenant(B.tenantId)).toEqual(antes);
  });

  it("B no puede programar una dosis con un tipo de vacuna de A", async () => {
    if (skipIfNoCredentials() || !B?.jwt) return;

    const antes = await snapshotTenant(B.tenantId);

    const res = await callApp(`/mascotas/${B.mascotaId}/plan-vacunacion`, {
      method: "POST", jwt: B.jwt,
      body:   { tipoVacunaId: A.tipoVacunaId, fechaEstimada: FECHA_VACUNA },
    });
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status, "llegó hasta la FK de la base en vez de frenarse en el Service").toBeLessThan(500);
    expect(body.error?.code).toBe("VACCINE_TYPE_NOT_FOUND");

    expect(await snapshotTenant(B.tenantId)).toEqual(antes);
  });
});

// ─── 4-bis. CATÁLOGOS POR LA API (ya tienen endpoints propios) ────────────────
//
// La etapa "Gestión de catálogos por clínica" les dio CRUD bajo /api/v1. El
// CLAUDE.md exige que toda entidad de negocio nueva entre a esta matriz, así que
// se ejercen los dos lados: que B no LEA el catálogo de A en los listados, y que
// no pueda ESCRIBIRLO por id. Los tres catálogos ya estaban en TABLAS_SNAPSHOT,
// de modo que cualquier escritura que se colara rompe la comparación de la foto.

describeIntegration("Aislamiento por API — CATÁLOGOS: los endpoints de gestión", () => {
  it("los listados de catálogo de B no traen ninguna fila de A", async () => {
    if (skipIfNoCredentials() || !B?.jwt) return;

    const listados: Array<{ nombre: string; path: string; idDeA: string }> = [
      { nombre: "especies",      path: "/especies?limit=100",     idDeA: A.especieId },
      { nombre: "razas",         path: "/razas?limit=100",        idDeA: A.razaId },
      { nombre: "tipos-vacuna",  path: "/tipos-vacuna?limit=100", idDeA: A.tipoVacunaId },
    ];

    for (const l of listados) {
      const res  = await callApp(l.path, { jwt: B.jwt });
      const body = await res.json() as { data?: Array<{ id: string }> };

      expect(res.status, `${l.nombre}: respondió ${res.status}`).toBe(200);
      // B tiene catálogo propio: una lista vacía sería un verde vacío.
      expect((body.data ?? []).length, `${l.nombre}: B no ve ni su propio catálogo`).toBeGreaterThan(0);
      expect(
        (body.data ?? []).some((f) => f.id === l.idDeA),
        `${l.nombre}: el listado de B contiene una fila de A`,
      ).toBe(false);
    }
  });

  it("B no puede editar ni dar de baja el catálogo de A (y la foto de A no cambia)", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const antes = await snapshotTenant(A.tenantId);

    const intentos: Intento[] = [
      { nombre: "editar especie de A", method: "PUT", path: `/especies/${A.especieId}`,
        body: { name: "Secuestrada por B" } },
      { nombre: "dar de baja especie de A", method: "PATCH", path: `/especies/${A.especieId}/estado`,
        body: { active: false } },

      { nombre: "editar raza de A", method: "PUT", path: `/razas/${A.razaId}`,
        body: { name: "Secuestrada por B" } },
      { nombre: "dar de baja raza de A", method: "PATCH", path: `/razas/${A.razaId}/estado`,
        body: { active: false } },
      // Reasignar una raza de A a una especie de B: cruza los dos tenants de una
      // sola vez, que es el caso que una FK simple no habría frenado nunca.
      { nombre: "mudar raza de A a una especie de B", method: "PUT", path: `/razas/${A.razaId}`,
        body: { especieId: B.especieId } },

      { nombre: "editar tipo de vacuna de A", method: "PUT", path: `/tipos-vacuna/${A.tipoVacunaId}`,
        body: { nombre: "Secuestrado por B" } },
      { nombre: "dar de baja tipo de vacuna de A", method: "PATCH", path: `/tipos-vacuna/${A.tipoVacunaId}/estado`,
        body: { active: false } },
    ];

    const filtrados: string[] = [];
    for (const intento of intentos) {
      const { status, code } = await esperarRechazo(intento);
      if (status < 400) filtrados.push(`${intento.nombre} → ${status}`);
      verificarMotivo(intento, status, code);
    }

    expect(filtrados, "escrituras de B que llegaron al catálogo de A").toEqual([]);
    expect(await snapshotTenant(A.tenantId)).toEqual(antes);
  });

  it("B SÍ puede administrar su propio catálogo (descarta un verde por permisos)", async () => {
    if (skipIfNoCredentials() || !B?.jwt) return;

    // Sin este caso, los dos de arriba darían verde aunque el endpoint estuviera
    // roto para todo el mundo: lo que se quiere probar es que rechaza POR EL
    // TENANT, no que rechaza siempre.
    const res = await callApp("/especies", {
      method: "POST", jwt: B.jwt,
      body:   { name: `Hurón ${Date.now().toString().slice(-6)}` },
    });
    const body = await res.json() as { data?: { id: string; active: boolean } };

    expect(res.status, "B no puede crear en su propio catálogo").toBe(201);
    expect(body.data?.active).toBe(true);

    // Y nace en SU tenant, no en el de nadie más.
    const { data: fila } = await serviceDb
      .from("especies").select("tenant_id").eq("id", body.data!.id).single();
    expect((fila as { tenant_id: string }).tenant_id).toBe(B.tenantId);
  });
});

// ─── 5. INTEGRIDAD CROSS-TENANT EN LA BASE ────────────────────────────────────
//
// Los tests de arriba prueban que el Service rechaza el catálogo ajeno. Este
// prueba algo distinto y más fuerte: que aunque alguien se saltee el Service
// —service role, un script, una RPC futura, un refactor que se olvide la
// validación— la BASE lo sigue frenando. Es lo que compran las FK compuestas
// (especie_id, tenant_id) / (raza_id, tenant_id) / (tipo_vacuna_id, tenant_id)
// de 20260827000001_catalogos_por_tenant.sql, y es la parte del PR que no se
// puede rehacer barato una vez que haya clínicas cargadas.

describeIntegration("Integridad cross-tenant en la BASE (FK compuestas, no solo el Service)", () => {
  it("insertar con service role una mascota de A con la especie de B falla en la base", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data, error } = await serviceDb
      .from("mascotas")
      .insert({
        tenant_id: A.tenantId, name: "EspecieDeB", client_id: A.clienteId,
        especie_id: B.especieId, sex: "Macho", tamano: "Mediano",
      })
      .select("id");

    expect(error, "la FK compuesta no frenó la especie de otro tenant").not.toBeNull();
    // 23503 = foreign_key_violation. El aislamiento lo impuso la BASE.
    expect(error?.code).toBe("23503");
    expect(data ?? []).toHaveLength(0);
  });

  it("insertar con service role una mascota de A con la raza de B falla en la base", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { error } = await serviceDb
      .from("mascotas")
      .insert({
        tenant_id: A.tenantId, name: "RazaDeB", client_id: A.clienteId,
        especie_id: A.especieId, raza_id: B.razaId, sex: "Macho", tamano: "Mediano",
      })
      .select("id");

    expect(error?.code).toBe("23503");
  });

  it("insertar con service role una dosis de A con el tipo de vacuna de B falla en la base", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { error } = await serviceDb
      .from("plan_vacunacion")
      .insert({
        tenant_id: A.tenantId, pet_id: A.mascotaId, tipo_vacuna_id: B.tipoVacunaId,
        fecha_estimada: FECHA_VACUNA, estado: "Pendiente",
      })
      .select("id");

    expect(error?.code).toBe("23503");
  });

  it("una raza no puede colgar de una especie de otro tenant", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { error } = await serviceDb
      .from("razas")
      .insert({ tenant_id: A.tenantId, especie_id: B.especieId, name: "RazaImposible" })
      .select("id");

    expect(error?.code).toBe("23503");
  });

  // `especie_tipo_vacuna` es el caso donde esto más importa, porque sus DOS FKs
  // comparten la misma columna `tenant_id`: eso es lo que vuelve
  // IRREPRESENTABLE una fila que una la especie de una clínica con la vacuna de
  // otra. No hay orden de inserción ni service role que la produzca.

  it("no se puede asociar la especie de A con un tipo de vacuna de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { error } = await serviceDb
      .from("especie_tipo_vacuna")
      .insert({ tenant_id: A.tenantId, especie_id: A.especieId, tipo_vacuna_id: B.tipoVacunaId })
      .select("tenant_id");

    expect(error?.code, "la FK compuesta dejó pasar una vacuna de otra clínica").toBe("23503");
  });

  it("no se puede asociar la especie de B con un tipo de vacuna de A", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    // El espejo del anterior: da igual cuál de los dos lados sea el ajeno,
    // porque las dos constraints leen la MISMA columna tenant_id.
    const { error } = await serviceDb
      .from("especie_tipo_vacuna")
      .insert({ tenant_id: A.tenantId, especie_id: B.especieId, tipo_vacuna_id: A.tipoVacunaId })
      .select("tenant_id");

    expect(error?.code).toBe("23503");
  });

  it("tampoco poniéndole a la fila el tenant de la otra clínica", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    // El intento "astuto": mentir con el tenant_id de la fila para que cierre
    // con uno de los dos padres. Falla igual, porque el otro deja de cerrar.
    const { error } = await serviceDb
      .from("especie_tipo_vacuna")
      .insert({ tenant_id: B.tenantId, especie_id: A.especieId, tipo_vacuna_id: B.tipoVacunaId })
      .select("tenant_id");

    expect(error?.code).toBe("23503");
  });

  // ── Módulo comercial: FK compuestas (RN-SC2) ───────────────────────────

  it("RN-SC2: un producto de A no puede colgar de una familia de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    // Familia en B
    const { data: famB } = await serviceDb.from("familias_producto").insert({
      tenant_id: B.tenantId, nombre: `Fam B ${Date.now()}`, unidad_base_id: unidadId,
    }).select("id").single();

    // Intentar insertar producto en A apuntando a la familia de B
    const { error } = await serviceDb.from("productos").insert({
      tenant_id: A.tenantId,
      codigo: `PROD-CROSS-${Date.now()}`,
      nombre: "Producto Cross A-B",
      familia_id: famB?.id,
      unidad_medida_id: unidadId,
    });

    expect(error, "la FK compuesta debió rechazar la familia de otro tenant").not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("RN-SC2: un proveedor de A no puede apuntar a un cliente de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { error } = await serviceDb.from("proveedores").insert({
      tenant_id: A.tenantId,
      razon_social: `Proveedor Cross ${Date.now()}`,
      cliente_id: B.clienteId,
    });

    expect(error, "la FK compuesta debió rechazar el cliente de otro tenant").not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("RN-SC2: una conversión de A no puede referenciar un producto de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const { data: prodA } = await serviceDb.from("productos").insert({
      tenant_id: A.tenantId, codigo: `CONV-ORIGEN-${Date.now()}`, nombre: "Prod Conv A", unidad_medida_id: unidadId,
    }).select("id").single();

    const { data: prodB } = await serviceDb.from("productos").insert({
      tenant_id: B.tenantId, codigo: `CONV-DESTINO-${Date.now()}`, nombre: "Prod Conv B", unidad_medida_id: unidadId,
    }).select("id").single();

    const { error } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: A.tenantId,
      producto_origen_id: prodA?.id,
      producto_destino_id: prodB?.id,
      factor_teorico: 10,
    });

    expect(error, "la FK compuesta debió rechazar el producto de otro tenant").not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("RN-SC2: tampoco poniéndole a la fila el tenant de la otra clínica", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const { data: prodA } = await serviceDb.from("productos").insert({
      tenant_id: A.tenantId, codigo: `CONV-ORIGEN-2-${Date.now()}`, nombre: "Prod Conv A 2", unidad_medida_id: unidadId,
    }).select("id").single();

    const { data: prodB } = await serviceDb.from("productos").insert({
      tenant_id: B.tenantId, codigo: `CONV-DESTINO-2-${Date.now()}`, nombre: "Prod Conv B 2", unidad_medida_id: unidadId,
    }).select("id").single();

    // Intentar mentir con tenant_id = B: producto_origen_id pertenece a A, por lo que la FK falla
    const { error } = await serviceDb.from("producto_conversiones").insert({
      tenant_id: B.tenantId,
      producto_origen_id: prodA?.id,
      producto_destino_id: prodB?.id,
      factor_teorico: 10,
    });

    expect(error?.code).toBe("23503");
  });
});

// ─── 6. UNA CLÍNICA NUEVA NACE UTILIZABLE ─────────────────────────────────────
//
// El catálogo semilla se mudó de `seed_global.sql` (una vez, para todos) a
// `on_tenant_created` (una vez por clínica). Si esa mudanza fallara, el síntoma
// no sería un error de esquema: sería una clínica nueva que no puede registrar
// su primera mascota porque no hay ninguna especie para elegir. Este test
// recorre exactamente ese camino, sin ningún paso manual de por medio.

describeIntegration("Un tenant recién creado nace con catálogo utilizable", () => {
  it("alta de tenant → catálogo visible por PostgREST → POST /mascotas, sin pasos manuales", async () => {
    if (skipIfNoCredentials()) return;

    const sufijo = `NUEVO${Date.now().toString().slice(-6)}`;
    let tenantId = "";

    try {
      const { data: tenant } = await serviceDb
        .from("tenants")
        .insert({
          nombre:         `Clínica Recién Creada ${sufijo}`,
          cuit_rut:       `97-${Date.now().toString().slice(-7)}-3`,
          email_contacto: `nueva-${sufijo}@test.com`,
          plan:           "basico",
        })
        .select("id")
        .single();
      tenantId = tenant?.id as string;

      // Único aprovisionamiento: el que hace el alta real de una clínica.
      await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

      const email  = `admin-${sufijo}@test.com`;
      const userId = await createAuthUser(email, { tenant_id: tenantId });
      const { data: rolAdmin } = await serviceDb
        .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
      await serviceDb.from("usuarios").insert({
        id: userId, tenant_id: tenantId, username: `admin_${sufijo.toLowerCase()}`,
        email, full_name: `Admin ${sufijo}`, rol_id: rolAdmin?.id, active: true,
      });
      const jwt = await signIn(email, "TestPass123!");

      // El frontend lee el catálogo por PostgREST directo: ese es el camino real.
      const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth:   { persistSession: false },
      });
      const { data: especies } = await db.from("especies").select("id, name").order("name");
      expect(especies ?? [], "la clínica nueva nace sin especies para elegir").not.toHaveLength(0);

      const especieId = (especies ?? [])[0]?.id as string;
      const { data: razas } = await db.from("razas").select("id").eq("especie_id", especieId);
      expect(razas ?? [], "la especie elegida no tiene ninguna raza cargada").not.toHaveLength(0);

      // Y con eso alcanza para dar de alta el primer paciente.
      const resCliente = await callApp("/clientes", {
        method: "POST", jwt,
        // RN-CL1: dniCuit y address son obligatorios; sin ellos el alta muere en
        // Zod con 422 y el test fallaría por el fixture, no por el catálogo.
        body: {
          fullName: "Primer Dueño",
          dniCuit:  `20-${Date.now().toString().slice(-8)}-4`,
          phone:    "1122334455",
          address:  "Av. Siempreviva 742",
        },
      });
      const bodyCliente = await resCliente.json() as { data?: { id: string }; error?: unknown };
      expect(
        resCliente.status,
        `POST /clientes respondió ${resCliente.status}: ${JSON.stringify(bodyCliente.error ?? {})}`,
      ).toBe(201);
      const cliente = bodyCliente.data!;

      const resMascota = await callApp("/mascotas", {
        method: "POST", jwt,
        body: {
          name: "Primer Paciente", clientId: cliente.id, especieId,
          razaId: (razas ?? [])[0]?.id, sex: "Macho", tamano: "Mediano",
        },
      });
      const bodyMascota = await resMascota.json() as { data?: { estado?: string }; error?: unknown };

      expect(resMascota.status, `POST /mascotas respondió ${resMascota.status}: ${JSON.stringify(bodyMascota.error ?? {})}`).toBe(201);
      expect(bodyMascota.data?.estado).toBe("Activa");

      await borrarUsuarioAuth(userId);
    } finally {
      await limpiarTenant(serviceDb, tenantId);
    }
  }, 60_000);
});
