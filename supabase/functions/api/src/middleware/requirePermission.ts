import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

/**
 * Middleware factory: verifica que el usuario autenticado tenga el permiso
 * requerido via la cadena usuarios → roles → rol_permiso → permisos.
 * Rechaza con 403 si el permiso no está asignado al rol del usuario.
 */
export function requirePermission(permiso: string) {
  return async function (c: Context, next: Next): Promise<Response | void> {
    const { userId } = getTenantContext(c);
    const authHeader = c.req.header("Authorization") ?? "";
    const db = getDb(authHeader);

    const { data, error } = await db
      .from("usuarios")
      .select(`
        rol_id,
        roles!inner(
          rol_permiso!inner(
            permisos!inner(name)
          )
        )
      `)
      .eq("id", userId)
      .eq("active", true)
      .single();

    if (error || !data) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        `Permiso requerido: ${permiso}`,
      );
    }

    // Verificar si algún permiso del rol coincide
    const tienePermiso = hasPermission(data, permiso);

    if (!tienePermiso) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        `Permiso requerido: ${permiso}`,
      );
    }

    await next();
  };
}

function hasPermission(userData: unknown, permiso: string): boolean {
  try {
    const user = userData as {
      roles: {
        rol_permiso: Array<{
          permisos: { name: string };
        }>;
      };
    };
    return user.roles.rol_permiso.some((rp) => rp.permisos.name === permiso);
  } catch {
    return false;
  }
}
