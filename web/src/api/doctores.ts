import { apiClient, apiClientList } from "./client.ts";
import type { ApiMeta, Doctor, DoctorInput } from "../types/index.ts";

export interface ListarDoctoresParams {
  search?:    string;
  available?: boolean;
  page?:      number;
  limit?:     number;
}

/** GET /doctores — listado paginado con búsqueda y filtro de disponibilidad. */
export function listarDoctores(
  params: ListarDoctoresParams = {},
): Promise<{ items: Doctor[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.available !== undefined) qs.set("available", String(params.available));
  if (params.page)  qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<Doctor>(`/doctores${suffix}`);
}

/** GET /doctores/{id} — un doctor puntual. */
export function obtenerDoctor(id: string): Promise<Doctor> {
  return apiClient<Doctor>(`/doctores/${id}`);
}

/** PATCH /doctores/{id} — edita specialty/licenseNumber/available (baja lógica). */
export function editarDoctor(id: string, input: DoctorInput): Promise<Doctor> {
  return apiClient<Doctor>(`/doctores/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
