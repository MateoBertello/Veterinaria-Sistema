import { z } from "zod";

// RN-CL2: DNI/CUIT solo dígitos y guiones.
const DNI_CUIT_REGEX = /^[\d-]+$/;
// RN-CL4: teléfono solo números, +, - y espacios.
const PHONE_REGEX = /^[\d+\-\s]+$/;

export const CrearClienteSchema = z.object({
  // RN-CL1: obligatorios.
  fullName:     z.string().min(1, "El nombre completo es requerido").max(150),
  dniCuit:      z.string()
                  .min(1, "El DNI/CUIT es requerido")
                  .max(20)
                  .regex(DNI_CUIT_REGEX, "El DNI/CUIT solo admite dígitos y guiones"),
  phone:        z.string()
                  .min(1, "El teléfono es requerido")
                  .max(30)
                  .regex(PHONE_REGEX, "El teléfono solo admite números, +, - y espacios"),
  address:      z.string().min(1, "La dirección es requerida").max(200),
  // RN-CL1: opcionales. RN-CL5: email válido si se informa.
  email:        z.string().email("Formato de email inválido").max(150).optional(),
  observations: z.string().max(1000).optional(),
});

export const EditarClienteSchema = CrearClienteSchema.partial();

export const ListarClientesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearClienteDto        = z.infer<typeof CrearClienteSchema>;
export type EditarClienteDto       = z.infer<typeof EditarClienteSchema>;
export type ListarClientesQueryDto = z.infer<typeof ListarClientesQuerySchema>;
