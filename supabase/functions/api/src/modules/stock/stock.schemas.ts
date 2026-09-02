import { z } from "zod";

export const listarLotesQuerySchema = z.object({
  productoId: z.string().uuid().optional(),
  estado: z.enum(["disponible", "cuarentena", "bloqueado", "agotado", "vencido"]).optional(),
  venceAntesDe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").optional(),
  conExistencia: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const candidatosFefoQuerySchema = z.object({
  productoId: z.string().uuid("productoId debe ser un UUID válido").optional(),
  cantidad: z.coerce.number().positive("La cantidad debe ser mayor a 0").optional(),
});

export const kardexQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const listarMovimientosQuerySchema = z.object({
  loteId: z.string().uuid().optional(),
  productoId: z.string().uuid().optional(),
  tipo: z
    .enum([
      "entrada_compra",
      "entrada_ajuste",
      "entrada_fraccionamiento",
      "entrada_inicial",
      "entrada_devolucion",
      "salida_venta",
      "salida_consumo_clinico",
      "salida_ajuste",
      "salida_fraccionamiento",
      "salida_vencimiento",
      "salida_merma",
    ])
    .optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  operacionId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const listarExistenciasQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListarLotesQuery = z.infer<typeof listarLotesQuerySchema>;
export type CandidatosFefoQuery = z.infer<typeof candidatosFefoQuerySchema>;
export type KardexQuery = z.infer<typeof kardexQuerySchema>;
export type ListarMovimientosQuery = z.infer<typeof listarMovimientosQuerySchema>;
export type ListarExistenciasQuery = z.infer<typeof listarExistenciasQuerySchema>;
