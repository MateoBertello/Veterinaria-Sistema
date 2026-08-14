/**
 * Arnés de configuración ÚNICO para los tests de integración.
 *
 * Una sola convención de variables de entorno para ubicar el Supabase de pruebas.
 * Cada variable acepta el prefijo `TEST_` (para no colisionar con la config de la
 * app en el mismo .env) y cae a la versión sin prefijo:
 *
 *   TEST_SUPABASE_URL              ?? SUPABASE_URL
 *   TEST_SUPABASE_ANON_KEY         ?? SUPABASE_ANON_KEY
 *   TEST_SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY
 *
 * Las tres deben estar presentes para que las suites corran. Si falta alguna, las
 * suites se marcan como SKIPPED explícito (no como passed) vía `describeIntegration`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe } from "vitest";

/** Carga .env en process.env sin pisar variables ya presentes en el entorno. */
export function loadEnv(): void {
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
    // .env opcional — se espera que las vars estén en el entorno
  }
}

loadEnv();

export const SUPABASE_URL      = process.env["TEST_SUPABASE_URL"]              ?? process.env["SUPABASE_URL"]              ?? "";
export const SUPABASE_ANON_KEY = process.env["TEST_SUPABASE_ANON_KEY"]         ?? process.env["SUPABASE_ANON_KEY"]         ?? "";
export const SERVICE_ROLE_KEY  = process.env["TEST_SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

// Espejo hacia las variables SIN prefijo que lee el código de la app
// (supabase/functions/api/src/shared/db.ts). Necesario para las suites que montan
// el Hono app in-process: así el app y los tests apuntan al MISMO Supabase.
if (SUPABASE_URL)      process.env["SUPABASE_URL"]              = SUPABASE_URL;
if (SUPABASE_ANON_KEY) process.env["SUPABASE_ANON_KEY"]         = SUPABASE_ANON_KEY;
if (SERVICE_ROLE_KEY)  process.env["SUPABASE_SERVICE_ROLE_KEY"] = SERVICE_ROLE_KEY;

/** true sólo si las tres variables están resueltas. */
export const HAS_INTEGRATION_CONFIG = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY);

/**
 * `describe` para suites de integración: si falta configuración, la suite se
 * marca como SKIPPED (no como passed), evitando falsos verdes por salteo silencioso.
 */
export const describeIntegration = describe.skipIf(!HAS_INTEGRATION_CONFIG);
