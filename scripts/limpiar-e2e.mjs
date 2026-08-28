/**
 * Limpieza de los residuos que deja la suite E2E en la base local.
 *
 * PROBLEMA QUE RESUELVE: los specs crean entidades con nombre único
 * (`unico()` de tests/e2e/fixtures.ts → `"Especie E2E 1787860771540"`) y nunca
 * las borran. La stack local no se resetea entre corridas, así que cada
 * ejecución sedimenta: en la pantalla de Catálogos se acumulan filas
 * "Especie E2E …" / "Raza E2E …" que ensucian la vista y le restan legibilidad
 * a cualquier testing manual posterior. Los catálogos además solo tienen baja
 * lógica (RN-CAT5/RN-CAT9) — el propio test de RN-CAT9 deja la suya "Dada de
 * baja" a propósito, y una corrida que se corta a la mitad deja la suya
 * "Activa". Ninguna se va sola.
 *
 * POR QUÉ BARRE POR MARCA Y NO POR LO QUE REGISTRÓ LA CORRIDA: un `afterEach`
 * limpiaría solo lo de la corrida en curso, y únicamente si el test llegó a
 * terminar. La basura que hay hoy en la base viene justamente de corridas que
 * se cortaron por la mitad. Barrer por marca recoge también lo que dejaron las
 * anteriores.
 *
 * SEGURIDAD DEL BARRIDO: solo toca filas cuyo nombre contiene la marca ` E2E `.
 * Los datos del seed ("Perro", "Gato", "Juana Pérez", "Firulais") no la tienen
 * y quedan intactos. Corre con service role porque tiene que borrar de verdad
 * —no dar de baja— y los catálogos no exponen DELETE por la API.
 *
 * USO:
 *   node scripts/limpiar-e2e.mjs      # barrido suelto (npm run e2e:limpiar)
 * y automáticamente como `globalTeardown` de Playwright al terminar la suite.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

/** Marca que `unico()` intercala entre el prefijo y el timestamp. */
export const MARCA_E2E = " E2E ";

/** Patrón ILIKE equivalente a la marca. */
const PATRON = `%${MARCA_E2E}%`;

/**
 * Carga .env sin pisar variables ya presentes.
 * Mismo criterio que tests/integration/_env.ts y scripts/seed.mjs.
 */
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
    // .env opcional — se espera que las vars estén en el entorno.
  }
}

const idsDe = (filas) => (filas ?? []).map((f) => f.id);

/** Borra por lista de ids y acumula cuántas filas se fueron. */
async function borrarPorId(db, tabla, ids, resumen) {
  if (ids.length === 0) return;
  const { data, error } = await db.from(tabla).delete().in("id", ids).select("id");
  if (error) {
    resumen.problemas.push(`${tabla}: ${error.message}`);
    return;
  }
  resumen.borrados[tabla] = (resumen.borrados[tabla] ?? 0) + (data?.length ?? 0);
}

/** Junta ids de `tabla` cuyas columnas apunten a alguno de los valores dados. */
async function idsQueApuntanA(db, tabla, pares, resumen) {
  const encontrados = new Set();
  for (const [columna, valores] of pares) {
    if (valores.length === 0) continue;
    const { data, error } = await db.from(tabla).select("id").in(columna, valores);
    if (error) {
      resumen.problemas.push(`${tabla} por ${columna}: ${error.message}`);
      continue;
    }
    for (const id of idsDe(data)) encontrados.add(id);
  }
  return [...encontrados];
}

/**
 * Barre los residuos E2E respetando el orden de las FK.
 *
 * El orden NO es cosmético: `mascotas.especie_id`, `turnos.pet_id` y
 * `estadias.pet_id` son ON DELETE RESTRICT, así que la base rechaza borrar una
 * especie que todavía tiene mascotas, o una mascota que todavía tiene turnos.
 * Lo que cascadea solo no se toca acá: al borrar la mascota se van
 * historial_clinico, plan_vacunacion y cambios_propietario; al borrar la
 * especie se van sus razas y especie_tipo_vacuna.
 */
