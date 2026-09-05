import { apiClient, apiClientList } from "../client.ts";
import { buildQuery } from "./_query.ts";
import type {
  ApiMeta,
  EstadoLote,
  ExistenciaFila,
  KardexMovimiento,
  Lote,
  LoteCandidato,
  MovimientoStock,
  TipoMovimientoStock,
  TrazabilidadNodo,
  ValorizacionStock,
} from "../../types/index.ts";

export interface ListarLotesParams {
  productoId?:    string;
  estado?:        EstadoLote;
  venceAntesDe?:  string;
  conExistencia?: "true" | "false";
  page?:          number;
  limit?:         number;
}

/**
 * Listado de lotes con filtros y paginación.
 *
 * NOTA PLAN_FRONTEND_COMERCIAL.md §4.3:
 * Con `conExistencia`, el backend aplica el filtro en memoria después de paginar,
 * por lo que la página puede volver con menos ítems que `limit` y el `total`
 * informado incluye lotes descartados. No confiar en `meta.total` cuando se
 * use `conExistencia`.
 */
export function listarLotes(
  params: ListarLotesParams = {},
): Promise<{ items: Lote[]; meta: ApiMeta }> {
  return apiClientList<Lote>(`/lotes${buildQuery(params as Record<string, unknown>)}`);
}

export function obtenerLote(id: string): Promise<Lote> {
  return apiClient<Lote>(`/lotes/${id}`);
}

export interface KardexParams {
  page?:  number;
  limit?: number;
}

export function kardex(
  loteId: string,
  params: KardexParams = {},
): Promise<{ items: KardexMovimiento[]; meta: ApiMeta }> {
  return apiClientList<KardexMovimiento>(
    `/lotes/${loteId}/kardex${buildQuery(params as Record<string, unknown>)}`,
  );
}

export function trazabilidad(loteId: string): Promise<TrazabilidadNodo[]> {
  return apiClient<TrazabilidadNodo[]>(`/lotes/${loteId}/trazabilidad`);
}

export interface CandidatosFefoParams {
  productoId?: string;
  cantidad?:   number;
}

/**
 * Devuelve los lotes candidatos según criterio FEFO (primero el sugerido).
 */
export function candidatosFefo(
  params: CandidatosFefoParams = {},
): Promise<LoteCandidato[]> {
  return apiClient<LoteCandidato[]>(`/lotes/candidatos${buildQuery(params as Record<string, unknown>)}`);
}

export interface ListarMovimientosParams {
  loteId?:      string;
  productoId?:  string;
  tipo?:        TipoMovimientoStock;
  desde?:       string;
  hasta?:       string;
  operacionId?: string;
  page?:        number;
  limit?:       number;
}

export function listarMovimientos(
  params: ListarMovimientosParams = {},
): Promise<{ items: MovimientoStock[]; meta: ApiMeta }> {
  return apiClientList<MovimientoStock>(
    `/movimientos-stock${buildQuery(params as Record<string, unknown>)}`,
  );
}

export interface ListarExistenciasParams {
  search?: string;
  page?:   number;
  limit?:  number;
}

/**
 * Listado de existencias de inventario.
 *
 * NOTA PLAN_FRONTEND_COMERCIAL.md §4.1 y §4.2:
 * La API devuelve una fila por LOTE (desde existencias_lote) y no agrega por
 * producto; en consecuencia, `meta.total` cuenta lotes y no productos.
 * Quien consuma esta función para mostrar stock por producto debe pedir con
 * limit suficiente, agregar por `productoId` en el cliente y paginar del lado
 * del cliente.
 */
export function listarExistencias(
  params: ListarExistenciasParams = {},
): Promise<{ items: ExistenciaFila[]; meta: ApiMeta }> {
  return apiClientList<ExistenciaFila>(
    `/existencias${buildQuery(params as Record<string, unknown>)}`,
  );
}

export function valorizacion(): Promise<ValorizacionStock> {
  return apiClient<ValorizacionStock>("/existencias/valorizacion");
}
