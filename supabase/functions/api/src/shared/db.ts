import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  if (!value || typeof value !== "string") {
    throw new Error(`Variable de entorno requerida: ${key}`);
  }
  return value;
}

/**
 * Cliente Supabase con el JWT del usuario autenticado.
 * RLS activo: el usuario solo ve datos de su tenant.
 */
export function getDb(authorizationHeader: string): SupabaseClient {
  const url    = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");

  return createClient(url, anonKey, {
    global: {
      headers: { Authorization: authorizationHeader },
    },
    auth: { persistSession: false },
  });
}

/**
 * Cliente Supabase con service role key.
 * Bypasea RLS — solo para seeds, tests y operaciones de plataforma.
 */
export function getServiceDb(): SupabaseClient {
  const url            = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
