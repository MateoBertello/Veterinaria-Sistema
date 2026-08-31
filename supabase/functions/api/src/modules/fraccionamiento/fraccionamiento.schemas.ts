import { z } from "zod";

export const FraccionarLoteSchema = z.object({
  loteOrigenId:            z.string().uuid(),
  productoDestinoId:       z.string().uuid(),
  cantidadOrigen:          z.number().positive(),
  cantidadObtenida:        z.number().positive(),
  fechaVencimientoDestino: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").nullish(),
  codigoLoteDestino:       z.string().trim().min(1).max(50),
  motivo:                  z.string().trim().nullish(),
});

export const SugerirVencimientoQuerySchema = z.object({
  loteOrigenId:      z.string().uuid(),
  productoDestinoId: z.string().uuid(),
});

export const ListarFraccionamientosQuerySchema = z.object({
  page:              z.coerce.number().int().min(1).default(1),
  limit:             z.coerce.number().int().min(1).max(100).default(20),
  productoOrigenId:  z.string().uuid().optional(),
  productoDestinoId: z.string().uuid().optional(),
});

export type FraccionarLoteDto = z.infer<typeof FraccionarLoteSchema>;
export type SugerirVencimientoQuery = z.infer<typeof SugerirVencimientoQuerySchema>;
export type ListarFraccionamientosQuery = z.infer<typeof ListarFraccionamientosQuerySchema>;
