import { z } from "zod";

// Fecha "YYYY-MM-DD" (mismo criterio que turnos/horarios).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Registrar Estadía (Etapa 7; v1.0 §5 + Addendum v1.1).
 * - `status` NO se acepta: la estadía nace siempre 'Reservada' (RN-GU5).
 * - RN-GU1 (rango válido y fecha no pasada) se valida abajo con refinements;
 *   el Service traduce cada falla a su código (INVALID_RANGE / PAST_DATE).
 * - RN-GU2 (solape por mascota) y RN-GU4 (cupo) se resuelven server-side
 *   (constraint GIST + RPC con guarda de cupo), no por Zod.
 */
export const CrearEstadiaSchema = z.object({
  clientId:     z.string().uuid(),
  petId:        z.string().uuid(),
  checkInDate:  z.string().regex(YMD, "checkInDate debe ser YYYY-MM-DD"),
  checkOutDate: z.string().regex(YMD, "checkOutDate debe ser YYYY-MM-DD"),
  reason:       z.string().min(1).max(200),
  notes:        z.string().max(500).optional(),
});

/** Cupo por rango: GET /estadias/cupo?dateFrom=&dateTo= */
export const CupoQuerySchema = z.object({
  dateFrom: z.string().regex(YMD, "dateFrom debe ser YYYY-MM-DD"),
  dateTo:   z.string().regex(YMD, "dateTo debe ser YYYY-MM-DD"),
}).refine((d) => d.dateTo >= d.dateFrom, {
  message: "dateTo debe ser posterior o igual a dateFrom",
  path:    ["dateTo"],
});

/** Modificar Estadía (Etapa 7; RN-ME1..ME2). Todos los campos son opcionales
 *  en el schema; el controller pre-rellena los valores vigentes antes de llamar
 *  al service, que los envía al RPC siempre completos. */
export const ModificarEstadiaSchema = z.object({
  checkInDate:  z.string().regex(YMD, "checkInDate debe ser YYYY-MM-DD").optional(),
  checkOutDate: z.string().regex(YMD, "checkOutDate debe ser YYYY-MM-DD").optional(),
  reason:       z.string().min(1).max(200).optional(),
  notes:        z.string().max(500).nullable().optional(),
});

/** Cancelar Estadía (RN-ME3): motivo obligatorio. */
export const CancelarEstadiaSchema = z.object({
  cancellationReason: z.string().min(1).max(500),
});

export type CrearEstadiaDto    = z.infer<typeof CrearEstadiaSchema>;
export type CupoQuery          = z.infer<typeof CupoQuerySchema>;
export type ModificarEstadiaDto = z.infer<typeof ModificarEstadiaSchema>;
export type CancelarEstadiaDto  = z.infer<typeof CancelarEstadiaSchema>;
