import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ApiMeta,
  FraccionarLoteInput,
  ItemHistorialFraccionamiento,
  ResultadoFraccionamiento,
} from "../../types/index.ts";

export function fraccionar(
  input: FraccionarLoteInput,
): Promise<ResultadoFraccionamiento> {
  return apiClient<ResultadoFraccionamiento>("/fraccionamiento", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

export interface SugerirVencimientoParams {
  loteOrigenId:      string;
  productoDestinoId: string;
}

export function sugerirVencimiento(
  params: SugerirVencimientoParams,
): Promise<{ vencimientoSugerido: string | null }> {
  return apiClient<{ vencimientoSugerido: string | null }>(
    `/fraccionamiento/sugerir-vencimiento${buildQuery(params as unknown as Record<string, unknown>)}`,
  );
}

export interface ListarFraccionamientosParams {
  productoOrigenId?:  string;
  productoDestinoId?: string;
  page?:              number;
  limit?:             number;
}

export function historial(
  params: ListarFraccionamientosParams = {},
): Promise<{ items: ItemHistorialFraccionamiento[]; meta: ApiMeta }> {
  return apiClientList<ItemHistorialFraccionamiento>(
    `/fraccionamiento/historial${buildQuery(params as Record<string, unknown>)}`,
  );
}
