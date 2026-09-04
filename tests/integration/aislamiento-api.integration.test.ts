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
  // ── Módulo Comercial (Etapas C1..C8) ──────────────────────────────────────
  // El CLAUDE.md obliga a sumar a esta matriz TODA entidad de negocio nueva. El
  // módulo entero se había mergeado sin una sola entidad acá, así que ninguno de
  // sus ~60 endpoints tenía prueba de aislamiento por el camino real de la API.
  familiaId:          string;
  productoId:         string;
  productoDerivadoId: string;
  conversionId:       string;
  proveedorId:        string;
  loteId:             string;
  compraId:           string;
  compraItemId:       string;
  cajaId:             string;
  sesionCajaId:       string;
  ventaId:            string;
  ventaItemId:        string;
  recuentoId:         string;
  /** Catálogos globales: no son del tenant, pero hacen falta para armar bodies válidos. */
  unidadMedidaId:     string;
  medioPagoId:        string;
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
// Lotes del fixture comercial: vencimiento lejano para que nada rebote por
// vencido antes de llegar al control de tenant.
const FECHA_VENCIMIENTO = "2099-06-30";

let serviceDb: SupabaseClient;
let A: TenantFixture;
let B: TenantFixture;

/**
 * Insert de fixture que no puede fallar en silencio.
 *
 * El guard de ids vacíos al final de `provisionTenant` avisa QUE algo faltó,
 * pero no POR QUÉ. Con esto el mensaje trae el error de Postgres. Estrenado
 * sembrando el módulo comercial: un insert masivo de dos productos donde la
 * segunda fila omitía `es_consumible_clinico` — PostgREST unifica las claves de
 * un bulk insert y la mandaba como null contra una columna NOT NULL.
 */
