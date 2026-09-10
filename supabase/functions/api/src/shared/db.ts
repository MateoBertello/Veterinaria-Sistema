import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  if (!value || typeof value !== "string") {
    throw new Error(`Variable de entorno requerida: ${key}`);
  }
  return value;
}

/**
 * Los clientes se memoizan a nivel de módulo, no en el contexto de Hono.
 *
 * El efecto es el mismo —el isolate no sobrevive al request, así que el módulo
 * vive exactamente lo que vive el request— y no obliga a pasar el contexto por
 * los 191 puntos donde los Services piden una conexión, que además romperían la
 * regla de capas: un Service no debería conocer el `Context` de Hono.
 *
 * Sigue siendo correcto si la plataforma llegara a reusar isolates: el cliente
 * de service role no tiene estado por usuario, y el de usuario se memoiza contra
 * el header exacto con el que se creó, así que un header distinto nunca recibe
 * el cliente de otro. Se guarda uno solo, no un mapa: dentro de un request hay
 * un único header, y así no queda un JWT ajeno retenido en memoria.
 */
let clienteServicio: SupabaseClient | null = null;

let headerMemoizado: string | null = null;
let clienteUsuario:  SupabaseClient | null = null;

/**
 * Cliente Supabase con el JWT del usuario autenticado.
 * RLS activo: el usuario solo ve datos de su tenant.
 */
export function getDb(authorizationHeader: string): SupabaseClient {
  if (clienteUsuario && headerMemoizado === authorizationHeader) {
    return clienteUsuario;
  }

  const url     = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");

  clienteUsuario = createClient(url, anonKey, {
    global: {
      headers: { Authorization: authorizationHeader },
    },
    auth: { persistSession: false },
  });
  headerMemoizado = authorizationHeader;

  return clienteUsuario;
}

/**
 * Cliente Supabase con service role key.
 * Bypasea RLS — solo para seeds, tests y operaciones de plataforma.
 *
 * Que el cliente se comparta NO afecta el aislamiento: el service role bypassea
 * RLS igual, y el aislamiento por tenant lo sigue imponiendo, entera y
 * exclusivamente, el `.eq("tenant_id", ctx.tenantId)` de cada consulta.
 */
export function getServiceDb(): SupabaseClient {
  if (clienteServicio) return clienteServicio;

  const url            = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  clienteServicio = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return clienteServicio;
}

/**
 * Descarta los clientes memoizados.
 *
 * Para los tests, que cambian las variables de entorno entre casos y esperan que
 * la próxima llamada construya un cliente nuevo con la config nueva.
 */
export function resetDbClients(): void {
  clienteServicio = null;
  clienteUsuario  = null;
  headerMemoizado = null;
}
