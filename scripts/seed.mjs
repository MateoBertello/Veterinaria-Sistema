/**
 * Seeder de entorno de DESARROLLO (local) — `npm run seed`.
 *
 * Deja un entorno listo para usar/probar contra el stack LOCAL:
 *   1. Un tenant demo provisionado por el CAMINO REAL (RPC `crear_tenant` →
 *      `on_tenant_created`: roles, permisos, configuración y módulos).
 *   2. Un usuario por cada rol (admin/veterinario/recepcionista) con credenciales
 *      conocidas, creados vía Auth admin API con `app_metadata.tenant_id` correcto.
 *   3. Datos demo por tenant (clientes con mascotas) usando los catálogos globales
 *      (`especies`/`razas`) que ya siembra `on_tenant_created` al crear el tenant.
 *
 * IDEMPOTENTE: correrlo dos veces no duplica ni rompe.
 *
 * NO es para producción. Usa la service-role key (bypassa RLS) — uso legítimo para
 * seeds, igual que el arnés de integración (`tests/integration/_env.ts`).
 *
 * Requisitos de entorno (en `.env`, con fallback a las variantes `TEST_*`):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// ---------------------------------------------------------------------------
// Carga de entorno (.env → process.env, sin pisar variables ya presentes).
// Mismo criterio que tests/integration/_env.ts: acepta prefijo TEST_.
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env opcional — las vars pueden venir del entorno.
  }
}
loadEnv();

const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? process.env["TEST_SUPABASE_URL"] ?? "";
const SERVICE_ROLE_KEY =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"] ??
  "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "✖ Faltan variables de entorno. Definí SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY\n" +
      "  en .env (o sus variantes TEST_*). Ver scripts/README.md.",
  );
  process.exit(1);
}

// Chequeo defensivo "solo DEV/local": evitar sembrar contra un Supabase remoto por error.
const isLocal = /(^https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|host\.docker\.internal|::1|\[::1\])/i.test(
  SUPABASE_URL,
);
if (!isLocal && process.env["SEED_ALLOW_REMOTE"] !== "1") {
  console.error(
    `✖ SUPABASE_URL no parece local (${SUPABASE_URL}).\n` +
      "  El seeder es solo para DEV. Si REALMENTE querés correrlo contra ese destino,\n" +
      "  re-ejecutá con SEED_ALLOW_REMOTE=1.",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  // No usamos Realtime; en Node < 22 (sin WebSocket nativo) hay que proveer `ws`
  // para que la construcción del cliente no falle.
  realtime: { transport: ws },
});

// ---------------------------------------------------------------------------
// Datos de demo (valores EXACTOS de los enums del DDL).
// ---------------------------------------------------------------------------
// El `cuit_rut` DEBE ser byte a byte el mismo que usa `supabase/seed.sql` (el seed
// SQL que `supabase db reset`/`supabase start` corren solos): ese valor es la clave
// de idempotencia del tenant demo. Si difieren —pasó con "20999999999" vs
// "20-99999999-9"— cada seed crea su propio "Veterinaria Demo" y este script
// termina reventando contra `usuarios_pkey`, porque el auth user admin@demo.local
// que reutiliza ya tiene su fila en `usuarios` bajo el OTRO tenant.
const TENANT = {
  nombre: "Veterinaria Demo",
  cuitRut: "20-99999999-9",
  emailContacto: "contacto@demo.local",
  plan: "premium", // habilita los 3 módulos vendibles
};

const PASSWORD = "Demo1234!";

/**
 * Super Admin de PLATAFORMA para desarrollo. No pertenece a ningún tenant: es
 * un usuario de Supabase Auth con `app_metadata.platform_role='super_admin'` y
 * sin fila en `usuarios` (esa tabla exige `tenant_id NOT NULL`). Entra por
 * `/admin/login`, que es su propio camino de autenticación.
 *
 * Se siembra acá para que el entorno de DEV quede completo con `npm run seed`
 * —incluida la suite E2E, que da por sentado el seed—. Para provisionarlo en un
 * entorno real está `scripts/crear-super-admin.mjs`, que pide las credenciales
 * por variables de entorno en vez de traerlas fijas.
 */
const SUPER_ADMIN = { email: "super@leo.local", password: "Super1234!" };
const USERS = [
  { email: "admin@demo.local",     username: "admin_demo",     fullName: "Admin Demo",          roleName: "admin" },
  { email: "vet@demo.local",       username: "vet_demo",       fullName: "Dr. Vet Demo",        roleName: "veterinario" },
  { email: "recepcion@demo.local", username: "recepcion_demo", fullName: "Recepción Demo",      roleName: "recepcionista" },
];

