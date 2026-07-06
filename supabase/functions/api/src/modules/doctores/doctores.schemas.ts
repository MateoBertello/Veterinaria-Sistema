import { z } from "zod";

// ABM de Doctores: solo listar/editar. El alta de un Doctor ocurre automáticamente
// al crear un usuario veterinario (RN-SEC5, en usuarios.service.ts); aquí no se
// duplica esa lógica. La "baja" es available=false (sin delete físico).

export const ActualizarDoctorSchema = z.object({
  name:          z.string().trim().min(2, "El nombre requiere al menos 2 caracteres").max(120).optional(),
  specialty:     z.string().trim().max(120).nullish(),
  licenseNumber: z.string().trim().max(60).nullish(),
  available:     z.boolean().optional(),
});

export const ListarDoctoresQuerySchema = z.object({
  search:    z.string().trim().min(1).optional(),
  available: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // professional=true: solo doctores seleccionables como profesional clínico
  // (user_id vinculado). Es el filtro que consumen los selects de historial:
  // professional_id es FK a usuarios(id), así que un doctor sin usuario no es
  // un profesional válido (DT-2).
  professional: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ActualizarDoctorDto = z.infer<typeof ActualizarDoctorSchema>;
export type ListarDoctoresOpts  = z.infer<typeof ListarDoctoresQuerySchema>;
