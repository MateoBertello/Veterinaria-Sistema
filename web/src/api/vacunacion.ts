import { apiClient, apiClientList } from "./client.ts";
import type { ApiMeta, DosisVacunacion, MarcarAplicadaInput, ProgramarDosisInput } from "../types/index.ts";

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

/** POST /mascotas/{petId}/plan-vacunacion — programar dosis (RN-PV2, PV3, PV4). */
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
