/**
 * Provisión de un USUARIO de un tenant (producción) — `node scripts/crear-usuario-tenant.mjs`.
 *
 * Crea (o repara) un usuario de una clínica dejándolo LISTO PARA LOGUEAR, con el
 * rol que le indiques. Cubre la falta de pantalla de Usuarios en el front del MVP.
 * Replica exactamente lo que hace el backend (usuarios.service.crear):
 *
 *   1. Usuario de Supabase Auth con `app_metadata.tenant_id` + `email_confirm: true`.
 *   2. Fila en `usuarios` con el rol indicado.
 *   3. Si el rol es 'veterinario' → fila en `doctores` (RN-SEC5), para que aparezca
 *      como profesional en Historial/Turnos/Horarios.
 *
 * Idempotente: re-correrlo repara password/confirmación y no duplica.
 *
 * Uso (todo por variables de entorno, para no exponer secretos en el historial):
 *
 *   export SUPABASE_URL="https://<project-ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role key (eyJ...)>"
 *   export TENANT_CUIT="20-26861307-3"          # o TENANT_ID="<uuid>"
 *   export USUARIO_ROL="veterinario"            # admin | veterinario | recepcionista
 *   export USUARIO_EMAIL="vet@veterinaria.com"
 *   export USUARIO_USERNAME="vet_leo"           # con el que se loguea (único)
 *   export USUARIO_NOMBRE="Dra. Ana Pérez"
 *   export USUARIO_PASSWORD="una-password-fuerte"
 *   node scripts/crear-usuario-tenant.mjs
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const ROLES_VALIDOS = ["admin", "veterinario", "recepcionista"];
const SPECIALTY_POR_DEFECTO = "Clínica general";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TENANT_ID,
  TENANT_CUIT,
  USUARIO_ROL = "admin",
  USUARIO_EMAIL,
  USUARIO_USERNAME,
  USUARIO_NOMBRE,
  USUARIO_PASSWORD,
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
if (!ROLES_VALIDOS.includes(USUARIO_ROL)) {
  die(`USUARIO_ROL inválido ("${USUARIO_ROL}"). Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
}
for (const [k, v] of Object.entries({ USUARIO_EMAIL, USUARIO_USERNAME, USUARIO_NOMBRE, USUARIO_PASSWORD })) {
  if (!v) die(`Falta la variable ${k}.`);
}
if (USUARIO_PASSWORD.length < 8) {
  die("USUARIO_PASSWORD debe tener al menos 8 caracteres.");
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
  console.log(`▶ Provisionando usuario (rol ${USUARIO_ROL}) contra ${SUPABASE_URL}\n`);

  // 1. Resolver el tenant.
  const tenantQuery = db.from("tenants").select("id, nombre, cuit_rut, activo");
  const { data: tenant, error: tenantErr } = TENANT_ID
    ? await tenantQuery.eq("id", TENANT_ID).maybeSingle()
    : await tenantQuery.eq("cuit_rut", TENANT_CUIT).maybeSingle();
  if (tenantErr) die("No pude consultar el tenant", tenantErr);
  if (!tenant) die(`No existe un tenant con ${TENANT_ID ? `id ${TENANT_ID}` : `cuit ${TENANT_CUIT}`}.`);
  console.log(`✓ Tenant: "${tenant.nombre}" (${tenant.cuit_rut}) → ${tenant.id}${tenant.activo ? "" : "  ⚠ INACTIVO"}`);

  // 2. Resolver el rol pedido dentro del tenant.
  const { data: rol, error: rolErr } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("name", USUARIO_ROL)
    .single();
  if (rolErr || !rol) die(`No encontré el rol '${USUARIO_ROL}' del tenant (¿se creó con crear_tenant?)`, rolErr);

  // 3. Crear (o reparar) el usuario de Auth con app_metadata.tenant_id.
  let authUserId;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: USUARIO_EMAIL,
    password: USUARIO_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id },
  });
  if (createErr) {
    if (!/already|registered|exists/i.test(createErr.message ?? "")) {
      die(`createUser falló para ${USUARIO_EMAIL}`, createErr);
    }
    const existing = await findAuthUserByEmail(USUARIO_EMAIL);
    if (!existing) die(`Auth dice que ${USUARIO_EMAIL} ya existe pero no pude localizarlo`);
    authUserId = existing.id;
    await db.auth.admin.updateUserById(authUserId, {
      password: USUARIO_PASSWORD,
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
    .eq("email", USUARIO_EMAIL)
    .maybeSingle();
  if (selErr) die("No pude consultar usuarios", selErr);

  if (existe) {
    console.log(`• Fila usuarios ya existía (username "${existe.username}") — no se toca`);
  } else {
    const { error: insErr } = await db.from("usuarios").insert({
      id: authUserId,
      tenant_id: tenant.id,
      username: USUARIO_USERNAME,
      email: USUARIO_EMAIL,
      full_name: USUARIO_NOMBRE,
      rol_id: rol.id,
      active: true,
    });
    if (insErr) {
      if (insErr.code === "23505") {
        die(`El username "${USUARIO_USERNAME}" o el email ya está tomado en este tenant (elegí otro)`, insErr);
      }
      die("No pude insertar la fila usuarios", insErr);
    }
    console.log(`✓ Fila usuarios creada (rol ${USUARIO_ROL}, username "${USUARIO_USERNAME}")`);
  }

  // 5. Veterinario → fila en doctores (RN-SEC5), para que sea profesional seleccionable.
  if (USUARIO_ROL === "veterinario") {
    const { error: docErr } = await db.from("doctores").upsert(
      {
        tenant_id: tenant.id,
        user_id: authUserId,
        name: USUARIO_NOMBRE,
        specialty: SPECIALTY_POR_DEFECTO,
        available: true,
      },
      { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
    );
    if (docErr) die("No pude crear/asegurar la fila doctores", docErr);
    console.log(`✓ Fila doctores asegurada (profesional seleccionable en Historial/Turnos)`);
  }

  console.log(`\n✅ Usuario listo. Login por username:`);
  console.log(`     usuario: ${USUARIO_USERNAME}   (rol: ${USUARIO_ROL})`);
  console.log(`     (password: la que definiste en USUARIO_PASSWORD)`);
}

main().catch((err) => die("Falló la provisión", err));
