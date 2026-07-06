import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";

function getEnv(key: string): string | undefined {
  const value = process.env[key] ?? (globalThis as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Guard de las rutas internas de sistema (cron): NO usa JWT ni tenantContext, porque
 * el disparador (pg_cron/pg_net) barre TODOS los tenants y no tiene sesión de usuario.
 *
 * Autoriza comparando el header `X-Cron-Secret` contra el env `CRON_SECRET` del Edge
 * Function. Si el secreto no está configurado o no coincide → 401 (deny-by-default: sin
 * `CRON_SECRET` seteado, nadie puede invocar la ruta). El MISMO valor se guarda en Vault
 * (`cron_notif_secret`) para que la función SQL `disparar_notificaciones()` lo mande.
 */
export async function requireCronSecret(c: Context, next: Next): Promise<Response | void> {
  const expected = getEnv("CRON_SECRET");
  const provided = c.req.header("X-Cron-Secret") ?? "";

  if (!expected || provided !== expected) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "Secreto de invocación inválido o ausente",
    );
  }

  await next();
}
