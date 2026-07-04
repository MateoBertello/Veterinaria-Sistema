import { apiClient } from "./client.ts";
import type { CrearTurnoInput, SlotDisponible, Turno } from "../types/index.ts";

/** GET /turnos?date= — agenda activa del día (Programado/Confirmado; RN-MC4/RN-ES2). */
export function listarTurnosPorFecha(date: string): Promise<Turno[]> {
  return apiClient<Turno[]>(`/turnos?date=${date}`);
}

export interface SlotsParams {
  doctorId:   string;
  date:       string;
  servicioId: string;
}

/** GET /turnos/slots — horarios de inicio disponibles para doctor+fecha+servicio (RN-TU2). */
export function obtenerSlotsDisponibles(params: SlotsParams): Promise<SlotDisponible[]> {
  const qs = new URLSearchParams({
    doctorId: params.doctorId,
    date: params.date,
    servicioId: params.servicioId,
  });
  return apiClient<SlotDisponible[]>(`/turnos/slots?${qs.toString()}`);
}

/** POST /turnos — agendar turno; el backend calcula endTime y auto-confirma (RN-TU5). */
export function crearTurno(input: CrearTurnoInput): Promise<Turno> {
  return apiClient<Turno>("/turnos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