// Clientes con sus mascotas. Especie/raza se resuelven por nombre contra el catálogo global.
const CLIENTES = [
  {
    fullName: "Juana Pérez",
    dniCuit: "27000000001",
    phone: "+54 11 5555-0001",
    address: "Av. Siempreviva 742",
    email: "juana.perez@demo.local",
    mascotas: [
      { name: "Firulais", especie: "Perro", raza: "Mestizo",  sex: "Macho",  tamano: "Mediano", alimentoDieta: "Balanceado adulto" },
      { name: "Michi",    especie: "Gato",  raza: "Siamés",   sex: "Hembra", tamano: "Pequeño", alimentoDieta: "Balanceado felino" },
    ],
  },
  {
    fullName: "Carlos Gómez",
    dniCuit: "20000000002",
    phone: "+54 11 5555-0002",
    address: "Calle Falsa 123",
    email: "carlos.gomez@demo.local",
    mascotas: [
      { name: "Rocky", especie: "Perro", raza: "Labrador Retriever", sex: "Macho", tamano: "Grande", alimentoDieta: "Balanceado large breed" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function die(msg, err) {
  console.error(`✖ ${msg}${err ? `: ${err.message ?? err}` : ""}`);
  process.exit(1);
}

/** Aprovisiona el tenant demo vía RPC real (idempotente por cuit_rut). Devuelve su id. */
async function ensureTenant() {
  const { data: existente, error: selErr } = await db
    .from("tenants")
    .select("id")
    .eq("cuit_rut", TENANT.cuitRut)
    .maybeSingle();
  if (selErr) die("No pude consultar tenants", selErr);

  if (existente) {
    console.log(`• Tenant "${TENANT.nombre}" ya existe — reuso ${existente.id}`);
    return existente.id;
  }

  const { data, error } = await db.rpc("crear_tenant", {
    p_nombre: TENANT.nombre,
    p_cuit_rut: TENANT.cuitRut,
    p_email_contacto: TENANT.emailContacto,
    p_plan: TENANT.plan,
  });
  if (error) die("crear_tenant (RPC) falló", error);

  // RETURNS tenants → supabase-js puede devolver la fila o un array de una fila.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) die("crear_tenant no devolvió un id de tenant");
  console.log(`✓ Tenant "${TENANT.nombre}" creado vía crear_tenant → ${row.id} (plan ${TENANT.plan})`);
  return row.id;
}

/** Busca el auth user existente por email (paginando admin.listUsers). */
async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die("listUsers falló", error);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) break; // última página
  }
  return null;
}

/** Crea (o reutiliza) un usuario de Auth + su fila en `usuarios`; veterinario → fila en `doctores`. */
async function ensureSuperAdmin() {
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: SUPER_ADMIN.email,
    password: SUPER_ADMIN.password,
    email_confirm: true,
    app_metadata: { platform_role: "super_admin" },
  });

  if (!createErr) {
    console.log(`✓ Super Admin de plataforma creado → ${created.user.id}`);
    return;
  }

  if (!/already|registered|exists/i.test(createErr.message ?? "")) {
    die(`createUser falló para ${SUPER_ADMIN.email}`, createErr);
  }

  const existing = await findAuthUserByEmail(SUPER_ADMIN.email);
  if (!existing) die(`Auth dice que ${SUPER_ADMIN.email} ya existe pero no pude localizarlo`);

  // Conserva el resto de app_metadata y (re)afirma el claim de plataforma.
  await db.auth.admin.updateUserById(existing.id, {
    password: SUPER_ADMIN.password,
    email_confirm: true,
    app_metadata: { ...(existing.app_metadata ?? {}), platform_role: "super_admin" },
  });
  console.log(`• Super Admin de plataforma ya existía — reuso ${existing.id} (password/claim re-seteados)`);
}

