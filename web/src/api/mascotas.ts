import { apiClient, apiClientList } from "./client.ts";
import type {
  ApiMeta,
  CambiarDuenoInput,
  EdadCat,
  EditarMascotaInput,
  EstadoMascota,
  Mascota,
  MascotaInput,
  MarcarFallecidaInput,
} from "../types/index.ts";

export interface ListarMascotasParams {
  search?:    string;
  clientId?:  string;
  especieId?: string;
  estado?:    EstadoMascota;
  edadCat?:   EdadCat;
  page?:      number;
  limit?:     number;
}

/** GET /mascotas — listado paginado con filtros. */
export function listarMascotas(
  params: ListarMascotasParams = {},
): Promise<{ items: Mascota[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.search)    qs.set("search",    params.search);
  if (params.clientId)  qs.set("clientId",  params.clientId);
  if (params.especieId) qs.set("especieId", params.especieId);
  if (params.estado)    qs.set("estado",    params.estado);
  if (params.edadCat)   qs.set("edadCat",   params.edadCat);
  if (params.page)      qs.set("page",      String(params.page));
  if (params.limit)     qs.set("limit",     String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<Mascota>(`/mascotas${suffix}`);
}

/** POST /mascotas — alta de mascota. */
export function crearMascota(input: MascotaInput): Promise<Mascota> {
  return apiClient<Mascota>("/mascotas", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT /mascotas/{id} — edición de mascota. */
export function editarMascota(id: string, input: EditarMascotaInput): Promise<Mascota> {
  return apiClient<Mascota>(`/mascotas/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** DELETE /mascotas/{id} — baja lógica (RN-MA6). */
export function eliminarMascota(id: string): Promise<{ id: string; deleted: true }> {
  return apiClient<{ id: string; deleted: true }>(`/mascotas/${id}`, {
    method: "DELETE",
  });
}

/** POST /mascotas/{id}/cambio-dueno — transferir dueño (RN-CD1..CD5). */
export function cambiarDueno(id: string, input: CambiarDuenoInput): Promise<unknown> {
  return apiClient<unknown>(`/mascotas/${id}/cambio-dueno`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /mascotas/{id}/fallecimiento — marcar fallecida manual (RN-MF1..MF5). */
export function marcarFallecida(id: string, input: MarcarFallecidaInput): Promise<Mascota> {
  return apiClient<Mascota>(`/mascotas/${id}/fallecimiento`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
