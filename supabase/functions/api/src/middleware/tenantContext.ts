import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";

export interface TenantContext {
  tenantId: string;
  userId:   string;
}

declare module "hono" {
  interface ContextVariableMap {
    tenantId: string;
    userId:   string;
  }
}

/**
 * Middleware: extrae y valida el tenant_id del JWT de Supabase Auth.
 *
 * - Rechaza con 401 si falta el header Authorization o el JWT no es válido.
 * - Rechaza con 401 si app_metadata.tenant_id no está presente en el JWT.
 * - Cualquier tenant_id en body o query params es ignorado (RN multi-tenant).
 * - Adjunta tenantId y userId al contexto Hono para los handlers downstream.
 */
export async function tenantContext(c: Context, next: Next): Promise<Response | void> {
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

  const tenantId = (payload.app_metadata as Record<string, unknown> | undefined)
    ?.tenant_id as string | undefined;

  if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "El token no contiene un tenant_id válido",
    );
  }

  const userId = payload.sub as string | undefined;
  if (!userId) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "El token no contiene un identificador de usuario",
    );
  }

  c.set("tenantId", tenantId);
  c.set("userId",   userId);

  await next();
}

/**
 * Helper: extrae los valores ya resueltos del contexto.
 * Llamar solo en rutas que ya pasaron por tenantContext.
 */
export function getTenantContext(c: Context): TenantContext {
  return {
    tenantId: c.get("tenantId"),
    userId:   c.get("userId"),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64URL → Base64 → string
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob !== "undefined"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