async function ensureUser(tenantId, spec) {
  // 1. Resolver rol_id del tenant.
  const { data: rol, error: rolErr } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", spec.roleName)
    .single();
  if (rolErr || !rol) die(`No encontré el rol "${spec.roleName}" del tenant`, rolErr);

  // 2. Crear el usuario en Auth (o reutilizar si ya existe).
  let authUserId;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: spec.email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId },
  });

  if (createErr) {
    const already = /already|registered|exists/i.test(createErr.message ?? "");
    if (!already) die(`createUser falló para ${spec.email}`, createErr);
    const existing = await findAuthUserByEmail(spec.email);
    if (!existing) die(`Auth dice que ${spec.email} ya existe pero no pude localizarlo`);
    authUserId = existing.id;
    // Re-setear password + email_confirm + tenant_id: re-correr el seed siempre debe dejar
    // credenciales usables, aunque la password haya cambiado o el mail haya quedado sin confirmar.
    await db.auth.admin.updateUserById(authUserId, {
      app_metadata: { tenant_id: tenantId },
      password: PASSWORD,
      email_confirm: true,
    });
    console.log(`• Auth user ${spec.email} ya existía — reuso ${authUserId} (password/email_confirm re-seteados)`);
  } else {
    authUserId = created.user.id;
    console.log(`✓ Auth user ${spec.email} creado → ${authUserId}`);
  }

  // 3. Asegurar la fila en `usuarios`.
  //
  // La idempotencia va por el PK (`usuarios.id` = auth user id), NO por
  // (tenant_id, email): `supabase/seed.sql` ya pudo haber creado la fila de
  // admin@demo.local, y buscarla filtrando por un tenant distinto la deja
  // invisible → el INSERT choca contra `usuarios_pkey` y el seed muere. El
  // upsert por id además repara una fila que haya quedado en el tenant
  // equivocado, en vez de dejar el entorno a medio sembrar.
  const { data: existeUsuario, error: usuSelErr } = await db
    .from("usuarios")
    .select("id, tenant_id")
    .eq("id", authUserId)
    .maybeSingle();
  if (usuSelErr) die("No pude consultar usuarios", usuSelErr);

  const { error: upsertErr } = await db.from("usuarios").upsert(
    {
      id: authUserId,
      tenant_id: tenantId,
      username: spec.username,
      email: spec.email,
      full_name: spec.fullName,
      rol_id: rol.id,
      active: true,
    },
    { onConflict: "id" },
  );
  if (upsertErr) die(`No pude asegurar la fila usuarios de ${spec.email}`, upsertErr);

  if (!existeUsuario) {
    console.log(`  ↳ fila usuarios creada (${spec.roleName})`);
  } else if (existeUsuario.tenant_id !== tenantId) {
    console.log(`  ↳ fila usuarios reapuntada al tenant demo (${spec.roleName})`);
  } else {
    console.log(`  ↳ fila usuarios ya existía (${spec.roleName})`);
  }

  // 4. Veterinario → asegurar fila en `doctores` (replicando UsuariosService.crear).
  if (spec.roleName === "veterinario") {
    const { data: existeDoctor, error: docSelErr } = await db
      .from("doctores")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", authUserId)
      .maybeSingle();
    if (docSelErr) die("No pude consultar doctores", docSelErr);
    if (!existeDoctor) {
      const { error: docErr } = await db.from("doctores").insert({
        tenant_id: tenantId,
        user_id: authUserId,
        name: spec.fullName,
        available: true,
      });
      if (docErr) die("No pude insertar la fila doctores", docErr);
      console.log("  ↳ fila doctores creada");
    } else {
      console.log("  ↳ fila doctores ya existía");
    }
  }
}

/**
 * Cachea ids de especie/raza por (tenant, nombre).
 *
 * El catálogo clínico es POR TENANT desde
 * 20260827000001_catalogos_por_tenant.sql. Dos consecuencias para este script:
 * la búsqueda lleva `.eq("tenant_id", ...)` —sin él, `.single()` sobre un nombre
 * que se repite en varias clínicas devuelve error, no una fila— y la clave del
 * cache incluye el tenant.
 */
const especieCache = new Map();
const razaCache = new Map();

async function especieIdPorNombre(tenantId, nombre) {
  const key = `${tenantId}::${nombre}`;
  if (especieCache.has(key)) return especieCache.get(key);
  const { data, error } = await db
    .from("especies").select("id")
    .eq("tenant_id", tenantId).eq("name", nombre)
    .single();
  if (error || !data) die(`Especie "${nombre}" no está en el catálogo de este tenant (¿corriste las migraciones?)`, error);
  especieCache.set(key, data.id);
  return data.id;
}

