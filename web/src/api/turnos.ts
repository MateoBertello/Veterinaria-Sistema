import { apiClient } from "./client.ts";
import type { Turno } from "../types/index.ts";

/** GET /turnos?date= — agenda activa del día (Programado/Confirmado; RN-MC4/RN-ES2). */
export function listarTurnosPorFecha(date: string): Promise<Turno[]> {
  return apiClient<Turno[]>(`/turnos?date=${date}`);
}