async function insertarFixture<T = { id: string }>(
  tabla: string,
  filas: Record<string, unknown> | Array<Record<string, unknown>>,
): Promise<T[]> {
  const { data, error } = await serviceDb.from(tabla).insert(filas as never).select("*");
  if (error) throw new Error(`Fixture: no se pudo sembrar ${tabla}: ${error.message}`);
  return (data ?? []) as T[];
}

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

  // ─── Módulo Comercial ───────────────────────────────────────────────────────
  // Una fila de cada entidad, con existencia real, para que los endpoints de la
  // matriz tengan a qué apuntar. Se siembra con service role igual que el resto.

  const { data: unidad } = await serviceDb
    .from("unidades_medida").select("id").eq("codigo", "unidad").single();
  const unidadMedidaId = unidad?.id as string;

  const { data: medio } = await serviceDb
    .from("medios_pago").select("id").eq("codigo", "efectivo").single();
  const medioPagoId = medio?.id as string;

  const [familia] = await insertarFixture("familias_producto",
    { tenant_id: tenantId, nombre: `Familia ${sufijo}`, unidad_base_id: unidadMedidaId });
  const familiaId = familia?.id as string;

  // Las dos filas llevan EXACTAMENTE las mismas claves: PostgREST unifica las
  // columnas de un insert masivo y una clave ausente en una fila viaja como
  // null (ver `insertarFixture`).
  const productos = await insertarFixture("productos", [
    { tenant_id: tenantId, codigo: `PROD-${sufijo}`, nombre: `Producto ${sufijo}`,
      unidad_medida_id: unidadMedidaId, familia_id: familiaId,
      es_consumible_clinico: true, precio_venta: 500, costo_reposicion: 100 },
    { tenant_id: tenantId, codigo: `DERIV-${sufijo}`, nombre: `Derivado ${sufijo}`,
      unidad_medida_id: unidadMedidaId, familia_id: familiaId,
      es_consumible_clinico: true, precio_venta: 60, costo_reposicion: 12 },
  ]);
  const productoId         = productos[0]?.id as string;
  const productoDerivadoId = productos[1]?.id as string;

  const [conversion] = await insertarFixture("producto_conversiones",
    { tenant_id: tenantId, producto_origen_id: productoId,
      producto_destino_id: productoDerivadoId, factor_teorico: 10 });
  const conversionId = conversion?.id as string;

  const [proveedor] = await insertarFixture("proveedores",
    { tenant_id: tenantId, razon_social: `Proveedor ${sufijo}`,
      cuit: `30-1234567-${sufijo === "AISLA" ? 1 : 2}` });
  const proveedorId = proveedor?.id as string;

  const [lote] = await insertarFixture("lotes", {
    tenant_id: tenantId, producto_id: productoId, codigo_lote: `LOTE-${sufijo}`,
    fecha_vencimiento: FECHA_VENCIMIENTO, costo_unitario_neto: 100,
    costo_unitario_efectivo: 100, origen: "compra", proveedor_id: proveedorId,
    usuario_id: userId,
  });
  const loteId = lote?.id as string;

  // Existencia real: sin esto los endpoints de consumo/venta/fraccionamiento
  // rebotarían por falta de stock ANTES de mirar el tenant — verde vacío.
  await insertarFixture("movimientos_stock", {
    tenant_id: tenantId, operacion_id: crypto.randomUUID(), tipo: "entrada_inicial",
    producto_id: productoId, lote_id: loteId, cantidad: 1000,
    costo_unitario: 100, costo_total: 100000, usuario_id: userId,
  });

  // Compra en BORRADOR: es el estado en el que los endpoints de edición e
  // ítems son operables, así que un rechazo solo puede venir del aislamiento.
  const [compra] = await insertarFixture("compras", {
    tenant_id: tenantId, proveedor_id: proveedorId, fecha: "2026-02-01",
    estado: "borrador", usuario_id: userId,
    comprobante_proveedor_tipo: "Factura A", comprobante_proveedor_numero: `0001-${sufijo}`,
  });
  const compraId = compra?.id as string;

  const [compraItem] = await insertarFixture("compras_items", {
    tenant_id: tenantId, compra_id: compraId, producto_id: productoId,
    cantidad: 10, costo_unitario_neto: 100, alicuota_iva: 21,
    importe_neto: 1000, importe_iva: 210, importe_total: 1210,
  });
  const compraItemId = compraItem?.id as string;

  const [caja] = await insertarFixture("cajas", { tenant_id: tenantId, nombre: `Caja ${sufijo}` });
  const cajaId = caja?.id as string;

  // Sesión ABIERTA: los endpoints de movimiento y cierre exigen ese estado.
  const [sesion] = await insertarFixture("sesiones_caja",
    { tenant_id: tenantId, caja_id: cajaId, apertura_usuario_id: userId, saldo_inicial: 1000 });
  const sesionCajaId = sesion?.id as string;

  await insertarFixture("movimientos_caja", {
    tenant_id: tenantId, sesion_caja_id: sesionCajaId, tipo: "ingreso_manual",
    medio_pago_id: medioPagoId, importe: 500, motivo: `Ingreso inicial ${sufijo}`,
    usuario_id: userId,
  });

  const [venta] = await insertarFixture("ventas", {
    tenant_id: tenantId, numero_operacion: 1, sesion_caja_id: sesionCajaId,
    cliente_id: clienteId, subtotal_neto: 1000, total_iva: 210, total: 1210,
    estado: "registrada", usuario_id: userId,
  });
  const ventaId = venta?.id as string;

  const [ventaItem] = await insertarFixture("ventas_items", {
    tenant_id: tenantId, venta_id: ventaId, tipo_item: "producto", producto_id: productoId,
    descripcion_snapshot: `Producto ${sufijo}`, cantidad: 2, precio_unitario: 605,
    alicuota_iva: 21, neto_unitario: 500, iva_unitario: 105, importe_total: 1210,
    costo_unitario_efectivo: 100,
  });
  const ventaItemId = ventaItem?.id as string;

  // Recuento en BORRADOR (uq_recuento_borrador: uno solo por tenant).
  const [recuento] = await insertarFixture("recuentos",
    { tenant_id: tenantId, usuario_id: userId, estado: "borrador",
      observaciones: `Recuento ${sufijo}` });
  const recuentoId = recuento?.id as string;

  await insertarFixture("recuentos_detalle", {
    tenant_id: tenantId, recuento_id: recuentoId, lote_id: loteId, cantidad_contada: 1000,
  });

  const fixture: TenantFixture = {
    tenantId, jwt, userId, rolAdminId, rolVetId, clienteId, clienteAltId,
    mascotaId, servicioId, servicioLibreId, doctorId, horarioId, turnoId,
    estadiaId, eventoId, planVacId, ...catalogo,
    familiaId, productoId, productoDerivadoId, conversionId, proveedorId,
    loteId, compraId, compraItemId, cajaId, sesionCajaId, ventaId, ventaItemId,
    recuentoId, unidadMedidaId, medioPagoId,
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
const TABLAS_SNAPSHOT: ReadonlyArray<readonly [tabla: string, orden: string]> = [
  ["clientes", "id"], ["mascotas", "id"], ["servicios", "id"], ["doctores", "id"],
  ["horarios_doctor", "id"], ["turnos", "id"], ["estadias", "id"],
  ["historial_clinico", "id"], ["plan_vacunacion", "id"], ["usuarios", "id"],
  // Catálogos clínicos: entidades de negocio del tenant desde
  // 20260827000001_catalogos_por_tenant.sql, así que entran a la matriz.
  ["especies", "id"], ["razas", "id"], ["tipos_vacuna", "id"],
  // Qué vacuna aplica a qué especie (20260828000001_vacunas_por_especie.sql).
  // Entra por la misma regla del CLAUDE.md: toda entidad de negocio nueva se
  // suma acá. Y no es cosmético — de esta tabla depende qué se le puede
  // inyectar a un animal, así que una escritura cruzada no es solo un dato
  // ajeno: habilita una vacuna equivocada en la clínica de al lado.
  ["especie_tipo_vacuna", "especie_id,tipo_vacuna_id"],

  // ── Módulo Comercial (Etapas C1..C8) ────────────────────────────────────────
  // Ni una de estas tablas estaba en la matriz: el módulo entero se mergeó sin
  // que ningún test verificara que una escritura de B no toca las filas de A.
  // La segunda posición es la columna de orden — `existencias_lote` no tiene
  // `id` (su PK es `lote_id`) y un `.order("id")` sobre ella devolvía error, o
  // sea una foto vacía a ambos lados de la comparación: verde garantizado sin
  // haber mirado nada.
  ["familias_producto", "id"], ["productos", "id"], ["producto_conversiones", "id"],
  ["proveedores", "id"], ["lotes", "id"], ["movimientos_stock", "id"],
  ["existencias_lote", "lote_id"],
  ["compras", "id"], ["compras_items", "id"],
  ["cajas", "id"], ["sesiones_caja", "id"], ["movimientos_caja", "id"],
  ["ventas", "id"], ["ventas_items", "id"], ["ventas_pagos", "id"],
  ["recuentos", "id"], ["recuentos_detalle", "id"],
] as const;

/** Foto ordenada y estable de todas las filas de A, para comparar antes/después. */
async function snapshotTenant(tenantId: string): Promise<Record<string, string>> {
  const foto: Record<string, string> = {};
  for (const [tabla, orden] of TABLAS_SNAPSHOT) {
    let query = serviceDb.from(tabla).select("*").eq("tenant_id", tenantId);
    for (const col of orden.split(",").map((c) => c.trim())) {
      query = query.order(col);
    }
    const { data, error } = await query;
    // Un error acá deja la foto en "[]" a ambos lados y la comparación pasa sin
    // haber mirado la tabla. Se corta en vez de dar ese verde.
    if (error) throw new Error(`snapshotTenant: no se pudo fotografiar "${tabla}": ${error.message}`);
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
    const { data: turnoCruzado, error: insertError } = await serviceDb.from("turnos").insert({
      tenant_id: B.tenantId, client_id: B.clienteId, pet_id: B.mascotaId,
      servicio_id: A.servicioLibreId, doctor_id: null, date: FECHA_TURNO,
      start_time: "15:00", end_time: "15:30", status: "Confirmado",
      reason: "Turno de B contra un servicio de A",
    }).select("id").single();
    expect(insertError, "no se pudo sembrar el turno cruzado").toBeNull();

    try {
      const res = await callApp(`/servicios/${A.servicioLibreId}/estado`, {
        method: "PATCH", jwt: A.jwt, body: { activo: false },
      });
      const body = await res.json() as { success: boolean; data?: { activo: boolean } };

      expect(res.status, "el turno de otra clínica bloqueó la baja").toBe(200);
      expect(body.data?.activo).toBe(false);
    } finally {
      // Este turno es el ÚNICO dato cruzado que la suite siembra a propósito, y
      // hay que sacarlo acá mismo. Si sobrevive, el teardown no puede dar de
      // baja al tenant A: `servicios` no se libera mientras un turno de B lo
      // referencie (`turnos_servicio_id_fkey` es RESTRICT), y el turno de B solo
      // se va con B. El orden de purga pasaría a importar, que es justo lo que
      // no queremos que un teardown tenga que adivinar.
      // El `finally` es deliberado: si el assert de arriba falla, el turno se
      // limpia igual y el rojo queda en ESTE test en vez de reaparecer como un
      // error de teardown en la corrida siguiente.
      if (turnoCruzado?.id) await serviceDb.from("turnos").delete().eq("id", turnoCruzado.id);
    }
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

  it("RN-SC2: un lote de A no puede referenciar un producto de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const { data: prodB } = await serviceDb.from("productos").insert({
      tenant_id: B.tenantId, codigo: `PROD-B-LOTE-${Date.now()}`, nombre: "Prod B Lote", unidad_medida_id: unidadId,
    }).select("id").single();

    const { error } = await serviceDb.from("lotes").insert({
      tenant_id: A.tenantId,
      producto_id: prodB?.id,
      codigo_lote: "LOTE-CROSS",
      costo_unitario_neto: 100,
      costo_unitario_efectivo: 100,
      origen: "compra",
      usuario_id: A.userId,
    });

    expect(error, "la FK compuesta debió rechazar el producto ajeno").not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("RN-SC2: ninguna tabla comercial acepta un usuario_id de OTRO tenant (FK compuesta)", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    // Las 12 columnas que apuntan a `usuarios`. Hasta la corrección de la
    // auditoría eran FKs SIMPLES (`REFERENCES usuarios(id)`), así que un
    // usuario_id de otra clínica entraba sin que la base dijera nada: quedaba
    // firmando un asiento del libro mayor, una venta o una sesión de caja.
    // Se insertan filas de A firmadas por el usuario de B, con service role
    // (sin Service de por medio): el único control que puede frenarlas es la FK.
    const filasDeAFirmadasPorB: Array<{ nombre: string; tabla: string; fila: Record<string, unknown> }> = [
      { nombre: "lotes.usuario_id", tabla: "lotes", fila: {
        tenant_id: A.tenantId, producto_id: A.productoId, codigo_lote: "LOTE-CROSS",
        costo_unitario_neto: 1, costo_unitario_efectivo: 1, origen: "compra", usuario_id: B.userId } },
      { nombre: "movimientos_stock.usuario_id", tabla: "movimientos_stock", fila: {
        tenant_id: A.tenantId, operacion_id: crypto.randomUUID(), tipo: "entrada_ajuste",
        producto_id: A.productoId, lote_id: A.loteId, cantidad: 1, usuario_id: B.userId } },
      { nombre: "movimientos_stock.profesional_prescriptor_id", tabla: "movimientos_stock", fila: {
        tenant_id: A.tenantId, operacion_id: crypto.randomUUID(), tipo: "entrada_ajuste",
        producto_id: A.productoId, lote_id: A.loteId, cantidad: 1, usuario_id: A.userId,
        profesional_prescriptor_id: B.userId } },
      { nombre: "compras.usuario_id", tabla: "compras", fila: {
        tenant_id: A.tenantId, proveedor_id: A.proveedorId, fecha: "2026-03-01", usuario_id: B.userId } },
      // Sesión CERRADA a propósito: `uq_sesion_caja_abierta` es un índice único
      // parcial sobre (tenant_id, caja_id) WHERE estado = 'abierta', y la caja de
      // A ya tiene su sesión abierta. Una fila 'abierta' rebotaría por 23505
      // antes de llegar a la FK, y el test estaría probando el índice, no el
      // aislamiento.
      { nombre: "sesiones_caja.apertura_usuario_id", tabla: "sesiones_caja", fila: {
        tenant_id: A.tenantId, caja_id: A.cajaId, apertura_usuario_id: B.userId, saldo_inicial: 0,
        estado: "cerrada", cierre_at: "2026-03-01T12:00:00Z", cierre_usuario_id: A.userId,
        saldo_teorico_efectivo: 0, efectivo_contado: 0, diferencia: 0 } },
      { nombre: "sesiones_caja.cierre_usuario_id", tabla: "sesiones_caja", fila: {
        tenant_id: A.tenantId, caja_id: A.cajaId, apertura_usuario_id: A.userId, saldo_inicial: 0,
        estado: "cerrada", cierre_at: "2026-03-01T12:00:00Z", cierre_usuario_id: B.userId,
        saldo_teorico_efectivo: 0, efectivo_contado: 0, diferencia: 0 } },
      { nombre: "movimientos_caja.usuario_id", tabla: "movimientos_caja", fila: {
        tenant_id: A.tenantId, sesion_caja_id: A.sesionCajaId, tipo: "ingreso_manual",
        medio_pago_id: A.medioPagoId, importe: 1, usuario_id: B.userId } },
      { nombre: "ventas.usuario_id", tabla: "ventas", fila: {
        tenant_id: A.tenantId, numero_operacion: 9001, sesion_caja_id: A.sesionCajaId,
        usuario_id: B.userId } },
      { nombre: "ventas.anulada_por_usuario_id", tabla: "ventas", fila: {
        tenant_id: A.tenantId, numero_operacion: 9002, sesion_caja_id: A.sesionCajaId,
        usuario_id: A.userId, estado: "anulada", anulada_at: "2026-03-01T12:00:00Z",
        anulada_por_usuario_id: B.userId, motivo_anulacion: "Anulada desde otra clínica" } },
      { nombre: "recuentos.usuario_id", tabla: "recuentos", fila: {
        tenant_id: A.tenantId, usuario_id: B.userId, estado: "aplicado",
        aplicado_at: "2026-03-01T12:00:00Z", aplicado_por_usuario_id: A.userId } },
      { nombre: "recuentos.aplicado_por_usuario_id", tabla: "recuentos", fila: {
        tenant_id: A.tenantId, usuario_id: A.userId, estado: "aplicado",
        aplicado_at: "2026-03-01T12:00:00Z", aplicado_por_usuario_id: B.userId } },
      { nombre: "ventas_items.profesional_prescriptor_id", tabla: "ventas_items", fila: {
        tenant_id: A.tenantId, venta_id: A.ventaId, tipo_item: "producto", producto_id: A.productoId,
        descripcion_snapshot: "Cross", cantidad: 1, precio_unitario: 1, alicuota_iva: 21,
        neto_unitario: 1, iva_unitario: 0, importe_total: 1,
        profesional_prescriptor_id: B.userId } },
    ];

    const aceptadas: string[] = [];
    for (const caso of filasDeAFirmadasPorB) {
      const { error } = await serviceDb.from(caso.tabla).insert(caso.fila as never);
      // 23503 = foreign_key_violation. Se exige ESE código: un rechazo por un
      // CHECK o un NOT NULL probaría otra cosa y dejaría el agujero abierto.
      if (error?.code !== "23503") {
        aceptadas.push(`${caso.nombre} → ${error ? `${error.code}: ${error.message}` : "ACEPTADA (sin error)"}`);
      }
    }

    expect(
      aceptadas,
      `Estas columnas aceptaron un usuario_id de otro tenant sin violar ninguna FK:\n${aceptadas.join("\n")}`,
    ).toEqual([]);
  });

  it("RN-SC2: un movimiento de A no puede referenciar un lote de B", async () => {
    if (skipIfNoCredentials() || !A?.tenantId || !B?.tenantId) return;

    const { data: u } = await serviceDb.from("unidades_medida").select("id").eq("codigo", "unidad").single();
    const unidadId = (u as { id: string })?.id;

    const { data: prodA } = await serviceDb.from("productos").insert({
      tenant_id: A.tenantId, codigo: `PROD-A-MOV-${Date.now()}`, nombre: "Prod A Mov", unidad_medida_id: unidadId,
    }).select("id").single();

    const { data: prodB } = await serviceDb.from("productos").insert({
      tenant_id: B.tenantId, codigo: `PROD-B-MOV-${Date.now()}`, nombre: "Prod B Mov", unidad_medida_id: unidadId,
    }).select("id").single();

    const { data: loteB } = await serviceDb.from("lotes").insert({
      tenant_id: B.tenantId,
      producto_id: prodB?.id,
      codigo_lote: "LOTE-B",
      costo_unitario_neto: 100,
      costo_unitario_efectivo: 100,
      origen: "compra",
      usuario_id: B.userId,
    }).select("id").single();

    const { error } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: A.tenantId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: prodA?.id,
      lote_id: loteB?.id,
      cantidad: 5,
      usuario_id: A.userId,
    });

    expect(error, "la FK compuesta debió rechazar el lote ajeno").not.toBeNull();
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

// ─── 6. MÓDULO COMERCIAL — la matriz que faltaba entera ───────────────────────
//
// El CLAUDE.md ("Los tests de aislamiento bloqueantes son dos…") obliga a sumar
// a esta suite TODA entidad de negocio nueva. El Módulo Comercial se mergeó a lo
// largo de ocho etapas sin una sola entidad ni un solo endpoint acá: ~60
// endpoints de 10 módulos cuyo aislamiento por el camino real (HTTP → controller
// → Service → DB) no verificaba nadie. El guardrail estático
// (`tests/unit/tenant-filter-guardrail.test.ts`) chequea que el `.eq("tenant_id",
// ...)` ESTÉ; esto chequea que el valor sea el correcto, que es lo que aquél no
// puede ver.

describeIntegration("Aislamiento por API — COMERCIAL: B no lee entidades de A", () => {
  it("ningún GET al detalle de una entidad comercial de A responde 2xx con el JWT de B", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const lecturas: Intento[] = [
      { nombre: "producto",             method: "GET", path: `/productos/${A.productoId}` },
      { nombre: "familia de producto",  method: "GET", path: `/familias-producto/${A.familiaId}` },
      { nombre: "conversión",           method: "GET", path: `/producto-conversiones/${A.conversionId}` },
      { nombre: "proveedor",            method: "GET", path: `/proveedores/${A.proveedorId}` },
      { nombre: "lote",                 method: "GET", path: `/lotes/${A.loteId}` },
      { nombre: "kardex del lote",      method: "GET", path: `/lotes/${A.loteId}/kardex` },
      { nombre: "trazabilidad del lote", method: "GET", path: `/lotes/${A.loteId}/trazabilidad` },
      { nombre: "compra",               method: "GET", path: `/compras/${A.compraId}` },
      { nombre: "sesión de caja",       method: "GET", path: `/caja/sesiones/${A.sesionCajaId}` },
      { nombre: "resumen de sesión",    method: "GET", path: `/caja/sesiones/${A.sesionCajaId}/resumen` },
      { nombre: "venta",                method: "GET", path: `/ventas/${A.ventaId}` },
      { nombre: "recuento",             method: "GET", path: `/recuentos/${A.recuentoId}` },
      { nombre: "consumos del evento",  method: "GET", path: `/consumos/evento/${A.eventoId}` },
      { nombre: "disponibilidad del producto", method: "GET",
        path: `/consumos/disponibilidad?productoId=${A.productoId}` },
      { nombre: "sugerir vencimiento",  method: "GET",
        path: `/fraccionamiento/sugerir-vencimiento?loteOrigenId=${A.loteId}&productoDestinoId=${A.productoDerivadoId}` },
    ];

    const filtrados: string[] = [];
    for (const intento of lecturas) {
      const { status, code } = await esperarRechazo(intento);
      if (status < 400) filtrados.push(`${intento.nombre} → ${status}`);
      verificarMotivo(intento, status, code);
    }

    expect(filtrados, "entidades comerciales de A legibles con el JWT de B").toEqual([]);
  });

  it("ningún listado ni reporte comercial de B contiene datos de A", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    // Además del id, se busca el NOMBRE de la entidad de A: varios reportes
    // agregan por producto/usuario y devuelven la descripción, no siempre el id.
    const listados: Array<{ nombre: string; path: string; agujas: string[] }> = [
      { nombre: "productos",         path: "/productos?limit=100",         agujas: [A.productoId, "PROD-AISLA"] },
      { nombre: "familias",          path: "/familias-producto?limit=100", agujas: [A.familiaId, "Familia AISLA"] },
      { nombre: "conversiones",      path: "/producto-conversiones?limit=100", agujas: [A.conversionId] },
      { nombre: "proveedores",       path: "/proveedores?limit=100",       agujas: [A.proveedorId, "Proveedor AISLA"] },
      { nombre: "lotes",             path: "/lotes?limit=100",             agujas: [A.loteId, "LOTE-AISLA"] },
      { nombre: "movimientos stock", path: "/movimientos-stock?limit=100", agujas: [A.loteId, A.productoId] },
      { nombre: "existencias",       path: "/existencias?limit=100",       agujas: [A.loteId, A.productoId] },
      { nombre: "valorización",      path: "/existencias/valorizacion",    agujas: [A.productoId] },
      { nombre: "lotes por vencer",  path: "/lotes/candidatos",            agujas: [A.loteId] },
      { nombre: "compras",           path: "/compras?limit=100",           agujas: [A.compraId] },
      { nombre: "cajas",             path: "/caja/cajas",                  agujas: [A.cajaId, "Caja AISLA"] },
      { nombre: "sesiones de caja",  path: "/caja/sesiones?limit=100",     agujas: [A.sesionCajaId] },
      { nombre: "ventas",            path: "/ventas?limit=100",            agujas: [A.ventaId] },
      { nombre: "margen de ventas",  path: "/ventas/reportes/margen",      agujas: [A.ventaId, A.productoId] },
      { nombre: "ítems vendidos",    path: "/ventas/reportes/items-vendidos", agujas: [A.ventaId, A.productoId] },
      { nombre: "recuentos",         path: "/recuentos?limit=100",         agujas: [A.recuentoId] },
      { nombre: "historial fraccionamiento", path: "/fraccionamiento/historial?limit=100", agujas: [A.productoId] },
      // Reportes de la Etapa C8: los nueve.
      { nombre: "rep. valorización a fecha", path: "/reportes/valorizacion-fecha", agujas: [A.productoId] },
      { nombre: "rep. rotación",             path: "/reportes/rotacion",           agujas: [A.productoId] },
      { nombre: "rep. fraccionamiento",      path: "/reportes/fraccionamiento",    agujas: [A.productoId] },
      { nombre: "rep. consumo profesional",  path: "/reportes/consumo-profesional", agujas: [A.userId] },
      { nombre: "rep. consumo especie",      path: "/reportes/consumo-especie",    agujas: [A.especieId] },
      { nombre: "rep. rentabilidad",         path: "/reportes/rentabilidad",       agujas: [A.productoId] },
      { nombre: "rep. ventas por usuario",   path: "/reportes/ventas-usuario",     agujas: [A.userId] },
      { nombre: "rep. ventas por sesión",    path: "/reportes/ventas-sesion",      agujas: [A.sesionCajaId] },
      { nombre: "rep. ventas por medio de pago", path: "/reportes/ventas-medio-pago", agujas: [A.ventaId] },
    ];

    const contaminados: string[] = [];
    for (const l of listados) {
      const res  = await callApp(l.path, { jwt: B.jwt });
      const body = await res.json() as { success: boolean; data?: unknown; error?: { code?: string } };
      expect(res.status, `${l.nombre}: el listado no respondió 200 (${body.error?.code ?? ""})`).toBe(200);

      const crudo = JSON.stringify(body.data ?? []);
      for (const aguja of l.agujas) {
        if (crudo.includes(aguja)) contaminados.push(`${l.nombre} ← ${aguja}`);
      }
    }

    expect(contaminados, "listados/reportes de B con datos de A").toEqual([]);
  });

  it("los reportes de B filtrados POR UN ID DE A no devuelven nada de A", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    // Variante distinta de la anterior: acá B pide explícitamente el id de A como
    // filtro. Un Service que aplicara el filtro del request pero se olvidara el
    // de tenant devolvería exactamente las filas de A.
    const filtrados: Array<{ nombre: string; path: string; aguja: string }> = [
      { nombre: "valorización por producto de A", path: `/reportes/valorizacion-fecha?productoId=${A.productoId}`, aguja: A.productoId },
      { nombre: "rotación por familia de A",      path: `/reportes/rotacion?familiaId=${A.familiaId}`,             aguja: A.productoId },
      { nombre: "rentabilidad por producto de A", path: `/reportes/rentabilidad?productoId=${A.productoId}`,        aguja: A.productoId },
      { nombre: "fraccionamiento por producto de A", path: `/reportes/fraccionamiento?productoOrigenId=${A.productoId}`, aguja: A.productoId },
      { nombre: "consumo del profesional de A",   path: `/reportes/consumo-profesional?profesionalId=${A.userId}`,  aguja: A.userId },
      { nombre: "consumo por especie de A",       path: `/reportes/consumo-especie?especieId=${A.especieId}`,       aguja: A.especieId },
      { nombre: "ventas del usuario de A",        path: `/reportes/ventas-usuario?usuarioId=${A.userId}`,           aguja: A.userId },
      { nombre: "ventas de la sesión de A",       path: `/reportes/ventas-sesion?sesionId=${A.sesionCajaId}`,       aguja: A.sesionCajaId },
      { nombre: "ventas por medio de pago",       path: `/reportes/ventas-medio-pago?medioPagoId=${A.medioPagoId}`, aguja: A.ventaId },
      { nombre: "margen por ítem de A",           path: `/ventas/reportes/margen?itemId=${A.productoId}&tipoItem=producto`, aguja: A.productoId },
      { nombre: "ítems vendidos de A",            path: `/ventas/reportes/items-vendidos?itemId=${A.productoId}&tipoItem=producto`, aguja: A.productoId },
      { nombre: "ventas de la sesión de A (listado)", path: `/ventas?sesionCajaId=${A.sesionCajaId}`,               aguja: A.ventaId },
      { nombre: "compras del proveedor de A",     path: `/compras?proveedorId=${A.proveedorId}`,                    aguja: A.compraId },
      { nombre: "productos de la familia de A",   path: `/productos?familiaId=${A.familiaId}`,                      aguja: A.productoId },
      { nombre: "conversiones del producto de A", path: `/producto-conversiones?productoOrigenId=${A.productoId}`,   aguja: A.conversionId },
    ];

    const contaminados: string[] = [];
    for (const f of filtrados) {
      const res  = await callApp(f.path, { jwt: B.jwt });
      const body = await res.json() as { success: boolean; data?: unknown; error?: { code?: string } };
      // Un 404/403 también es un rechazo válido; lo inaceptable es un 200 con datos de A.
      if (res.status >= 500) {
        throw new Error(`${f.nombre}: respondió ${res.status} — el control de tenant no llegó a correr`);
      }
      if (res.status === 200 && JSON.stringify(body.data ?? []).includes(f.aguja)) {
        contaminados.push(f.nombre);
      }
    }

    expect(contaminados, "reportes de B que devolvieron filas de A al filtrar por un id de A").toEqual([]);
  });
});

