import { apiClient } from "./client.ts";
import type { CrearEstadiaInput, CupoDia, Estadia } from "../types/index.ts";

/** POST /estadias — registrar estadía; nace en estado Reservada (RN-GU5). */
export function crearEstadia(input: CrearEstadiaInput): Promise<Estadia> {
  return apiClient<Estadia>("/estadias", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * GET /estadias/cupo?dateFrom&dateTo — ocupación vs cupo configurado, un item por
 * día del rango inclusive (RN-GU4). Ambos parámetros son requeridos por el backend.
 */
export function obtenerCupo(params: { dateFrom: string; dateTo: string }): Promise<CupoDia[]> {
  const qs = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  return apiClient<CupoDia[]>(`/estadias/cupo?${qs.toString()}`);
}

// Modificar/Cancelar, Check-in/Check-out y el listado de estadías quedan para
// cuando se implemente esa pantalla (fuera de alcance de Registrar Estadía).