async function razaIdPorNombre(tenantId, especieId, nombre) {
  const key = `${tenantId}::${especieId}::${nombre}`;
  if (razaCache.has(key)) return razaCache.get(key);
  const { data, error } = await db
    .from("razas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("especie_id", especieId)
    .eq("name", nombre)
    .single();
  if (error || !data) die(`Raza "${nombre}" no está en el catálogo de este tenant`, error);
  razaCache.set(key, data.id);
  return data.id;
}

/** Asegura clientes y sus mascotas (idempotente). */
async function ensureDemoData(tenantId) {
  for (const cli of CLIENTES) {
    // Cliente — idempotente por UNIQUE(tenant_id, dni_cuit).
    let clienteId;
    const { data: existeCli, error: cliSelErr } = await db
      .from("clientes")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("dni_cuit", cli.dniCuit)
      .maybeSingle();
    if (cliSelErr) die("No pude consultar clientes", cliSelErr);

    if (existeCli) {
      clienteId = existeCli.id;
      console.log(`• Cliente "${cli.fullName}" ya existe — reuso ${clienteId}`);
    } else {
      const { data: nuevo, error: cliInsErr } = await db
        .from("clientes")
        .insert({
          tenant_id: tenantId,
          full_name: cli.fullName,
          dni_cuit: cli.dniCuit,
          phone: cli.phone,
          address: cli.address,
          email: cli.email,
        })
        .select("id")
        .single();
      if (cliInsErr) die(`No pude insertar el cliente ${cli.fullName}`, cliInsErr);
      clienteId = nuevo.id;
      console.log(`✓ Cliente "${cli.fullName}" creado → ${clienteId}`);
    }

    // Mascotas — idempotente por (tenant_id, name, client_id).
    for (const m of cli.mascotas) {
      const { data: existeMas, error: masSelErr } = await db
        .from("mascotas")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("client_id", clienteId)
        .eq("name", m.name)
        .maybeSingle();
      if (masSelErr) die("No pude consultar mascotas", masSelErr);
      if (existeMas) {
        console.log(`  ↳ mascota "${m.name}" ya existía`);
        continue;
      }

      const especieId = await especieIdPorNombre(tenantId, m.especie);
      const razaId = await razaIdPorNombre(tenantId, especieId, m.raza);
      const { error: masInsErr } = await db.from("mascotas").insert({
        tenant_id: tenantId,
        name: m.name,
        client_id: clienteId,
        especie_id: especieId,
        raza_id: razaId,
        sex: m.sex,
        tamano: m.tamano,
        alimento_dieta: m.alimentoDieta,
        estado: "Activa",
      });
      if (masInsErr) die(`No pude insertar la mascota ${m.name}`, masInsErr);
      console.log(`  ↳ mascota "${m.name}" creada (${m.especie}/${m.raza})`);
    }
  }
}

// Servicio demo con profesional requerido (necesario para el flujo de agendar
// turno, que sin slots disponibles no se puede probar de punta a punta) y
// horario amplio del veterinario demo que cubra cualquier día en que corran
// las pruebas E2E (RN-TU/RN-HOR — Etapa 9 S9).
const SERVICIO = {
  nombre: "Consulta general",
  descripcion: "Consulta clínica general",
  duracionMinutos: 30,
  requiereProfesional: true,
  tipo: "clinica",
};

/** Asegura el servicio demo y un horario semanal completo para vet_demo (idempotente). */
async function ensureServicioYHorario(tenantId) {
  // Servicio — idempotente por el índice único (tenant_id, lower(nombre)) WHERE activo.
  const { data: existeServicio, error: svSelErr } = await db
    .from("servicios")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("nombre", SERVICIO.nombre)
    .maybeSingle();
  if (svSelErr) die("No pude consultar servicios", svSelErr);

  if (existeServicio) {
    console.log(`• Servicio "${SERVICIO.nombre}" ya existe — reuso ${existeServicio.id}`);
  } else {
    const { data: nuevo, error: svInsErr } = await db
      .from("servicios")
      .insert({
        tenant_id:            tenantId,
        nombre:               SERVICIO.nombre,
        descripcion:          SERVICIO.descripcion,
        duracion_minutos:     SERVICIO.duracionMinutos,
        requiere_profesional: SERVICIO.requiereProfesional,
        tipo:                 SERVICIO.tipo,
        activo:               true,
      })
      .select("id")
      .single();
    if (svInsErr) die("No pude insertar el servicio demo", svInsErr);
    console.log(`✓ Servicio "${SERVICIO.nombre}" creado → ${nuevo.id}`);
  }

  // Horario — resolver el doctor de vet_demo (usuarios.id === auth user id).
  const vet = USERS.find((u) => u.roleName === "veterinario");
  const authUser = await findAuthUserByEmail(vet.email);
  if (!authUser) die(`No pude resolver el auth user de ${vet.email} para el horario demo`);

  const { data: doctor, error: docSelErr } = await db
    .from("doctores")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", authUser.id)
    .single();
  if (docSelErr || !doctor) die(`No encontré la fila doctores de ${vet.email}`, docSelErr);

  // Franja amplia L-D 08:00-20:00: cubre cualquier día de la semana en que
  // corran los tests E2E, sin depender de qué día se ejecute la suite.
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const { data: existeFranja, error: franjaSelErr } = await db
      .from("horarios_doctor")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctor.id)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();
    if (franjaSelErr) die("No pude consultar horarios_doctor", franjaSelErr);
    if (existeFranja) continue;

    const { error: franjaInsErr } = await db.from("horarios_doctor").insert({
      tenant_id:   tenantId,
      doctor_id:   doctor.id,
      day_of_week: dayOfWeek,
      start_time:  "08:00",
      end_time:    "20:00",
      active:      true,
    });
    if (franjaInsErr) die(`No pude insertar el horario del día ${dayOfWeek}`, franjaInsErr);
  }
  console.log(`✓ Horario semanal (L-D 08:00-20:00) asegurado para ${vet.email}`);
}