export async function limpiarResiduosE2E() {
  loadEnv();

  const url = process.env["TEST_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
  const key = process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

  const resumen = { borrados: {}, problemas: [] };

  if (!url || !key) {
    resumen.problemas.push(
      "faltan TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY: no se limpió nada",
    );
    return resumen;
  }

  const db = createClient(url, key, {
    auth: { persistSession: false },
    // Node < 22 no trae WebSocket nativo y el cliente no se construye sin esto,
    // aunque no usemos Realtime (mismo apaño que scripts/seed.mjs).
    realtime: { transport: ws },
  });

  // ── 1. Qué entidades llevan la marca ────────────────────────────────────────
  const [clientes, especies, razas, tiposVacuna, mascotasPorNombre] = await Promise.all([
    db.from("clientes").select("id").ilike("full_name", PATRON),
    db.from("especies").select("id").ilike("name", PATRON),
    db.from("razas").select("id").ilike("name", PATRON),
    db.from("tipos_vacuna").select("id").ilike("nombre", PATRON),
    db.from("mascotas").select("id").ilike("name", PATRON),
  ]);

  const lecturas = {
    clientes, especies, razas, tipos_vacuna: tiposVacuna, mascotas: mascotasPorNombre,
  };
  for (const [tabla, res] of Object.entries(lecturas)) {
    if (res.error) resumen.problemas.push(`lectura de ${tabla}: ${res.error.message}`);
  }

  const clienteIds = idsDe(clientes.data);
  const especieIds = idsDe(especies.data);
  const razaIds    = idsDe(razas.data);
  const vacunaIds  = idsDe(tiposVacuna.data);

  // ── 2. Mascotas a borrar ────────────────────────────────────────────────────
  // No alcanza con las que llevan la marca en el nombre: una mascota de nombre
  // "normal" creada sobre un cliente o una especie E2E bloquearía el borrado de
  // esos por FK RESTRICT. Se suman por eso las que cuelgan de ellos.
  const mascotas = [...new Set([
    ...idsDe(mascotasPorNombre.data),
    ...await idsQueApuntanA(db, "mascotas", [
      ["client_id", clienteIds],
      ["especie_id", especieIds],
    ], resumen),
  ])];

  // ── 3. Dependientes RESTRICT de mascotas y clientes ─────────────────────────
  // turnos y estadias apuntan a mascota Y a cliente con RESTRICT: hay que
  // sacarlos por las dos vías antes de tocar cualquiera de los dos.
  for (const tabla of ["turnos", "estadias"]) {
    const aBorrar = await idsQueApuntanA(db, tabla, [
      ["pet_id", mascotas],
      ["client_id", clienteIds],
    ], resumen);
    await borrarPorId(db, tabla, aBorrar, resumen);
  }

  // ── 4. Entidades, de la hoja a la raíz ──────────────────────────────────────
  await borrarPorId(db, "mascotas", mascotas, resumen);
  await borrarPorId(db, "clientes", clienteIds, resumen);
  await borrarPorId(db, "razas", razaIds, resumen);
  await borrarPorId(db, "especies", especieIds, resumen);
  await borrarPorId(db, "tipos_vacuna", vacunaIds, resumen);

  return resumen;
}

/** Imprime el resumen con el mismo formato que usa scripts/seed.mjs. */
export function reportar(resumen) {
  const total = Object.values(resumen.borrados).reduce((a, b) => a + b, 0);

  if (total === 0) {
    console.log("✓ Limpieza E2E: no había residuos.");
  } else {
    const detalle = Object.entries(resumen.borrados)
      .filter(([, n]) => n > 0)
      .map(([tabla, n]) => `${tabla}=${n}`)
      .join(", ");
    console.log(`✓ Limpieza E2E: ${total} fila(s) borradas (${detalle}).`);
  }

  for (const problema of resumen.problemas) {
    console.warn(`⚠ Limpieza E2E: ${problema}`);
  }
}

// Ejecutado directamente (`node scripts/limpiar-e2e.mjs`), no importado.
if (import.meta.url === `file://${process.argv[1]}`) {
  reportar(await limpiarResiduosE2E());
}
