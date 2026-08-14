import { apiClient } from "./client.ts";
import type { Franja, FranjaInput } from "../types/index.ts";

/** GET /doctores/{doctorId}/horarios — franjas de un doctor, ordenadas por día/hora. */
export function listarHorariosDeDoctor(doctorId: string): Promise<Franja[]> {
  return apiClient<Franja[]>(`/doctores/${doctorId}/horarios`);
}

/** POST /doctores/{doctorId}/horarios — crea una franja (RN-HOR1/HOR2). */
export function crearFranja(doctorId: string, input: FranjaInput): Promise<Franja> {
  return apiClient<Franja>(`/doctores/${doctorId}/horarios`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PATCH /horarios/{horarioId} — activa/desactiva una franja (revalida RN-HOR2 al reactivar). */
export function alternarFranja(horarioId: string, active: boolean): Promise<Franja> {
  return apiClient<Franja>(`/horarios/${horarioId}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

/** DELETE /horarios/{horarioId} — elimina la franja físicamente. */
export function eliminarFranja(horarioId: string): Promise<{ deleted: true }> {
  return apiClient<{ deleted: true }>(`/horarios/${horarioId}`, {
    method: "DELETE",
  });
}