describeIntegration("Aislamiento por API — COMERCIAL: B no escribe sobre entidades de A", () => {
  it("ninguna escritura comercial de B sobre A prospera, y las filas de A quedan intactas", async () => {
    if (skipIfNoCredentials() || !A?.jwt || !B?.jwt) return;

    const antes = await snapshotTenant(A.tenantId);

    const escrituras: Intento[] = [
      // ── Catálogo comercial (C1) ──────────────────────────────────────────
      { nombre: "editar producto de A", method: "PUT", path: `/productos/${A.productoId}`,
        body: { nombre: "Producto secuestrado por B" } },
      { nombre: "desactivar producto de A", method: "PATCH", path: `/productos/${A.productoId}/estado`,
        body: { activo: false } },
      { nombre: "crear derivado del producto de A", method: "POST", path: `/productos/${A.productoId}/derivado`,
        body: { codigo: `DERIV-INTRUSO-${Date.now()}`, nombre: "Derivado inyectado por B",
                unidadMedidaId: B.unidadMedidaId, factorTeorico: 5 } },
      { nombre: "editar familia de A", method: "PUT", path: `/familias-producto/${A.familiaId}`,
        body: { nombre: "Familia secuestrada por B" } },
      { nombre: "desactivar familia de A", method: "PATCH", path: `/familias-producto/${A.familiaId}/estado`,
        body: { activo: false } },
      { nombre: "editar conversión de A", method: "PUT", path: `/producto-conversiones/${A.conversionId}`,
        body: { factorTeorico: 999 } },
      { nombre: "desactivar conversión de A", method: "PATCH", path: `/producto-conversiones/${A.conversionId}/estado`,
        body: { activo: false } },
      { nombre: "crear conversión con productos de A", method: "POST", path: "/producto-conversiones",
        body: { productoOrigenId: A.productoId, productoDestinoId: A.productoDerivadoId, factorTeorico: 3 } },
      { nombre: "editar proveedor de A", method: "PUT", path: `/proveedores/${A.proveedorId}`,
        body: { razonSocial: "Proveedor secuestrado por B" } },
      { nombre: "desactivar proveedor de A", method: "PATCH", path: `/proveedores/${A.proveedorId}/estado`,
        body: { activo: false } },
      { nombre: "crear producto en la familia de A", method: "POST", path: "/productos",
        body: { codigo: `PROD-INTRUSO-${Date.now()}`, nombre: "Producto inyectado por B",
                unidadMedidaId: B.unidadMedidaId, familiaId: A.familiaId } },

      // ── Compras (C2) ─────────────────────────────────────────────────────
      { nombre: "editar compra de A", method: "PUT", path: `/compras/${A.compraId}`,
        body: { observaciones: "Editada por B" } },
      { nombre: "agregar ítem a la compra de A", method: "POST", path: `/compras/${A.compraId}/items`,
        body: { productoId: B.productoId, cantidad: 1, costoUnitarioNeto: 10, alicuotaIva: 21 } },
      { nombre: "editar ítem de la compra de A", method: "PUT",
        path: `/compras/${A.compraId}/items/${A.compraItemId}`, body: { cantidad: 99 } },
      { nombre: "borrar ítem de la compra de A", method: "DELETE",
        path: `/compras/${A.compraId}/items/${A.compraItemId}` },
      { nombre: "confirmar la compra de A", method: "POST", path: `/compras/${A.compraId}/confirmar` },
      { nombre: "anular la compra de A", method: "POST", path: `/compras/${A.compraId}/anular`,
        body: { motivo: "Anulada por un intruso de otra clínica" } },
      { nombre: "crear compra con el proveedor de A", method: "POST", path: "/compras",
        body: { proveedorId: A.proveedorId, fecha: "2026-02-02" } },

      // ── Caja (C3) ────────────────────────────────────────────────────────
      { nombre: "registrar movimiento en la sesión de A", method: "POST",
        path: `/caja/sesiones/${A.sesionCajaId}/movimientos`,
        body: { tipo: "ingreso_manual", medioPagoId: B.medioPagoId, importe: 100,
                motivo: "Movimiento inyectado por otra clínica" } },
      { nombre: "cerrar la sesión de caja de A", method: "POST",
        path: `/caja/sesiones/${A.sesionCajaId}/cerrar`,
        body: { efectivoContado: 0, motivo: "Cierre forzado por otra clínica" } },
      { nombre: "abrir sesión en la caja de A", method: "POST", path: "/caja/sesiones",
        body: { cajaId: A.cajaId, saldoInicial: 0 } },

      // ── Ventas (C4) ──────────────────────────────────────────────────────
      { nombre: "anular la venta de A", method: "POST", path: `/ventas/${A.ventaId}/anular`,
        body: { motivo: "Anulada por un intruso de otra clínica" } },
      { nombre: "vender el producto de A", method: "POST", path: "/ventas",
        body: { sesionCajaId: B.sesionCajaId,
                items: [{ tipoItem: "producto", productoId: A.productoId, cantidad: 1 }] } },
      { nombre: "vender contra la sesión de caja de A", method: "POST", path: "/ventas",
        body: { sesionCajaId: A.sesionCajaId,
                items: [{ tipoItem: "producto", productoId: B.productoId, cantidad: 1 }] } },
      { nombre: "vender el lote de A", method: "POST", path: "/ventas",
        body: { sesionCajaId: B.sesionCajaId,
                items: [{ tipoItem: "producto", productoId: B.productoId, cantidad: 1, loteId: A.loteId,
                          motivoFefo: "Lote elegido a mano por un intruso" }] } },

      // ── Ajustes, recuentos y devoluciones (C5) ───────────────────────────
      { nombre: "ajustar el lote de A", method: "POST", path: "/ajustes",
        body: { loteId: A.loteId, tipo: "salida_ajuste", cantidad: 5,
                motivo: "Ajuste inyectado desde otra clínica" } },
      { nombre: "bloquear el lote de A", method: "POST", path: `/lotes/${A.loteId}/bloquear`,
        body: { motivo: "Bloqueo inyectado desde otra clínica" } },
      { nombre: "desbloquear el lote de A", method: "POST", path: `/lotes/${A.loteId}/desbloquear`,
        body: { motivo: "Desbloqueo inyectado desde otra clínica" } },
      { nombre: "guardar detalles del recuento de A", method: "PUT",
        path: `/recuentos/${A.recuentoId}/detalles`,
        body: { items: [{ loteId: A.loteId, cantidadContada: 0 }] } },
      { nombre: "aplicar el recuento de A", method: "POST", path: `/recuentos/${A.recuentoId}/aplicar`,
        body: { confirmarDesvios: true } },
      { nombre: "borrar el recuento de A", method: "DELETE", path: `/recuentos/${A.recuentoId}` },
      { nombre: "devolver la venta de A", method: "POST", path: "/devoluciones",
        body: { ventaId: A.ventaId, items: [{ ventaItemId: A.ventaItemId, cantidad: 1 }],
                motivo: "Devolución inyectada desde otra clínica" } },

      // ── Fraccionamiento (C6) ─────────────────────────────────────────────
      { nombre: "fraccionar el lote de A", method: "POST", path: "/fraccionamiento",
        body: { loteOrigenId: A.loteId, productoDestinoId: B.productoDerivadoId,
                cantidadOrigen: 1, cantidadObtenida: 10, codigoLoteDestino: `FR-INTRUSO-${Date.now()}` } },
      { nombre: "fraccionar hacia el producto de A", method: "POST", path: "/fraccionamiento",
        body: { loteOrigenId: B.loteId, productoDestinoId: A.productoDerivadoId,
                cantidadOrigen: 1, cantidadObtenida: 10, codigoLoteDestino: `FR-INTRUSO2-${Date.now()}` } },

      // ── Consumo clínico (C7) ─────────────────────────────────────────────
      { nombre: "consumir contra el evento clínico de A", method: "POST", path: "/consumos",
        body: { historialId: A.eventoId, items: [{ productoId: B.productoId, cantidad: 1 }] } },
      { nombre: "consumir el producto de A", method: "POST", path: "/consumos",
        body: { historialId: B.eventoId, items: [{ productoId: A.productoId, cantidad: 1 }] } },
      { nombre: "consumir el lote de A", method: "POST", path: "/consumos",
        body: { historialId: B.eventoId,
                items: [{ productoId: B.productoId, cantidad: 1, loteId: A.loteId,
                          motivoFefo: "Lote elegido a mano por un intruso" }] } },
    ];

    const prosperaron: string[] = [];
    for (const intento of escrituras) {
      const { status, code } = await esperarRechazo(intento);
      if (status < 400) prosperaron.push(`${intento.nombre} → ${status}`);
      verificarMotivo(intento, status, code);
    }

    // El snapshot manda: el status no alcanza como prueba. Un endpoint que
    // escribiera y DESPUÉS respondiera 404 seguiría siendo una fuga.
    const despues = await snapshotTenant(A.tenantId);
    const tocadas = Object.keys(antes).filter((t) => antes[t] !== despues[t]);

    expect(tocadas, `tablas de A modificadas por pedidos de B: ${tocadas.join(", ")}`).toEqual([]);
    expect(prosperaron, "escrituras comerciales de B sobre A que respondieron 2xx").toEqual([]);
  });
});
