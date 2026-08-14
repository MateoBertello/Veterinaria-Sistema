import type { Context, Next } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

declare module "hono" {
  interface ContextVariableMap {
    /** Permisos efectivos del usuario, ya resueltos por el middleware. */
    permisos: Set<string>;
  }
}

const PERMISOS_SELECT = `
  rol_id,
  roles!inner(
    rol_permiso!inner(
      permisos!inner(name)
    )
  )
`;

/**
 * Permisos efectivos del usuario autenticado, en UNA sola consulta
 * (usuarios → roles → rol_permiso → permisos vía resource embedding).
 *
 * Devuelve un Set vacío si el usuario no existe o está inactivo: quien decide
 * qué hacer con "sin permisos" es el llamador (el middleware corta con 403; un
 * endpoint de solo lectura que muestra un subconjunto puede degradar sin error).
 * Pensado para casos que necesitan evaluar VARIOS permisos: consultarlos de a
 * uno sería una consulta por permiso (N+1).
 */
export async function getUserPermissions(
  userId: string,
  authHeader: string,
): Promise<Set<string>> {
  const db = getDb(authHeader);

  const { data, error } = await db
    .from("usuarios")
    .select(PERMISOS_SELECT)
    .eq("id", userId)
    .eq("active", true)
    .single();

  if (error || !data) return new Set();

  return listPermissions(data);
}

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
      .select(PERMISOS_SELECT)
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

    // Se deja el set en el contexto: los handlers que además necesitan saber si
    // el usuario administra (p. ej. RN-HOR7) lo reusan sin repetir la consulta.
    const efectivos = listPermissions(data);
    c.set("permisos", efectivos);

    if (!efectivos.has(permiso)) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        `Permiso requerido: ${permiso}`,
      );
    }

    await next();
  };
}

/**
 * Middleware factory: alcanza con UNO de los permisos de la lista.
 *
 * Para datos que varios roles necesitan leer aunque su gestión sea de otro:
 * el listado de profesionales lo consume el que arma horarios, el que agenda
 * turnos y el que registra un evento clínico, pero editarlos sigue siendo tarea
 * de `manage_users`. Exigir el permiso de gestión para poder LEER dejaba a esos
 * roles sin poder usar sus propias pantallas.
 */
export function requireAnyPermission(permisos: string[]) {
  return async function (c: Context, next: Next): Promise<Response | void> {
    const { userId } = getTenantContext(c);
    const authHeader = c.req.header("Authorization") ?? "";

    const efectivos = await getUserPermissions(userId, authHeader);
    c.set("permisos", efectivos);

    if (!permisos.some((p) => efectivos.has(p))) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        403,
        `Permiso requerido: alguno de ${permisos.join(", ")}`,
      );
    }

    await next();
  };
}

function listPermissions(userData: unknown): Set<string> {
  try {
    const user = userData as {
      roles: {
        rol_permiso: Array<{
          permisos: { name: string };
        }>;
      };
    };
    return new Set(user.roles.rol_permiso.map((rp) => rp.permisos.name));
  } catch {
    return new Set();
  }
}
