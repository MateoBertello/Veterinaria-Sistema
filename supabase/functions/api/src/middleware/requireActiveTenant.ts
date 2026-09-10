import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getAccessSnapshot } from "./accessSnapshot.ts";

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
 *
 * La consulta la resuelve `getAccessSnapshot`, compartida con requirePermission:
 * los dos guards viajan a la base UNA sola vez por request.
 */
export async function requireActiveTenant(c: Context, next: Next): Promise<Response | void> {
  const acceso = await getAccessSnapshot(c);

  if (!acceso.tenantExiste) {
    throw new DomainError(
      ErrorCode.TENANT_NOT_FOUND,
      404,
      "Tenant no encontrado",
    );
  }

  if (!acceso.tenantActivo) {
    throw new DomainError(
      ErrorCode.TENANT_SUSPENDED,
      403,
      "La clínica está suspendida. Contacte al soporte de la plataforma.",
    );
  }

  await next();
}
