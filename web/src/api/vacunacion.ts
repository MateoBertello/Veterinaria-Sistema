import { apiClient, apiClientList } from "./client.ts";
import type {
  ApiMeta,
  DosisVacunacion,
  MarcarAplicadaInput,
  ProgramarDosisInput,
  TipoVacunaAplicable,
} from "../types/index.ts";

export interface ListarPlanVacunacionParams {
  page?:  number;
  limit?: number;
}

/** GET /mascotas/{petId}/plan-vacunacion — timeline paginado, orden asc por fechaEstimada (RN-PV1). */
export function listarPlanVacunacion(
  petId: string,
  params: ListarPlanVacunacionParams = {},
): Promise<{ items: DosisVacunacion[]; meta: ApiMeta }> {
  const qs = new URLSearchParams();
  if (params.page)  qs.set("page",  String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClientList<DosisVacunacion>(`/mascotas/${petId}/plan-vacunacion${suffix}`);
}

/**
 * GET /mascotas/{petId}/tipos-vacuna-aplicables — las vacunas que corresponden a
 * ESA mascota (RN-PV11).
 *
 * Reemplaza al viejo `listarTiposVacuna()`, que traía el catálogo entero: al
 * programar una dosis para un perro, el combo ofrecía también las de gato. Qué
 * vacuna aplica sale de la relación especie↔vacuna y la resuelve el backend; el
 * frontend no arma esa unión ni filtra por nombre de especie.
 */
export function listarTiposVacunaAplicables(petId: string): Promise<TipoVacunaAplicable[]> {
  return apiClient<TipoVacunaAplicable[]>(`/mascotas/${petId}/tipos-vacuna-aplicables`);
}

/** POST /mascotas/{petId}/plan-vacunacion — programar dosis (RN-PV2, PV3, PV4, PV11). */
export function programarDosis(petId: string, input: ProgramarDosisInput): Promise<DosisVacunacion> {
  return apiClient<DosisVacunacion>(`/mascotas/${petId}/plan-vacunacion`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PATCH /plan-vacunacion/{id}/aplicar — marca la dosis Aplicada y crea el evento clínico (RN-PV5). */
export function marcarDosisAplicada(id: string, input: MarcarAplicadaInput): Promise<DosisVacunacion> {
  return apiClient<DosisVacunacion>(`/plan-vacunacion/${id}/aplicar`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
