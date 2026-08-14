import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { verifyJwt } from "../shared/jwt.ts";

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
 * - VERIFICA LA FIRMA del token (ver shared/jwt.ts). Antes solo lo decodificaba:
 *   como la Edge Function corre con `verify_jwt = false` (necesita atender el
 *   login, que llega sin token), nadie estaba validando criptográficamente nada
 *   en la puerta de entrada. En las rutas de tenant el daño quedaba contenido
 *   porque PostgREST revalida la firma en cada consulta, pero eso convertía a la
 *   base en el único control real y dejaba pasar tokens falsos hasta ahí.
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

  // `verifyJwt` ya lanza DomainError 401 ante firma inválida, algoritmo no
  // soportado (incluido `none`) o token vencido.
  const payload = await verifyJwt(token);

  const tenantId = (payload.app_metadata as Record<string, unknown> | undefined)
    ?.tenant_id as string | undefined;

  if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "El token no contiene un tenant_id válido",
    );
  }

  const userId = payload.sub;
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
