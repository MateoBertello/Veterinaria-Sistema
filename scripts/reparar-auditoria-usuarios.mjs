/**
 * Reparación de la etiqueta de autor en la auditoría — `node scripts/reparar-auditoria-usuarios.mjs`.
 *
 * Hasta el fix de RN-S3, los controllers armaban el contexto con
 * `callerName/callerRole = "unknown"` y ningún service resolvía el nombre, así
 * que todo asiento de negocio quedó con autor "unknown". El dato duro —`user_id`—
 * sí se guardó bien, así que la etiqueta se puede reconstruir cruzando contra
 * `usuarios`. Los asientos nuevos ya salen resueltos (ver shared/audit.ts).
 *
 * NO toca: asientos sin `user_id` (cron/sistema) ni los que ya tienen autor.
 * Idempotente: correrlo dos veces no cambia nada la segunda vez.
 *
 * Uso (por defecto SIMULA; nada se escribe sin APLICAR=1):
 *   node scripts/reparar-auditoria-usuarios.mjs            # muestra qué haría
 *   APLICAR=1 node scripts/reparar-auditoria-usuarios.mjs  # escribe
 *
 * Toma SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del entorno o del `.env`
 * (acepta las variantes TEST_*), igual que el resto de los scripts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

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
const APLICAR = process.env["APLICAR"] === "1";

const SENTINELA = "unknown";

function die(msg, err) {
  console.error(`✖ ${msg}${err ? `: ${err.message ?? err}` : ""}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (en el entorno o en .env).");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }, // Node < 22 no trae WebSocket nativo.
});

async function main() {
  console.log(
    `▶ Reparando autores de auditoría contra ${SUPABASE_URL}` +
    `${APLICAR ? "" : "  (SIMULACIÓN — usá APLICAR=1 para escribir)"}\n`,
  );

  // 1. Asientos con autor sin resolver pero con user_id utilizable.
  const { data: asientos, error: errAsientos } = await db
    .from("registros_auditoria")
    .select("id, user_id")
    .eq("user_name", SENTINELA)
    .not("user_id", "is", null);

  if (errAsientos) die("No pude leer registros_auditoria", errAsientos);

  if (!asientos?.length) {
    console.log("✓ No hay asientos con autor 'unknown' para reparar.");
    return;
  }

  const porUsuario = new Map();
  for (const a of asientos) {
    porUsuario.set(a.user_id, (porUsuario.get(a.user_id) ?? 0) + 1);
  }
  console.log(`• ${asientos.length} asiento(s) de ${porUsuario.size} usuario(s) distinto(s).`);

  // 2. Identidades en UNA sola consulta (nada de una por asiento).
  const { data: usuarios, error: errUsuarios } = await db
    .from("usuarios")
    .select("id, username, roles!inner(name)")
    .in("id", [...porUsuario.keys()]);

  if (errUsuarios) die("No pude leer usuarios", errUsuarios);

  const identidades = new Map();
  for (const u of usuarios ?? []) {
    const rol = Array.isArray(u.roles) ? u.roles[0] : u.roles;
    identidades.set(u.id, { username: u.username, rol: rol?.name ?? SENTINELA });
  }

  // 3. Un UPDATE por usuario (no por fila), acotado al sentinela.
  let reparados = 0;
  let sinIdentidad = 0;

  for (const [userId, cantidad] of porUsuario) {
    const identidad = identidades.get(userId);

    if (!identidad) {
      // Usuario borrado o de otro origen (p. ej. super admin de plataforma):
      // se deja como está; el user_id sigue siendo la referencia dura.
      console.log(`  · ${userId}: sin fila en usuarios — ${cantidad} asiento(s) sin tocar`);
      sinIdentidad += cantidad;
      continue;
    }

    if (APLICAR) {
      const { error } = await db
        .from("registros_auditoria")
        .update({ user_name: identidad.username, user_role: identidad.rol })
        .eq("user_id", userId)
        .eq("user_name", SENTINELA);

      if (error) die(`No pude actualizar los asientos de ${userId}`, error);
    }

    console.log(
      `  · ${identidad.username} (${identidad.rol}): ${cantidad} asiento(s)` +
      `${APLICAR ? " reparado(s)" : " a reparar"}`,
    );
    reparados += cantidad;
  }

  console.log(
    `\n${APLICAR ? "✅ Reparados" : "🔎 Se repararían"} ${reparados} asiento(s)` +
    `${sinIdentidad ? `; ${sinIdentidad} sin identidad resoluble` : ""}.`,
  );
  if (!APLICAR) console.log("   Volvé a correrlo con APLICAR=1 para escribir los cambios.");
}

main().catch((err) => die("Falló la reparación", err));
