import type { Context, MiddlewareHandler, Next } from "hono";
import { cors } from "hono/cors";

function getEnv(key: string): string | undefined {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Orígenes permitidos para CORS. Se leen del env `CORS_ALLOWED_ORIGINS` (lista separada
 * por comas; p. ej. `http://localhost:5173` en dev, el dominio real en prod). Si no está
 * seteado se usa el origen de desarrollo por defecto para no romper el front local.
 */
export function readCorsOrigins(): string[] {
  const raw = getEnv("CORS_ALLOWED_ORIGINS");
  if (!raw) return ["http://localhost:5173"];
  return raw.split(",").map((o) => o.trim()).filter((o) => o.length > 0);
}

/**
 * Middleware CORS con allowlist explícita. NUNCA responde `*`: el `cors()` de Hono con
 * una función `origin` refleja el origin solo si está en la allowlist (y `*` es además
 * incompatible con `credentials: true`). El preflight `OPTIONS` lo resuelve el propio
 * `cors()` (204 con headers) sin llegar a `tenantContext`, por eso se registra global y
 * antes de los routers: así el login y las pantallas con escritura no rompen.
 */
export function buildCors(): MiddlewareHandler {
  const allowlist = readCorsOrigins();
  return cors({
    origin: (origin) => (allowlist.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Cron-Secret"],
    exposeHeaders: ["Content-Disposition"],
    maxAge: 600,
  });
}

/**
 * Security headers en toda respuesta de la API (regla de endurecimiento S7):
 * - `X-Content-Type-Options: nosniff` — evita MIME sniffing.
 * - `Referrer-Policy: no-referrer` — no filtra URLs internas al navegar hacia afuera.
 * - `Cache-Control: no-store` — toda la API está detrás de auth y devuelve datos de
 *   tenant (personales/clínicos); no debe cachearse en navegador ni proxies.
 */
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
}
