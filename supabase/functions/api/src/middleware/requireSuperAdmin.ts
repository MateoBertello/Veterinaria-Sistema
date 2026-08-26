import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { verifyJwt } from "../shared/jwt.ts";

declare module "hono" {
  interface ContextVariableMap {
    superAdminId:    string;
    /** Email del claim `email`, solo para etiquetar la auditoría de plataforma. */
    superAdminEmail: string | null;
  }
}

/**
 * Middleware: autoriza al Super Admin de plataforma para los endpoints /admin/*.
 *
 * El Super Admin opera FUERA del contexto de cualquier tenant: su JWT NO lleva
 * app_metadata.tenant_id, sino el claim app_metadata.platform_role='super_admin'
 * (consistente con la función SQL is_super_admin() y las RLS de plataforma).
 *
 * - VERIFICA LA FIRMA del token antes de mirar ningún claim (shared/jwt.ts).
 *   Acá no es una defensa en profundidad sino EL control: los services de
 *   /admin/* usan `service_role`, que bypassea RLS, así que la base no vuelve a
 *   revisar nada. Mientras el claim se leía de un payload solo decodificado,
 *   un token fabricado a mano —sin credencial de ningún tipo— habilitaba la
 *   consola de plataforma entera: listar, crear, editar y suspender tenants.
 * - Rechaza con 401 si falta el header Authorization o el JWT es inválido.
 * - Rechaza con 403 FORBIDDEN si el JWT no acredita platform_role='super_admin'.
 * - Adjunta superAdminId (y el email del claim) al contexto para auditoría
 *   (RN-SA5). El Super Admin no tiene fila en `usuarios`, así que `recordAudit`
 *   no puede resolver su nombre por id: el asiento se etiqueta con lo que trae
 *   el token YA VERIFICADO, nunca con algo que mande el cliente en el body.
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

  const payload = await verifyJwt(token);

  const platformRole = (payload.app_metadata as Record<string, unknown> | undefined)
    ?.platform_role as string | undefined;

  if (platformRole !== "super_admin") {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      403,
      "Se requiere rol de Super Admin de plataforma",
    );
  }

  const superAdminId = payload.sub;
  if (!superAdminId) {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      401,
      "El token no contiene un identificador de usuario",
    );
  }

  c.set("superAdminId", superAdminId);
  c.set("superAdminEmail", typeof payload.email === "string" ? payload.email : null);

  await next();
}
