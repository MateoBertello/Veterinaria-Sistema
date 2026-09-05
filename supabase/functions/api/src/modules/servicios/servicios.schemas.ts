import { z } from "zod";
import { ALICUOTAS_IVA } from "../productos/productos.schemas.ts";

// RN-SV1: duracionMinutos entero 5–480, múltiplo de 5.
// RN-SV4: requiereProfesional persiste el flag que TurnoService leerá en E6.
// Valores del ENUM tipo_servicio del DDL (minúsculas, sin acento).
export const TIPO_SERVICIO_VALUES = [
  "clinica",
  "peluqueria",
  "guarderia",
  "cirugia",
  "otro",
] as const;

export const CrearServicioSchema = z.object({
  nombre:              z.string().min(3, "El nombre requiere al menos 3 caracteres").max(80),
  tipo:                z.enum(TIPO_SERVICIO_VALUES),
  duracionMinutos:     z
    .number()
    .int("duracionMinutos debe ser un entero")
    .min(5,   "La duración mínima es 5 minutos")
    .max(480, "La duración máxima es 480 minutos")
    .refine((v) => v % 5 === 0, "La duración debe ser múltiplo de 5"),
  requiereProfesional: z.boolean(),
  descripcion:         z.string().max(300).nullish(),
  precio:              z.number().nonnegative().nullish(),
  alicuotaIva:         z
    .number()
    .refine(
      (v) => (ALICUOTAS_IVA as readonly number[]).includes(v),
      "La alícuota debe ser 0, 10.50, 21 o 27",
    )
    .default(21),
});

// Todos los campos opcionales en edición.
export const ActualizarServicioSchema = CrearServicioSchema.partial();

export const CambiarEstadoServicioSchema = z.object({
  activo: z.boolean(),
});

export const ListarServiciosQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  tipo:   z.enum(TIPO_SERVICIO_VALUES).optional(),
  activo: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearServicioDto     = z.infer<typeof CrearServicioSchema>;
export type ActualizarServicioDto = z.infer<typeof ActualizarServicioSchema>;
export type CambiarEstadoDto     = z.infer<typeof CambiarEstadoServicioSchema>;
export type ListarServiciosOpts  = z.infer<typeof ListarServiciosQuerySchema>;
