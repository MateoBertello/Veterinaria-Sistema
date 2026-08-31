import { z } from "zod";

export const RegistrarConsumoItemSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: z.number().positive(),
  loteId: z.string().uuid().nullable().optional(),
  motivoFefo: z.string().nullable().optional()
});

export const RegistrarConsumoSchema = z.object({
  historialId: z.string().uuid(),
  planVacunacionId: z.string().uuid().nullable().optional(),
  recetaId: z.string().uuid().nullable().optional(),
  profesionalPrescriptorId: z.string().uuid().nullable().optional(),
  items: z.array(RegistrarConsumoItemSchema).min(1)
});

export const GetDisponibilidadQuerySchema = z.object({
  productoId: z.string().uuid()
});
