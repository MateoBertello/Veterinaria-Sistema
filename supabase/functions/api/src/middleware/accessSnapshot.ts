import type { Context } from "hono";
import { getDb } from "../shared/db.ts";
import { getTenantContext } from "./tenantContext.ts";

/**
 * Estado de acceso del par (tenant, usuario) que hace este request, resuelto en
 * UNA sola consulta.
 *
 * Antes `requireActiveTenant` y `requirePermission` pegaban cada uno su propia
 * consulta a PostgREST, secuencialmente, antes de que el Service tocara el dato:
 * dos round-trips en CADA endpoint autenticado. Son datos de la misma fila
 * lógica (el tenant del usuario y el rol del usuario), así que se resuelven con
 * un embed en vez de dos viajes.
 *
 * La consulta corre con el JWT del usuario (`getDb`), no con service role, así
 * que el embed respeta RLS: es el camino que el CLAUDE.md describe como
 * "PostgREST con el JWT del usuario", donde el aislamiento lo imponen las
 * políticas. El `tenant_id` sigue saliendo del JWT vía `getTenantContext`.
 */
export interface AccessSnapshot {
  /** false si el tenant no existe o RLS no lo deja ver. */
  tenantExiste:  boolean;
  /** `tenants.activo` — false también cuando el tenant no existe. */
  tenantActivo:  boolean;
  /** `usuarios.active` del usuario del JWT dentro de ESE tenant. */
  usuarioActivo: boolean;
  /** Permisos efectivos del rol del usuario (RN-S2). */
  permisos:      Set<string>;
}

/**
 * Se arranca desde `tenants` y se embebe `usuarios` filtrado por el id del JWT,
 * en vez de arrancar desde `usuarios`: así la fila del tenant vuelve aunque el
 * usuario no exista, y se conserva la precedencia histórica de errores
 * (TENANT_NOT_FOUND / TENANT_SUSPENDED antes que FORBIDDEN). Arrancando desde
 * `usuarios`, un usuario inexistente en un tenant suspendido habría devuelto
 * FORBIDDEN en lugar de TENANT_SUSPENDED.
 */
const ACCESO_SELECT = `
  activo,
  usuarios(
    active,
    roles(
      rol_permiso(
        permisos(name)
      )
    )
  )
`;

declare module "hono" {
  interface ContextVariableMap {
    /** Memo por request de la consulta consolidada. */
    accessSnapshot: Promise<AccessSnapshot>;
  }
}

const SIN_ACCESO: AccessSnapshot = {
  tenantExiste:  false,
  tenantActivo:  false,
  usuarioActivo: false,
  permisos:      new Set(),
};

/**
 * Devuelve el snapshot de acceso del request, resolviéndolo como mucho UNA vez.
 *
 * El memo vive en el contexto de Hono, que es por request: no es una caché
 * compartida entre requests ni entre tenants. Se guarda la promesa, no el valor,
 * para que dos llamadas concurrentes no disparen dos consultas.
 */
export function getAccessSnapshot(c: Context): Promise<AccessSnapshot> {
  const memo = c.get("accessSnapshot");
  if (memo) return memo;

  const pendiente = resolverAcceso(c);
  c.set("accessSnapshot", pendiente);
  return pendiente;
}

async function resolverAcceso(c: Context): Promise<AccessSnapshot> {
  const { tenantId, userId } = getTenantContext(c);
  const db = getDb(c.req.header("Authorization") ?? "");

  const { data, error } = await db
    .from("tenants")
    .select(ACCESO_SELECT)
    .eq("id", tenantId)
    .eq("usuarios.id", userId)
    .single();

  if (error || !data) return SIN_ACCESO;

  const fila = data as { activo?: boolean; usuarios?: unknown };
  const usuario = primerUsuario(fila.usuarios);

  return {
    tenantExiste:  true,
    tenantActivo:  fila.activo === true,
    // El usuario tiene que existir en ESTE tenant y estar activo. Es la misma
    // verificación que hacía el `.eq("active", true)` de requirePermission.
    usuarioActivo: usuario?.active === true,
    permisos:      listarPermisos(usuario),
  };
}

interface FilaUsuario {
  active?: boolean;
  roles?:  { rol_permiso?: Array<{ permisos?: { name?: string } }> };
}

/** El embed vuelve como array; con `usuarios.id=eq.X` trae 0 o 1 fila. */
function primerUsuario(usuarios: unknown): FilaUsuario | undefined {
  if (Array.isArray(usuarios)) return usuarios[0] as FilaUsuario | undefined;
  return (usuarios ?? undefined) as FilaUsuario | undefined;
}

function listarPermisos(usuario: FilaUsuario | undefined): Set<string> {
  const nombres = usuario?.roles?.rol_permiso
    ?.map((rp) => rp.permisos?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  return new Set(nombres ?? []);
}
