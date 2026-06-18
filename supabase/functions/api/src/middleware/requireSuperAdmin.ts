import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";

declare module "hono" {
  interface ContextVariableMap {
    superAdminId: string;
  }
}

/**
 * Middleware: autoriza al Super Admin de plataforma para los endpoints /admin/*.
 *
 * El Super Admin opera FUERA del contexto de cualquier tenant: su JWT NO lleva
 * app_metadata.tenant_id, sino el claim app_metadata.platform_role='super_admin'
 * (consistente con la función SQL is_super_admin() y las RLS de plataforma).
 *
 * - Rechaza con 401 si falta el header Authorization o el JWT es inválido.
 * - Rechaza con 403 FORBIDDEN si el JWT no acredita platform_role='super_admin'.
 * - Adjunta superAdminId al contexto para auditoría (RN-SA5).
 */
export async function requireSuperAdmin(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "Token de autenticación requerido",
    );
  }

  const token = authHeader.slice("Bearer ".length);
  const payload = decodeJwtPayload(token);

  if (!payload) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "Token de autenticación inválido",
    );
  }

  const platformRole = (payload.app_metadata as Record<string, unknown> | undefined)
    ?.platform_role as string | undefined;

  if (platformRole !== "super_admin") {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      403,
      "Se requiere rol de Super Admin de plataforma",
    );
  }

  const superAdminId = payload.sub as string | undefined;
  if (!superAdminId) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "El token no contiene un identificador de usuario",
    );
  }

  c.set("superAdminId", superAdminId);

  await next();
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob !== "undefined"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