// ---------------------------------------------------------------------------
// Datos operativos de demo — los 3 módulos vendibles con contenido presentable
// (Etapa 9 — S11). Historial, turnos, guardería y plan de vacunación dejan de
// estar vacíos en el entorno demo.
//
// IDEMPOTENCIA con fechas frescas: las filas demo se identifican por sus
// textos EXACTOS (reason/description/notas de las listas de abajo); en cada
// corrida se borran y reinsertan con fechas relativas a HOY, así la demo
// nunca "envejece". Los tests E2E usan textos únicos por corrida
// ("... E2E <timestamp>"), por lo que el borrado no puede alcanzarlos.
//
// SIN COLISIÓN con la suite E2E: los specs agendan con fechaUnica(offset)
// (mínimo +10 días para vacunación, +30 turnos, +100 guardería); toda la
// demo vive en ±12 días de hoy. Además guardería demo evita los pares
// pet+estado que los specs localizan por fila (Rocky Reservada/EnCurso/
// Finalizada la crea y assertea guarderia.spec.ts).
//
// Inserción directa con service role (sin auditoría): es contenido de demo,
// no una escritura de usuario (RN-S3). La única excepción es la eutanasia de
// "Luna", que usa el RPC real `registrar_eutanasia` (transacción completa:
// evento + Fallecida + dosis cancelada RN-PV4 + asiento de auditoría) y por
// ser irreversible se ejecuta UNA sola vez (si Luna existe, no se toca).
// ---------------------------------------------------------------------------

