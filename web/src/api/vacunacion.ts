import { apiClientList } from "./client.ts";
import type { ApiMeta, DosisVacunacion } from "../types/index.ts";

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
