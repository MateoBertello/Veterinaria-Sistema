import { apiClient, apiClientList } from "./client.ts";
import type {
  ApiMeta,
  CrearUsuarioInput,
  EditarUsuarioInput,
  Rol,
  Usuario,
} from "../types/index.ts";

export interface ListarUsuariosParams {
  page?:  number;
  limit?: number;
}

/** GET /usuarios — listado paginado (envelope con meta). El backend NO expone
 *  búsqueda ni filtros: solo page/limit. */
export function listarUsuarios(
  params: ListarUsuariosParams = {},
): Promise<{ items: Usuario[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.page)  qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<Usuario>(`/usuarios${suffix}`);
}

/** POST /usuarios — alta de usuario (RN-SEC1/SEC4). El backend hashea la password
 *  y, si el rol es veterinario, crea el perfil en doctores (DT-1). */
export function crearUsuario(input: CrearUsuarioInput): Promise<Usuario> {
  return apiClient<Usuario>("/usuarios", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT /usuarios/:id — edición parcial (sin password). Enviar `{ active }` solo
 *  para el alta/baja lógica (RN-SEC6 protege el último admin: LAST_ADMIN). */
export function editarUsuario(id: string, input: EditarUsuarioInput): Promise<Usuario> {
  return apiClient<Usuario>(`/usuarios/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Shape crudo del catálogo de roles del backend (snake_case en display_name). */
interface RolRaw {
  id:           string;
  name:         string;
  display_name: string;
  description:  string | null;
}

/** GET /usuarios/roles — catálogo de roles del tenant. Mapea snake→camel del lado
 *  del front (el resto del contrato ya viene en camelCase). */
export async function listarRoles(): Promise<Rol[]> {
  const roles = await apiClient<RolRaw[]>("/usuarios/roles");
  return roles.map((r) => ({
    id:          r.id,
    name:        r.name,
    displayName: r.display_name,
    description: r.description ?? null,
  }));
}
