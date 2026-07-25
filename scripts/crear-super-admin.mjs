/**
 * Provisión del SUPER ADMIN de plataforma — `node scripts/crear-super-admin.mjs`.
 *
 * El Super Admin opera FUERA de todo tenant: es un usuario de Supabase Auth con
 * `app_metadata.platform_role = 'super_admin'` (lo exige el middleware
 * `requireSuperAdmin` y la función SQL `is_super_admin()`), SIN fila en
 * `usuarios` y SIN `tenant_id`. Por eso NO se loguea por `POST /auth/login`
 * (ese endpoint busca por username en `usuarios`): su sesión se obtiene
 * directamente contra Supabase Auth, que es lo que hace este script.
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
 *   export SUPABASE_ANON_KEY="<anon key>"                 # solo para imprimir el token
 *   export SUPER_ADMIN_EMAIL="super@leo.vet"
 *   export SUPER_ADMIN_PASSWORD="una-password-fuerte"
 *   node scripts/crear-super-admin.mjs
 *
 * Al final imprime el access_token y la línea de consola para abrir la consola
 * de plataforma en el navegador (el front lee el JWT de `localStorage.sb-token`).
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
      "  imprima el access_token para abrir la consola en el navegador.",
    );
    return;
  }

  // Sesión de plataforma: password grant contra Supabase Auth (GoTrue). Es la
  // vía de login del Super Admin — /auth/login del backend es solo para
  // usuarios de tenant.
  const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });
  const { data: sesion, error: signInErr } = await anonDb.auth.signInWithPassword({
    email: SUPER_ADMIN_EMAIL,
    password: SUPER_ADMIN_PASSWORD,
  });
  if (signInErr || !sesion?.session) die("No pude obtener el access_token", signInErr);

  const token = sesion.session.access_token;
  console.log("\n🔑 access_token (JWT de plataforma):\n");
  console.log(token);
  console.log(
    "\nPara abrir la consola: pegá esto en la consola del navegador con el front levantado\n" +
    "y recargá — el guard `RequireSuperAdmin` lee el claim del token:\n",
  );
  console.log(`  localStorage.setItem("sb-token", "${token}"); location.href = "/admin/tenants";`);
  console.log(
    `\n⚠ El token vence (por defecto 1 h). Volvé a correr el script para renovarlo.`,
  );
}

main().catch((err) => die("Falló la provisión", err));
