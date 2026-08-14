import { z } from "zod";

// Franja horaria de un profesional (HorarioDoctor). day_of_week 0–6 (CHECK del DDL).
// startTime/endTime en formato "HH:MM" (TIME en la DB).
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const horaSchema = z
  .string()
  .regex(HHMM, "La hora debe tener formato HH:MM (24h)");

export const CrearFranjaSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0, "dayOfWeek 0–6").max(6, "dayOfWeek 0–6"),
  startTime: horaSchema,
  endTime:   horaSchema,
  active:    z.boolean().default(true),
});

export const AlternarActivoSchema = z.object({
  active: z.boolean(),
});

export type CrearFranjaDto = z.infer<typeof CrearFranjaSchema>;
export type AlternarActivoDto = z.infer<typeof AlternarActivoSchema>;
