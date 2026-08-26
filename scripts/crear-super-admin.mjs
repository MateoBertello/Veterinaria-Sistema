/**
 * Provisión del SUPER ADMIN de plataforma — `node scripts/crear-super-admin.mjs`.
 *
 * El Super Admin opera FUERA de todo tenant: es un usuario de Supabase Auth con
 * `app_metadata.platform_role = 'super_admin'` (lo exige el middleware
 * `requireSuperAdmin` y la función SQL `is_super_admin()`), SIN fila en
 * `usuarios` y SIN `tenant_id`.
 *
 * Este script CREA la cuenta; NO es la forma de entrar. Para entrar está
 * `/admin/login` en la aplicación, que habla con `POST /api/v1/admin/auth/login`
 * y deja una sesión normal —con refresh token— que se renueva sola.
 *
 * Hasta que ese login existió, el script imprimía un access_token y había que
 * pegarlo a mano en `localStorage.sb-token`. Esa sesión venía sin refresh token,
 * así que moría a la hora exacta (`jwt_expiry = 3600`) y había que volver a
 * correr el script; además compartía clave con la sesión de la clínica, así que
 * cualquier 401 de la API del tenant la borraba. Nada de eso se hace más: el
 * script no emite tokens.
 *
 * `platform_role` solo se puede escribir con la service_role key —nunca desde el
 * browser—, y eso es justamente lo que hace este script.
 *
 * Idempotente: re-correrlo repara password, confirmación y el claim de plataforma.
 *
 * Uso (DEV local: alcanza con el `.env` del repo):
 *   SUPER_ADMIN_EMAIL=super@leo.local SUPER_ADMIN_PASSWORD=Super1234! \
 *     node scripts/crear-super-admin.mjs
 *
 * En producción, con las variables del entorno destino:
 *   export SUPABASE_URL="https://<ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
 *   export SUPABASE_ANON_KEY="<anon key>"                 # opcional: verifica el login
 *   export SUPER_ADMIN_EMAIL="super@leo.vet"
 *   export SUPER_ADMIN_PASSWORD="una-password-fuerte"
 *   node scripts/crear-super-admin.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Carga de entorno (.env → process.env, sin pisar lo ya presente), con el mismo
// criterio que scripts/seed.mjs y tests/integration/_env.ts: acepta prefijo TEST_.
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
  process.env["SUPABASE_URL"] ?? process.env["TEST_SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"];
const SUPABASE_ANON_KEY =
  process.env["SUPABASE_ANON_KEY"] ?? process.env["TEST_SUPABASE_ANON_KEY"];
const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } = process.env;

function die(msg, err) {
  console.error(`✖ ${msg}${err ? `: ${err.message ?? err}` : ""}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}
for (const [k, v] of Object.entries({ SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD })) {
  if (!v) die(`Falta la variable ${k}.`);
}
if (SUPER_ADMIN_PASSWORD.length < 8) {
  die("SUPER_ADMIN_PASSWORD debe tener al menos 8 caracteres.");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }, // Node < 22 no trae WebSocket nativo.
});

/** Localiza un auth user por email paginando admin.listUsers. */
async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die("listUsers falló", error);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log(`▶ Provisionando Super Admin de plataforma contra ${SUPABASE_URL}\n`);

  // Crear (o reparar) el auth user con el claim de plataforma.
  let userId;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: SUPER_ADMIN_EMAIL,
    password: SUPER_ADMIN_PASSWORD,
    email_confirm: true,
    app_metadata: { platform_role: "super_admin" },
  });

  if (createErr) {
    if (!/already|registered|exists/i.test(createErr.message ?? "")) {
      die(`createUser falló para ${SUPER_ADMIN_EMAIL}`, createErr);
    }
    const existing = await findAuthUserByEmail(SUPER_ADMIN_EMAIL);
    if (!existing) die(`Auth dice que ${SUPER_ADMIN_EMAIL} ya existe pero no pude localizarlo`);
    userId = existing.id;

    // Conserva el resto de app_metadata y (re)afirma el claim de plataforma.
    await db.auth.admin.updateUserById(userId, {
      password: SUPER_ADMIN_PASSWORD,
      email_confirm: true,
      app_metadata: { ...(existing.app_metadata ?? {}), platform_role: "super_admin" },
    });
    console.log(`• Auth user ya existía → ${userId} (password/confirm/claim re-seteados)`);
  } else {
    userId = created.user.id;
    console.log(`✓ Auth user creado → ${userId}`);
  }

  // El Super Admin NO lleva fila en `usuarios` (no pertenece a ningún tenant):
  // si hubiera una, su JWT llevaría tenant_id y dejaría de ser identidad de
  // plataforma pura. Se avisa, no se borra nada.
  const { data: fila } = await db
    .from("usuarios")
    .select("id, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (fila) {
    console.log(
      `⚠ Este usuario TAMBIÉN tiene fila en 'usuarios' (tenant ${fila.tenant_id}). ` +
      `Revisalo: el Super Admin debería vivir fuera de todo tenant.`,
    );
  }

  console.log(`\n✅ Super Admin listo: ${SUPER_ADMIN_EMAIL}`);

  if (!SUPABASE_ANON_KEY) {
    console.log(
      "\nℹ Exportá SUPABASE_ANON_KEY y volvé a correr el script si querés que además\n" +
      "  verifique que la cuenta puede iniciar sesión en la consola.",
    );
  } else {
    // Verificación de extremo a extremo de lo que se acaba de provisionar: que
    // la contraseña sirve Y que el JWT emitido trae el claim. Es exactamente lo
    // que va a comprobar `POST /admin/auth/login`. La sesión se cierra en el
    // acto: este script no reparte tokens.
    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { transport: ws }, // Node < 22 no trae WebSocket nativo.
    });

    const { data: sesion, error: signInErr } = await anonDb.auth.signInWithPassword({
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
    });
    if (signInErr || !sesion?.session) die("La cuenta no pudo iniciar sesión", signInErr);

    const claims = JSON.parse(
      Buffer.from(sesion.session.access_token.split(".")[1], "base64url").toString("utf-8"),
    );
    if (claims?.app_metadata?.platform_role !== "super_admin") {
      die("El JWT emitido NO trae app_metadata.platform_role='super_admin'");
    }

    await anonDb.auth.signOut();
    console.log("✓ Verificado: la cuenta inicia sesión y su JWT acredita plataforma.");
  }

  console.log(
    `\n▶ Entrá por la aplicación: /admin/login (usuario: ${SUPER_ADMIN_EMAIL}).\n` +
    "  La consola renueva la sesión sola con su refresh token; no hay que volver\n" +
    "  a correr este script salvo para crear o reparar la cuenta.",
  );
}

main().catch((err) => die("Falló la provisión", err));
