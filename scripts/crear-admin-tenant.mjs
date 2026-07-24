/**
 * Provisión del ADMIN de un tenant (producción) — `node scripts/crear-admin-tenant.mjs`.
 *
 * Crea (o repara) el primer usuario administrador de una clínica ya existente,
 * dejándolo LISTO PARA LOGUEAR. Cubre el hueco del flujo de invitación por email
 * del MVP, que no crea la fila en `usuarios` ni pone el tenant_id en app_metadata:
 *
 *   1. Usuario de Supabase Auth con `app_metadata.tenant_id` correcto y
 *      `email_confirm: true` (lo que exige tenantContext y el login).
 *   2. Fila en `usuarios` con el rol 'admin' del tenant (lo que busca el login
 *      por username).
 *
 * Mismo patrón probado que `scripts/seed.mjs` (ensureUser), pero para UN admin
 * de UN tenant real. Idempotente: re-correrlo repara password/confirmación sin
 * duplicar.
 *
 * Uso (todo por variables de entorno para no exponer secretos en el historial):
 *
 *   export SUPABASE_URL="https://<project-ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"   # Settings → API → service_role
 *   export TENANT_CUIT="20-26861307-3"        # o TENANT_ID="<uuid>"
 *   export ADMIN_EMAIL="admin@veterinaria.com"
 *   export ADMIN_USERNAME="admin_leo"          # con el que se loguea (único)
 *   export ADMIN_NOMBRE="Nombre Apellido"
 *   export ADMIN_PASSWORD="una-password-fuerte"
 *   node scripts/crear-admin-tenant.mjs
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TENANT_ID,
  TENANT_CUIT,
  ADMIN_EMAIL,
  ADMIN_USERNAME,
  ADMIN_NOMBRE,
  ADMIN_PASSWORD,
} = process.env;

function die(msg, err) {
  console.error(`✖ ${msg}${err ? `: ${err.message ?? err}` : ""}`);
  process.exit(1);
}

// ── Validación de entrada ──────────────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}
if (!TENANT_ID && !TENANT_CUIT) {
  die("Indicá el tenant con TENANT_ID (uuid) o TENANT_CUIT (cuit/rut).");
}
for (const [k, v] of Object.entries({ ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_NOMBRE, ADMIN_PASSWORD })) {
  if (!v) die(`Falta la variable ${k}.`);
}
if (ADMIN_PASSWORD.length < 8) {
  die("ADMIN_PASSWORD debe tener al menos 8 caracteres.");
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
  console.log(`▶ Provisionando admin contra ${SUPABASE_URL}\n`);

  // 1. Resolver el tenant.
  const tenantQuery = db.from("tenants").select("id, nombre, cuit_rut, activo");
  const { data: tenant, error: tenantErr } = TENANT_ID
    ? await tenantQuery.eq("id", TENANT_ID).maybeSingle()
    : await tenantQuery.eq("cuit_rut", TENANT_CUIT).maybeSingle();
  if (tenantErr) die("No pude consultar el tenant", tenantErr);
  if (!tenant) die(`No existe un tenant con ${TENANT_ID ? `id ${TENANT_ID}` : `cuit ${TENANT_CUIT}`}.`);
  console.log(`✓ Tenant: "${tenant.nombre}" (${tenant.cuit_rut}) → ${tenant.id}${tenant.activo ? "" : "  ⚠ INACTIVO"}`);

  // 2. Resolver el rol 'admin' del tenant.
  const { data: rol, error: rolErr } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("name", "admin")
    .single();
  if (rolErr || !rol) die("No encontré el rol 'admin' del tenant (¿se creó con crear_tenant?)", rolErr);

  // 3. Crear (o reparar) el usuario de Auth con app_metadata.tenant_id.
  let authUserId;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id },
  });
  if (createErr) {
    if (!/already|registered|exists/i.test(createErr.message ?? "")) {
      die(`createUser falló para ${ADMIN_EMAIL}`, createErr);
    }
    const existing = await findAuthUserByEmail(ADMIN_EMAIL);
    if (!existing) die(`Auth dice que ${ADMIN_EMAIL} ya existe pero no pude localizarlo`);
    authUserId = existing.id;
    await db.auth.admin.updateUserById(authUserId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: tenant.id },
    });
    console.log(`• Auth user ya existía → ${authUserId} (password/confirm/tenant re-seteados)`);
  } else {
    authUserId = created.user.id;
    console.log(`✓ Auth user creado → ${authUserId}`);
  }

  // 4. Asegurar la fila en `usuarios` (idempotente por tenant+email).
  const { data: existe, error: selErr } = await db
    .from("usuarios")
    .select("id, username")
    .eq("tenant_id", tenant.id)
    .eq("email", ADMIN_EMAIL)
    .maybeSingle();
  if (selErr) die("No pude consultar usuarios", selErr);

  if (existe) {
    console.log(`• Fila usuarios ya existía (username "${existe.username}") — no se toca`);
  } else {
    const { error: insErr } = await db.from("usuarios").insert({
      id: authUserId,
      tenant_id: tenant.id,
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      full_name: ADMIN_NOMBRE,
      rol_id: rol.id,
      active: true,
    });
    if (insErr) {
      if (insErr.code === "23505") {
        die(`El username "${ADMIN_USERNAME}" o el email ya está tomado en este tenant (elegí otro)`, insErr);
      }
      die("No pude insertar la fila usuarios", insErr);
    }
    console.log(`✓ Fila usuarios creada (rol admin, username "${ADMIN_USERNAME}")`);
  }

  console.log(`\n✅ Admin listo. Login por username:`);
  console.log(`     usuario: ${ADMIN_USERNAME}`);
  console.log(`     (password: la que definiste en ADMIN_PASSWORD)`);
}

main().catch((err) => die("Falló la provisión", err));
