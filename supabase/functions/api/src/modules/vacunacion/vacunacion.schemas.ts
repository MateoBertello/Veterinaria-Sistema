import { z } from "zod";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const ProgramarDosisSchema = z.object({
  tipoVacunaId:   z.string().uuid(),
  fechaEstimada:  z.string().regex(YMD, "fechaEstimada debe ser YYYY-MM-DD"),
  notas:          z.string().max(500).optional(),
  eventoOrigenId: z.string().uuid().optional(),
});
export type ProgramarDosisDto = z.infer<typeof ProgramarDosisSchema>;

export const EditarDosisSchema = z.object({
  fechaEstimada: z.string().regex(YMD, "fechaEstimada debe ser YYYY-MM-DD").optional(),
  notas:         z.string().max(500).nullable().optional(),
});
export type EditarDosisDto = z.infer<typeof EditarDosisSchema>;

export const CancelarDosisSchema = z.object({
  notas: z.string().max(500).optional(),
});
export type CancelarDosisDto = z.infer<typeof CancelarDosisSchema>;

// Marcar dosis Aplicada: crea el evento clínico 'Vacunación' (historial_clinico
// exige professional_id NOT NULL). date opcional = hoy (no futura, lo valida el
// Service); weightKg/temperatureC con el mismo rango que el CHECK de historial_clinico.
export const MarcarAplicadaSchema = z.object({
  professionalId: z.string().uuid(),
  date:           z.string().regex(YMD, "date debe ser YYYY-MM-DD").optional(),
  weightKg:       z.number().min(0).max(200).optional(),
  temperatureC:   z.number().min(30).max(45).optional(),
  notes:          z.string().max(500).optional(),
});
export type MarcarAplicadaDto = z.infer<typeof MarcarAplicadaSchema>;

export const ListarDosisQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
