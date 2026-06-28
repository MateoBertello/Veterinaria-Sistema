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

export type CrearTurnoDto = z.infer<typeof CrearTurnoSchema>;
export type SlotsQuery    = z.infer<typeof SlotsQuerySchema>;
