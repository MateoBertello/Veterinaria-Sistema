import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

/**
 * Middleware: bloquea a TODO un tenant suspendido (activo=false) en el punto
 * más temprano de la cadena (RN-SA3).
 *
 * Debe montarse SIEMPRE inmediatamente después de tenantContext y antes de
 * cualquier middleware de permiso/módulo, porque la suspensión afecta a todo
 * el tenant, no solo a los módulos vendibles. Se responde con un código propio
 * TENANT_SUSPENDED (distinto de MODULE_NOT_LICENSED) para que el frontend pueda
 * mostrar la pantalla de aviso correspondiente.
 *
 * Nota: el login y /auth/me NO pasan por este guard, de modo que los usuarios
 * de un tenant suspendido pueden autenticarse y ver el aviso.
 */
export async function requireActiveTenant(c: Context, next: Next): Promise<Response | void> {
  const { tenantId } = getTenantContext(c);
  const authHeader = c.req.header("Authorization") ?? "";
  const db = getDb(authHeader);

  const { data: tenant, error } = await db
    .from("tenants")
    .select("activo")
    .eq("id", tenantId)
    .single();

  if (error || !tenant) {
    throw new DomainError(
      ErrorCode.TENANT_NOT_FOUND,
      404,
      "Tenant no encontrado",
    );
  }

  if (!tenant.activo) {
    throw new DomainError(
      ErrorCode.TENANT_SUSPENDED,
      403,
      "La clínica está suspendida. Contacte al soporte de la plataforma.",
    );
  }

  await next();
}
