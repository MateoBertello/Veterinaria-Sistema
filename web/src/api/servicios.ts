import { apiClient, apiClientList } from "./client.ts";
import type { ApiMeta, Servicio, ServicioInput, TipoServicio } from "../types/index.ts";

export interface ListarServiciosParams {
  search?: string;
  tipo?:   TipoServicio;
  activo?: boolean;
  page?:   number;
  limit?:  number;
}

/** GET /servicios — listado paginado con búsqueda y filtros (envelope con meta). */
export function listarServicios(
  params: ListarServiciosParams = {},
): Promise<{ items: Servicio[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.tipo)   qs.set("tipo", params.tipo);
  if (params.activo !== undefined) qs.set("activo", String(params.activo));
  if (params.page)   qs.set("page", String(params.page));
  if (params.limit)  qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<Servicio>(`/servicios${suffix}`);
}

/** POST /servicios — alta de servicio (RN-SV1, RN-SV2). */
export function crearServicio(input: ServicioInput): Promise<Servicio> {
  return apiClient<Servicio>("/servicios", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT /servicios/{id} — edición de servicio. */
export function editarServicio(id: string, input: Partial<ServicioInput>): Promise<Servicio> {
  return apiClient<Servicio>(`/servicios/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** PATCH /servicios/{id}/estado — activar/desactivar (baja protegida, RN-SV3). */
export function cambiarEstadoServicio(id: string, activo: boolean): Promise<Servicio> {
  return apiClient<Servicio>(`/servicios/${id}/estado`, {
    method: "PATCH",
    body: JSON.stringify({ activo }),
  });
}
