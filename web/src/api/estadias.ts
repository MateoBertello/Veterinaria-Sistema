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

/**
 * GET /estadias?date= — estadías que ocupan ese día (Reservada/EnCurso/Finalizada;
 * Cancelada excluida). Alimenta la vista de ocupación y las acciones de check-in/out.
 * Trae la tarjeta de la mascota embebida (una sola consulta, sin N+1).
 */
export function listarEstadias(params: { date: string }): Promise<Estadia[]> {
  const qs = new URLSearchParams({ date: params.date });
  return apiClient<Estadia[]>(`/estadias?${qs.toString()}`);
}

/**
 * GET /estadias?dateFrom=&dateTo= — estadías que solapan el rango (una sola consulta).
 * Alimenta la vista de ocupación mensual: el cliente agrupa por día (sin N+1).
 */
export function listarEstadiasRango(params: { dateFrom: string; dateTo: string }): Promise<Estadia[]> {
  const qs = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  return apiClient<Estadia[]>(`/estadias?${qs.toString()}`);
}

/** PATCH /estadias/:id/checkin — Reservada → EnCurso (RN-CK1/CK2). Sin body. */
export function checkinEstadia(id: string): Promise<Estadia> {
  return apiClient<Estadia>(`/estadias/${id}/checkin`, { method: "PATCH" });
}

/** PATCH /estadias/:id/checkout — EnCurso → Finalizada (RN-CK1/CK3), libera cupo. Sin body. */
export function checkoutEstadia(id: string): Promise<Estadia> {
  return apiClient<Estadia>(`/estadias/${id}/checkout`, { method: "PATCH" });
}

// Modificar/Cancelar quedan para el próximo pase (backend ya cerrado).
