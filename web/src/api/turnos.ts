import { apiClient } from "./client.ts";
import type {
  CrearTurnoInput,
  EstadoTurno,
  ModificarTurnoInput,
  SlotDisponible,
  Turno,
} from "../types/index.ts";

/**
 * GET /turnos?date=&status= — listado de turnos. Sin `status` el backend devuelve
 * solo los activos (Programado+Confirmado); con `status` filtra por ese estado.
 * Sin `date` devuelve todos (activos o del status pedido) en una sola consulta.
 */
export function listarTurnos(
  params: { date?: string; status?: EstadoTurno } = {},
): Promise<Turno[]> {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClient<Turno[]>(`/turnos${suffix}`);
}

/** GET /turnos?date= — agenda activa del día (Programado/Confirmado; RN-MC4/RN-ES2). */
export function listarTurnosPorFecha(date: string): Promise<Turno[]> {
  return listarTurnos({ date });
}

/**
 * GET /turnos (sin fecha) — todos los turnos activos, en UNA sola consulta. Alimenta
 * la vista calendario mensual (se agrupa por día en el cliente, sin N+1).
 */
export function listarTurnosActivosDelMes(): Promise<Turno[]> {
  return listarTurnos();
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

/**
 * GET /turnos/:id — detalle del turno. Es el ÚNICO endpoint que devuelve
 * `accionesDisponibles` poblado (RN-MC1); el listado lo trae vacío.
 */
export function obtenerTurno(id: string): Promise<Turno> {
  return apiClient<Turno>(`/turnos/${id}`);
}

/** PUT /turnos/:id — modificar; el backend revalida con la duración vigente (RN-MC2). */
export function modificarTurno(id: string, input: ModificarTurnoInput): Promise<Turno> {
  return apiClient<Turno>(`/turnos/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** PATCH /turnos/:id/cancelar — cancela con motivo obligatorio (RN-MC5). */
export function cancelarTurno(id: string, cancellationReason: string): Promise<Turno> {
  return apiClient<Turno>(`/turnos/${id}/cancelar`, {
    method: "PATCH",
    body: JSON.stringify({ cancellationReason }),
  });
}

/** PATCH /turnos/:id/estado — transición de ciclo de vida (RN-ES1..ES5 → INVALID_TRANSITION). */
export function cambiarEstado(id: string, status: EstadoTurno): Promise<Turno> {
  return apiClient<Turno>(`/turnos/${id}/estado`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** DELETE /turnos/:id — elimina el turno (habilitado por `accionesDisponibles`). */
export function eliminarTurno(id: string): Promise<void> {
  return apiClient<void>(`/turnos/${id}`, { method: "DELETE" });
}
