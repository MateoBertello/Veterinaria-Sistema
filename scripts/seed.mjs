/**
 * Seeder de entorno de DESARROLLO (local) — `npm run seed`.
 *
 * Deja un entorno listo para usar/probar contra el stack LOCAL:
 *   1. Un tenant demo provisionado por el CAMINO REAL (RPC `crear_tenant` →
 *      `on_tenant_created`: roles, permisos, configuración y módulos).
 *   2. Un usuario por cada rol (admin/veterinario/recepcionista) con credenciales
 *      conocidas, creados vía Auth admin API con `app_metadata.tenant_id` correcto.
 *   3. Datos demo por tenant (clientes con mascotas) usando los catálogos globales
 *      (`especies`/`razas`) que ya siembra `seed_global.sql` como migración.
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
const TENANT = {
  nombre: "Veterinaria Demo",
  cuitRut: "20999999999",
  emailContacto: "contacto@demo.local",
  plan: "premium", // habilita los 3 módulos vendibles
};

const PASSWORD = "Demo1234!";
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

  // 3. Asegurar la fila en `usuarios` (idempotente por email dentro del tenant).
  const { data: existeUsuario, error: usuSelErr } = await db
    .from("usuarios")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("email", spec.email)
    .maybeSingle();
  if (usuSelErr) die("No pude consultar usuarios", usuSelErr);

  if (!existeUsuario) {
    const { error: insErr } = await db.from("usuarios").insert({
      id: authUserId,
      tenant_id: tenantId,
      username: spec.username,
      email: spec.email,
      full_name: spec.fullName,
      rol_id: rol.id,
      active: true,
    });
    if (insErr) die(`No pude insertar la fila usuarios de ${spec.email}`, insErr);
    console.log(`  ↳ fila usuarios creada (${spec.roleName})`);
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

/** Cachea ids de especie/raza por nombre. */
const especieCache = new Map();
const razaCache = new Map();

async function especieIdPorNombre(nombre) {
  if (especieCache.has(nombre)) return especieCache.get(nombre);
  const { data, error } = await db.from("especies").select("id").eq("name", nombre).single();
  if (error || !data) die(`Especie "${nombre}" no está en el catálogo global (¿corriste las migraciones?)`, error);
  especieCache.set(nombre, data.id);
  return data.id;
}

async function razaIdPorNombre(especieId, nombre) {
  const key = `${especieId}::${nombre}`;
  if (razaCache.has(key)) return razaCache.get(key);
  const { data, error } = await db
    .from("razas")
    .select("id")
    .eq("especie_id", especieId)
    .eq("name", nombre)
    .single();
  if (error || !data) die(`Raza "${nombre}" no está en el catálogo global`, error);
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

      const especieId = await especieIdPorNombre(m.especie);
      const razaId = await razaIdPorNombre(especieId, m.raza);
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`▶ Sembrando entorno de DEV contra ${SUPABASE_URL}\n`);

  const tenantId = await ensureTenant();

  console.log("\n— Usuarios —");
  for (const u of USERS) await ensureUser(tenantId, u);

  console.log("\n— Datos demo —");
  await ensureDemoData(tenantId);

  console.log("\n✓ Seed completo. Credenciales (todas con password " + PASSWORD + "):");
  for (const u of USERS) console.log(`    ${u.roleName.padEnd(13)} ${u.email}`);
  console.log("");
}

main().catch((err) => die("Seed falló", err));
