import { z } from "zod";

// Regex de hora "HH:MM" (00:00–23:59).
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Agendar Turno (Addendum v1.1 §"Agendar Turno").
 * - `endTime` NO se acepta: lo calcula el backend a partir de la duración del
 *   servicio vigente (RN-TU9, defensa contra manipulación).
 * - `doctorId` es opcional aquí; su obligatoriedad depende del servicio
 *   (`requiereProfesional`) y se valida en el Service (RN-TU10).
 */
export const CrearTurnoSchema = z.object({
  servicioId: z.string().uuid(),
  clientId:   z.string().uuid(),
  petId:      z.string().uuid(),
  doctorId:   z.string().uuid().optional(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD"),
  startTime:  z.string().regex(HHMM, "startTime debe ser HH:MM"),
  reason:     z.string().min(1).max(200),
  notes:      z.string().max(500).optional(),
});

/** Slots disponibles: GET /turnos/slots?doctorId=&date=&servicioId= */
export const SlotsQuerySchema = z.object({
  doctorId:   z.string().uuid(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD"),
  servicioId: z.string().uuid(),
});

/**
 * Modificar Turno (RN-MC2 — todos los campos opcionales; al menos uno requerido).
 * `endTime` sigue sin aceptarse: se recalcula server-side si cambia el servicio.
 */
export const ModificarTurnoSchema = z.object({
  servicioId: z.string().uuid().optional(),
  clientId:   z.string().uuid().optional(),
  petId:      z.string().uuid().optional(),
  doctorId:   z.string().uuid().nullable().optional(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD").optional(),
  startTime:  z.string().regex(HHMM, "startTime debe ser HH:MM").optional(),
  reason:     z.string().min(1).max(200).optional(),
  notes:      z.string().max(500).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "Se requiere al menos un campo para modificar" });

/** Cancelar Turno (RN-MC3) — motivo obligatorio. */
export const CancelarTurnoSchema = z.object({
  cancellationReason: z.string().min(1).max(500),
});

/** Gestionar Estado (RN-ES1) — solo transiciones no terminales por este endpoint. */
export const CambiarEstadoSchema = z.object({
  status: z.enum(["Programado", "Confirmado", "Completado"]),
});

/** Query params para listar turnos: GET /turnos?date=&status= */
export const ListarTurnosQuerySchema = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD").optional(),
  status: z.enum(["Programado", "Confirmado", "Completado", "Cancelado"]).optional(),
});

export type CrearTurnoDto        = z.infer<typeof CrearTurnoSchema>;
export type SlotsQuery           = z.infer<typeof SlotsQuerySchema>;
export type ModificarTurnoDto    = z.infer<typeof ModificarTurnoSchema>;
export type CancelarTurnoDto     = z.infer<typeof CancelarTurnoSchema>;
export type CambiarEstadoDto     = z.infer<typeof CambiarEstadoSchema>;
export type ListarTurnosQuery    = z.infer<typeof ListarTurnosQuerySchema>;
