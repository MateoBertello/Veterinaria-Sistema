import { z } from "zod";

export const TIPO_AJUSTE_DIRECTO_VALUES = [
  "entrada_ajuste",
  "salida_ajuste",
  "merma_rotura",
  "merma_vencimiento",
] as const;

export const AjustarExistenciaSchema = z.object({
  loteId: z.string().uuid(),
  tipo: z.enum(TIPO_AJUSTE_DIRECTO_VALUES),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  motivo: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(500),
});

export type AjustarExistenciaDto = z.infer<typeof AjustarExistenciaSchema>;

export const BloquearLoteSchema = z.object({
  motivo: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(500),
});

export type BloquearLoteDto = z.infer<typeof BloquearLoteSchema>;

export const DesbloquearLoteSchema = z.object({
  motivo: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(500),
});

export type DesbloquearLoteDto = z.infer<typeof DesbloquearLoteSchema>;

export const CrearRecuentoSchema = z.object({
  observaciones: z.string().max(500).nullish(),
});

export type CrearRecuentoDto = z.infer<typeof CrearRecuentoSchema>;

export const ItemRecuentoDetalleInputSchema = z.object({
  loteId: z.string().uuid(),
  cantidadContada: z.number().min(0, "La cantidad contada no puede ser negativa"),
  cantidadSistema: z.number().min(0).nullish(),
  motivo: z.string().max(500).nullish(),
});

export type ItemRecuentoDetalleInput = z.infer<typeof ItemRecuentoDetalleInputSchema>;

export const GuardarDetallesRecuentoSchema = z.object({
  items: z.array(ItemRecuentoDetalleInputSchema).min(1, "Debe incluir al menos un lote para contar"),
});

export type GuardarDetallesRecuentoDto = z.infer<typeof GuardarDetallesRecuentoSchema>;

export const AplicarRecuentoSchema = z.object({
  confirmarDesvios: z.boolean().default(false),
});

export type AplicarRecuentoDto = z.infer<typeof AplicarRecuentoSchema>;

export const ListarRecuentosQuerySchema = z.object({
  estado: z.enum(["borrador", "aplicado"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListarRecuentosQuery = z.infer<typeof ListarRecuentosQuerySchema>;

export const ItemDevolucionInputSchema = z.object({
  ventaItemId: z.string().uuid(),
  cantidad: z.number().positive("La cantidad a devolver debe ser mayor a 0"),
  revendible: z.boolean().default(true),
});

export type ItemDevolucionInput = z.infer<typeof ItemDevolucionInputSchema>;

export const RegistrarDevolucionSchema = z.object({
  ventaId: z.string().uuid(),
  items: z.array(ItemDevolucionInputSchema).min(1, "Debe incluir al menos un ítem a devolver"),
  motivo: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(500),
  reintegraEfectivo: z.boolean().default(false),
  sesionCajaId: z.string().uuid().nullish(),
});

export type RegistrarDevolucionDto = z.infer<typeof RegistrarDevolucionSchema>;
