import { z } from "zod";

// Valores del ENUM condicion_fiscal (20260901000001_comercial_enums.sql).
export const CONDICION_FISCAL_VALUES = [
  "consumidor_final",
  "monotributista",
  "responsable_inscripto",
  "exento",
  "no_alcanzado",
  "sin_datos",
] as const;

export const CrearProveedorSchema = z.object({
  razonSocial:     z.string().trim().min(2).max(150),
  nombreFantasia:  z.string().trim().max(150).nullish(),
  // Sin validación de dígito verificador en esta etapa: solo formato y longitud.
  cuit:            z.string().trim().max(20).nullish(),
  condicionFiscal: z.enum(CONDICION_FISCAL_VALUES).nullish(),
  telefono:        z.string().trim().max(40).nullish(),
  email:           z.string().trim().email().max(150).nullish(),
  direccion:       z.string().trim().max(200).nullish(),
  contactoNombre:  z.string().trim().max(120).nullish(),
  observaciones:   z.string().max(500).nullish(),
  // Vincula la ficha de proveedor con la de cliente cuando son el mismo sujeto
  // real (decisión P-10, opción A). No las fusiona.
  clienteId:       z.string().uuid().nullish(),
});

export const ActualizarProveedorSchema = CrearProveedorSchema.partial();
export const CambiarEstadoProveedorSchema = z.object({ activo: z.boolean() });

export const ListarProveedoresQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  activo: z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearProveedorDto = z.infer<typeof CrearProveedorSchema>;
export type ActualizarProveedorDto = z.infer<typeof ActualizarProveedorSchema>;
export type CambiarEstadoProveedorDto = z.infer<typeof CambiarEstadoProveedorSchema>;
export type ListarProveedoresQuery = z.infer<typeof ListarProveedoresQuerySchema>;