/** YYYY-MM-DD a N días de hoy (negativo = pasado). */
function fechaRel(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp a N días de hoy, a una hora dada. */
function timestampRel(dias, hora) {
  return `${fechaRel(dias)}T${hora}:00Z`;
}

const DEMO_TURNOS_REASONS = [
  "Control anual",
  "Vacunación de refuerzo",
  "Consulta por control de peso",
  "Primera consulta del cachorro",
];
const DEMO_ESTADIAS_REASONS = [
  "Vacaciones del dueño",
  "Guardería por viaje de trabajo",
];
const DEMO_HISTORIAL_DESCRIPCIONES = [
  "Consulta por otitis: revisión y limpieza de oído",
  "Control de rutina: peso y estado general",
  "Aplicación de vacuna Triple Felina",
];
const DEMO_DOSIS_NOTAS = [
  "Aplicada en consulta de rutina",
  "Refuerzo anual antirrábico",
  "Refuerzo anual antirrábico canino",
];

async function tipoVacunaIdPorNombre(tenantId, nombre) {
  const { data, error } = await db
    .from("tipos_vacuna").select("id")
    .eq("tenant_id", tenantId).eq("nombre", nombre)
    .single();
  if (error || !data) die(`Tipo de vacuna "${nombre}" no está en el catálogo de este tenant`, error);
  return data.id;
}

/** Resuelve los ids que el bloque demo necesita (clientes, mascotas, vet, servicio). */
async function resolverContextoDemo(tenantId) {
  const porDni = async (dni) => {
    const { data, error } = await db
      .from("clientes").select("id, full_name")
      .eq("tenant_id", tenantId).eq("dni_cuit", dni).single();
    if (error || !data) die(`No encontré el cliente demo con DNI ${dni}`, error);
    return data;
  };
  const juana = await porDni(CLIENTES[0].dniCuit);
  const carlos = await porDni(CLIENTES[1].dniCuit);

  const mascotaPorNombre = async (clienteId, name) => {
    const { data, error } = await db
      .from("mascotas").select("id")
      .eq("tenant_id", tenantId).eq("client_id", clienteId).eq("name", name).single();
    if (error || !data) die(`No encontré la mascota demo "${name}"`, error);
    return data.id;
  };
  const firulais = await mascotaPorNombre(juana.id, "Firulais");
  const michi    = await mascotaPorNombre(juana.id, "Michi");

  const usuarioPorEmail = async (email) => {
    const { data, error } = await db
      .from("usuarios").select("id")
      .eq("tenant_id", tenantId).eq("email", email).single();
    if (error || !data) die(`No encontré el usuario demo ${email}`, error);
    return data.id;
  };
  const vetId   = await usuarioPorEmail("vet@demo.local");
  const adminId = await usuarioPorEmail("admin@demo.local");

  const { data: doctor, error: docErr } = await db
    .from("doctores").select("id")
    .eq("tenant_id", tenantId).eq("user_id", vetId).single();
  if (docErr || !doctor) die("No encontré la fila doctores del vet demo", docErr);

  const { data: servicio, error: svErr } = await db
    .from("servicios").select("id")
    .eq("tenant_id", tenantId).ilike("nombre", SERVICIO.nombre).single();
  if (svErr || !servicio) die("No encontré el servicio demo", svErr);

  return { juana, carlos, firulais, michi, vetId, adminId, doctorId: doctor.id, servicioId: servicio.id };
}

/** Borra la tanda demo anterior (por textos exactos) para reinsertar con fechas frescas. */
async function purgarDemoPrevia(tenantId) {
  // Orden por FK/CHECK: una dosis 'Aplicada' referencia su evento de historial
  // (ON DELETE SET NULL violaría el CHECK de plan_vacunacion) → dosis primero.
  const pasos = [
    ["plan_vacunacion",  (q) => q.in("notas", DEMO_DOSIS_NOTAS)],
    ["historial_clinico", (q) => q.in("description", DEMO_HISTORIAL_DESCRIPCIONES)],
    ["turnos",           (q) => q.in("reason", DEMO_TURNOS_REASONS)],
    ["estadias",         (q) => q.in("reason", DEMO_ESTADIAS_REASONS)],
  ];
  for (const [tabla, filtro] of pasos) {
    const { error } = await filtro(db.from(tabla).delete().eq("tenant_id", tenantId));
    if (error) die(`No pude purgar la tanda demo previa de ${tabla}`, error);
  }
}

/** Siembra historial, turnos, estadías y plan de vacunación de demo. */
async function ensureDemoOperativa(tenantId) {
  const ctx = await resolverContextoDemo(tenantId);
  await purgarDemoPrevia(tenantId);

  // — Historial clínico (pasado) —
  const eventos = [
    {
      pet_id: ctx.firulais, date: fechaRel(-90), event_type: "Consulta",
      description: DEMO_HISTORIAL_DESCRIPCIONES[0],
      weight_kg: 22.5, temperature_c: 38.5,
      diagnosis: "Otitis externa leve", treatment: "Limpieza ótica + gotas por 7 días",
      cliente: ctx.juana,
    },
    {
      pet_id: ctx.firulais, date: fechaRel(-7), event_type: "Control",
      description: DEMO_HISTORIAL_DESCRIPCIONES[1],
      weight_kg: 23.1, temperature_c: 38.2,
      cliente: ctx.juana,
    },
    {
      pet_id: ctx.michi, date: fechaRel(-30), event_type: "Vacunación",
      description: DEMO_HISTORIAL_DESCRIPCIONES[2],
      weight_kg: 4.2,
      cliente: ctx.juana,
    },
  ];
  const eventoIds = [];
  for (const ev of eventos) {
    const { cliente, ...campos } = ev;
    const { data, error } = await db.from("historial_clinico").insert({
      tenant_id: tenantId,
      professional_id: ctx.vetId,
      service_id: ctx.servicioId,
      client_id_at_time: cliente.id,
      client_name_at_time: cliente.full_name,
      ...campos,
    }).select("id").single();
    if (error) die("No pude insertar un evento clínico demo", error);
    eventoIds.push(data.id);
  }
  console.log(`✓ Historial demo: ${eventos.length} eventos (Firulais ×2, Michi ×1)`);

  // — Plan de vacunación —
  const tripleFelina = await tipoVacunaIdPorNombre(tenantId, "Triple Felina");
  const antirrabica  = await tipoVacunaIdPorNombre(tenantId, "Antirrábica");
  const dosis = [
    // Aplicada: linkea el evento 'Vacunación' de Michi (CHECK de la tabla).
    {
      pet_id: ctx.michi, tipo_vacuna_id: tripleFelina, fecha_estimada: fechaRel(-30),
      estado: "Aplicada", evento_aplicacion_id: eventoIds[2], notas: DEMO_DOSIS_NOTAS[0],
    },
    { pet_id: ctx.michi, tipo_vacuna_id: antirrabica, fecha_estimada: fechaRel(20),
      estado: "Pendiente", notas: DEMO_DOSIS_NOTAS[1] },
    { pet_id: ctx.firulais, tipo_vacuna_id: antirrabica, fecha_estimada: fechaRel(45),
      estado: "Pendiente", notas: DEMO_DOSIS_NOTAS[2] },
  ];
  for (const d of dosis) {
    const { error } = await db.from("plan_vacunacion").insert({
      tenant_id: tenantId, created_by: ctx.vetId, ...d,
    });
    if (error) die("No pude insertar una dosis demo", error);
  }
  console.log("✓ Vacunación demo: 1 aplicada (Michi) + 2 pendientes (Michi +20d, Firulais +45d)");

  // — Turnos (pasados Completado, hoy Confirmado, futuro Programado) —
  // Los specs E2E agendan a ≥ +30 días (fechaUnica), nunca en esta ventana.
  const { data: rocky, error: rockyErr } = await db
    .from("mascotas").select("id")
    .eq("tenant_id", tenantId).eq("client_id", ctx.carlos.id).eq("name", "Rocky").single();
  if (rockyErr || !rocky) die("No encontré la mascota demo Rocky", rockyErr);

  const turnos = [
    { cliente: ctx.juana,  pet_id: ctx.firulais, date: fechaRel(-7), start: "10:00", end: "10:30",
      status: "Completado", reason: DEMO_TURNOS_REASONS[0] },
    { cliente: ctx.carlos, pet_id: rocky.id,     date: fechaRel(-2), start: "11:00", end: "11:30",
      status: "Completado", reason: DEMO_TURNOS_REASONS[1] },
    { cliente: ctx.juana,  pet_id: ctx.michi,    date: fechaRel(0),  start: "16:00", end: "16:30",
      status: "Confirmado", reason: DEMO_TURNOS_REASONS[2] },
    { cliente: ctx.juana,  pet_id: ctx.firulais, date: fechaRel(3),  start: "09:30", end: "10:00",
      status: "Programado", reason: DEMO_TURNOS_REASONS[3] },
  ];
  for (const t of turnos) {
    const { error } = await db.from("turnos").insert({
      tenant_id:   tenantId,
      client_id:   t.cliente.id,
      pet_id:      t.pet_id,
      servicio_id: ctx.servicioId,
      doctor_id:   ctx.doctorId,
      date:        t.date,
      start_time:  t.start,
      end_time:    t.end,
      status:      t.status,
      reason:      t.reason,
    });
    if (error) die("No pude insertar un turno demo", error);
  }
  console.log("✓ Turnos demo: 2 completados, 1 hoy confirmado, 1 programado (+3d)");

  // — Guardería —
  // Rocky NO se usa: guarderia.spec.ts localiza sus filas por "pet + estado" y
  // una segunda fila igual rompería el strict mode de Playwright.
  const estadias = [
    // Finalizada (terminal: fuera del GIST y del conteo de cupo).
    {
      pet_id: ctx.firulais, client_id: ctx.juana.id,
      check_in_date: fechaRel(-12), check_out_date: fechaRel(-9), status: "Finalizada",
      reason: DEMO_ESTADIAS_REASONS[0],
      checked_in_at: timestampRel(-12, "09:00"), checked_out_at: timestampRel(-9, "18:00"),
    },
    // En curso: check-in ayer, sale en 2 días.
    {
      pet_id: ctx.michi, client_id: ctx.juana.id,
      check_in_date: fechaRel(-1), check_out_date: fechaRel(2), status: "EnCurso",
      reason: DEMO_ESTADIAS_REASONS[1],
      checked_in_at: timestampRel(-1, "09:30"),
    },
  ];
  for (const e of estadias) {
    const { error } = await db.from("estadias").insert({ tenant_id: tenantId, ...e });
    if (error) die("No pude insertar una estadía demo", error);
  }
  console.log("✓ Guardería demo: 1 finalizada (Firulais) + 1 en curso (Michi, sale +2d)");
}

/**
 * "Luna": mascota fallecida por eutanasia vía el RPC REAL (`registrar_eutanasia`),
 * para que la demo muestre el badge Fallecida, el evento en el timeline y la
 * dosis Cancelada (RN-PV4). Irreversible por diseño → solo si Luna no existe;
 * sus filas (evento, dosis cancelada, asiento) nunca se purgan.
 */
async function ensureLunaEutanasia(tenantId) {
  const ctx = await resolverContextoDemo(tenantId);

  const { data: existe, error: selErr } = await db
    .from("mascotas").select("id")
    .eq("tenant_id", tenantId).eq("client_id", ctx.carlos.id).eq("name", "Luna")
    .maybeSingle();
  if (selErr) die("No pude consultar la mascota Luna", selErr);
  if (existe) {
    console.log("• Luna (fallecida) ya existe — no se toca (irreversible)");
    return;
  }

  const especieId = await especieIdPorNombre(tenantId, "Perro");
  const razaId = await razaIdPorNombre(tenantId, especieId, "Mestizo");
  const { data: luna, error: insErr } = await db.from("mascotas").insert({
    tenant_id: tenantId, name: "Luna", client_id: ctx.carlos.id,
    especie_id: especieId, raza_id: razaId,
    sex: "Hembra", tamano: "Pequeño", alimento_dieta: "Balanceado senior",
    estado: "Activa",
  }).select("id").single();
  if (insErr) die("No pude crear la mascota Luna", insErr);

  // Historia mínima previa + dosis Pendiente que la eutanasia cancelará (RN-PV4).
  const { error: evErr } = await db.from("historial_clinico").insert({
    tenant_id: tenantId, pet_id: luna.id, professional_id: ctx.vetId,
    service_id: ctx.servicioId, date: fechaRel(-40), event_type: "Consulta",
    description: "Consulta por decaimiento y pérdida de apetito",
    weight_kg: 6.8, diagnosis: "Insuficiencia renal crónica avanzada",
    client_id_at_time: ctx.carlos.id, client_name_at_time: ctx.carlos.full_name,
  });
  if (evErr) die("No pude insertar la consulta previa de Luna", evErr);

  const quintuple = await tipoVacunaIdPorNombre(tenantId, "Quíntuple Canina");
  const { error: dosisErr } = await db.from("plan_vacunacion").insert({
    tenant_id: tenantId, pet_id: luna.id, tipo_vacuna_id: quintuple,
    fecha_estimada: fechaRel(30), estado: "Pendiente", created_by: ctx.vetId,
    notas: "Refuerzo programado antes del diagnóstico",
  });
  if (dosisErr) die("No pude insertar la dosis pendiente de Luna", dosisErr);

  const { error: rpcErr } = await db.rpc("registrar_eutanasia", {
    p_tenant_id:       tenantId,
    p_pet_id:          luna.id,
    p_professional_id: ctx.vetId,
    p_user_id:         ctx.adminId,
    p_date:            fechaRel(-15),
    p_description:     "Eutanasia humanitaria por insuficiencia renal terminal, con consentimiento del dueño",
    p_confirmed:       true,
    p_weight_kg:       6.1,
    p_diagnosis:       "Insuficiencia renal crónica terminal",
  });
  if (rpcErr) die("registrar_eutanasia (RPC) falló para Luna", rpcErr);
  console.log("✓ Luna creada y eutanasiada vía RPC real (evento + Fallecida + dosis cancelada RN-PV4)");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`▶ Sembrando entorno de DEV contra ${SUPABASE_URL}\n`);

  const tenantId = await ensureTenant();

  console.log("\n— Usuarios —");
  for (const u of USERS) await ensureUser(tenantId, u);
  await ensureSuperAdmin();

  console.log("\n— Datos demo —");
  await ensureDemoData(tenantId);

  console.log("\n— Turnos (servicio + horario) —");
  await ensureServicioYHorario(tenantId);

  console.log("\n— Demo operativa (historial, turnos, guardería, vacunación) —");
  await ensureDemoOperativa(tenantId);
  await ensureLunaEutanasia(tenantId);

  console.log("\n✓ Seed completo. Credenciales (todas con password " + PASSWORD + "):");
  for (const u of USERS) console.log(`    ${u.roleName.padEnd(13)} ${u.email}`);
  console.log(
    `\n  Consola de plataforma (/admin/login): ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`,
  );
  console.log("");
}

main().catch((err) => die("Seed falló", err));
