import { z } from "zod";

// RN-CF2: cupoMaximoDiario entero 1–500; diasAvisoVacuna entero 1–90.
export const ActualizarConfiguracionSchema = z.object({
  cupoMaximoDiario: z.number().int().min(1).max(500),
  diasAvisoVacuna:  z.number().int().min(1).max(90),
  parametrosExtra:  z.record(z.string(), z.unknown()).optional(),
});

export type ActualizarConfiguracionDto = z.infer<typeof ActualizarConfiguracionSchema>;

export interface ConfiguracionPublica {
  cupoMaximoDiario: number;
  diasAvisoVacuna:  number;
  parametrosExtra:  Record<string, unknown>;
  updatedAt:        string;
}
