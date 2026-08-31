/**
 * Inventario y baja de SUPER ADMINS de plataforma — `node scripts/super-admins.mjs`.
 *
 * Complemento de `scripts/crear-super-admin.mjs`: aquel CREA o REPARA una
 * cuenta, éste permite VER quiénes tienen acceso de plataforma y sacárselo.
 *
 * POR QUÉ HACE FALTA: el acceso de plataforma es el claim
 * `app_metadata.platform_role = 'super_admin'`, y el dashboard de Supabase no
 * muestra `app_metadata` en el listado de Authentication → Users. Sin esto, para
 * saber quién es Super Admin hay que abrir usuario por usuario, y "limpiar el
 * anterior" termina siendo a ojo. El claim solo se lee y escribe con la
 * service_role key, nunca desde el browser.
 *
 * SUBCOMANDOS
 *   list                    (default) lista las cuentas con el claim
 *   revoke <email>          saca el claim y deja la cuenta (reversible)
 *   delete <email>          borra la cuenta de Auth (irreversible)
 *
 * REVOKE vs DELETE: `revoke` es lo que se quiere casi siempre — deja el usuario
 * de Auth en pie, así que un id que aparezca en `registros_auditoria.user_id`
 * sigue siendo resoluble, y volver a darle acceso es re-correr
 * crear-super-admin.mjs. `delete` es para una cuenta que no debería existir
 * (un email de prueba, uno mal escrito). Ninguno de los dos toca la auditoría:
 * `registros_auditoria.user_id` no tiene FK a `auth.users`, así que los
 * registros históricos quedan intactos — que es exactamente lo que se espera de
 * un log append-only (RN-S3).
 *
 * GUARDA DE LOCKOUT: se niega a dejar la plataforma sin ningún Super Admin. No
 * hay camino de recuperación por la aplicación —`platform_role` solo se escribe
 * con la service_role key—, así que quedarse sin ninguno significa perder la
 * consola hasta volver a correr un script con esa llave. Se puede forzar con
 * `--force` si es deliberado.
 *
 * USO
 *   # DEV local: toma las variables del .env (acepta las TEST_*)
 *   node scripts/super-admins.mjs list
 *
 *   # Producción: con las variables del entorno destino
 *   export SUPABASE_URL="https://<ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
 *   node scripts/super-admins.mjs list
 *   node scripts/super-admins.mjs revoke viejo@leo.vet
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Carga de entorno (.env → process.env, sin pisar lo ya presente), con el mismo
// criterio que scripts/seed.mjs y scripts/crear-super-admin.mjs.
function loadEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!process.env[key]) process.env[key] = trimmed.slice(eqIdx + 1).trim();
    }
  } catch {
    // .env opcional — las vars pueden venir del entorno.
  }
}
loadEnv();

const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? process.env["TEST_SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"];

function die(msg, err) {
  console.error(`✖ ${msg}${err ? `: ${err.message ?? err}` : ""}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }, // Node < 22 no trae WebSocket nativo.
});

const esSuperAdmin = (u) => (u.app_metadata ?? {}).platform_role === "super_admin";

/** Todas las cuentas de Auth, paginadas. */
async function listarAuthUsers() {
  const todos = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die("listUsers falló", error);
    todos.push(...data.users);
    if (data.users.length < 200) break;
  }
  return todos;
}

async function listarSuperAdmins() {
  return (await listarAuthUsers()).filter(esSuperAdmin);
}

function imprimir(supers) {
  if (supers.length === 0) {
    console.log("⚠ No hay ninguna cuenta con platform_role='super_admin'.");
    console.log("  La consola /admin/* es inaccesible hasta crear una con:");
    console.log("  SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… node scripts/crear-super-admin.mjs");
    return;
  }
  console.log(`Super Admins de plataforma (${supers.length}):\n`);
  for (const u of supers) {
    const ultimo = u.last_sign_in_at
      ? new Date(u.last_sign_in_at).toISOString().slice(0, 16).replace("T", " ")
      : "nunca";
    const confirmado = u.email_confirmed_at ? "confirmado" : "SIN CONFIRMAR";
    console.log(`  ${u.email}`);
    console.log(`    id            ${u.id}`);
    console.log(`    creado        ${new Date(u.created_at).toISOString().slice(0, 10)}`);
    console.log(`    último login  ${ultimo}`);
    console.log(`    email         ${confirmado}\n`);
  }
}

/** Resuelve la cuenta objetivo y aplica la guarda de lockout. */
async function resolverObjetivo(email, accion, force) {
  const supers = await listarSuperAdmins();
  const objetivo = supers.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());

  if (!objetivo) {
    const otros = await listarAuthUsers();
    const existePeroNoEsSuper = otros.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (existePeroNoEsSuper) {
      die(`${email} existe en Auth pero NO tiene platform_role='super_admin' (nada que ${accion}).`);
    }
    die(`No existe ninguna cuenta de Auth con el email ${email}.`);
  }

  if (supers.length === 1 && !force) {
    die(
      `${email} es el ÚNICO Super Admin: ${accion} lo dejaría a la plataforma sin consola, ` +
      `y no hay forma de recuperarla desde la aplicación (platform_role solo se escribe con ` +
      `la service_role key). Creá primero el reemplazo con crear-super-admin.mjs y verificá ` +
      `que entra por /admin/login, o repetí el comando con --force si es deliberado.`,
    );
  }

  return objetivo;
}

async function revoke(email, force) {
  const objetivo = await resolverObjetivo(email, "revocarle el acceso", force);

  // Se saca SOLO platform_role y se conserva el resto de app_metadata.
  const { platform_role: _quitado, ...resto } = objetivo.app_metadata ?? {};
  const { error } = await db.auth.admin.updateUserById(objetivo.id, { app_metadata: { ...resto, platform_role: null } });
  if (error) die(`No pude revocar el claim de ${email}`, error);

  console.log(`✓ Acceso de plataforma revocado a ${email} (${objetivo.id}).`);
  console.log("  La cuenta de Auth sigue existiendo; la auditoría no se tocó.");
  console.log("  Para devolvérselo: crear-super-admin.mjs con ese mismo email.");
}

async function borrar(email, force) {
  const objetivo = await resolverObjetivo(email, "borrarla", force);

  const { error } = await db.auth.admin.deleteUser(objetivo.id);
  if (error) die(`No pude borrar ${email}`, error);

  console.log(`✓ Cuenta ${email} (${objetivo.id}) borrada de Auth.`);
  console.log("  Los registros de auditoría que la mencionan quedan intactos:");
  console.log("  registros_auditoria.user_id no tiene FK a auth.users (log append-only).");
}

async function main() {
  const args   = process.argv.slice(2).filter((a) => a !== "--force");
  const force  = process.argv.includes("--force");
  const [cmd = "list", email] = args;

  console.log(`▶ ${SUPABASE_URL}\n`);

  if (cmd === "list") return imprimir(await listarSuperAdmins());

  if (cmd === "revoke" || cmd === "delete") {
    if (!email) die(`Falta el email: node scripts/super-admins.mjs ${cmd} <email>`);
    return cmd === "revoke" ? revoke(email, force) : borrar(email, force);
  }

  die(`Subcomando desconocido "${cmd}". Usá: list | revoke <email> | delete <email>`);
}

main().catch((err) => die("Falló", err));
