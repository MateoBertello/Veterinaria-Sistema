import { z } from "zod";

export const CONDICION_PAGO_VALUES = ["contado", "cuenta_corriente"] as const;
export const ESTADO_VENTA_VALUES = ["registrada", "anulada"] as const;
export const TIPO_ITEM_VENTA_VALUES = ["producto", "servicio"] as const;

export const ItemVentaInputSchema = z
  .object({
    tipoItem:            z.enum(TIPO_ITEM_VENTA_VALUES),
    productoId:          z.string().uuid().nullish(),
    servicioId:          z.string().uuid().nullish(),
    cantidad:            z.number().positive(),
    precioUnitario:      z.number().positive().optional(),
    descuentoPorcentaje: z.number().min(0).max(100).default(0),
    loteId:              z.string().uuid().nullish(),
    motivoFefo:          z.string().trim().max(500).nullish(),
    mascotaId:           z.string().uuid().nullish(),
  })
  .refine((data) => {
    if (data.tipoItem === "producto") return !!data.productoId && !data.servicioId;
    if (data.tipoItem === "servicio") return !!data.servicioId && !data.productoId;
    return false;
  }, "El ítem debe tener productoId o servicioId según el tipo");

export type ItemVentaInput = z.infer<typeof ItemVentaInputSchema>;

export const PagoVentaInputSchema = z.object({
  medioPagoId: z.string().uuid(),
  importe:     z.number().positive(),
  referencia:  z.string().trim().max(100).nullish(),
});

export type PagoVentaInput = z.infer<typeof PagoVentaInputSchema>;

export const RegistrarVentaSchema = z.object({
  sesionCajaId:  z.string().uuid(),
  clienteId:     z.string().uuid().nullish(),
  condicionPago: z.enum(CONDICION_PAGO_VALUES).default("contado"),
  items:         z.array(ItemVentaInputSchema).min(1, "Debe incluir al menos un ítem"),
  pagos:         z.array(PagoVentaInputSchema).default([]),
  descuento:     z.number().min(0).default(0),
  observaciones: z.string().max(500).nullish(),
});

export type RegistrarVentaDto = z.infer<typeof RegistrarVentaSchema>;

export const AnularVentaSchema = z.object({
  sesionCajaId: z.string().uuid().nullish(),
  motivo:       z.string().trim().min(10, "El motivo de anulación debe tener al menos 10 caracteres").max(500),
});

export type AnularVentaDto = z.infer<typeof AnularVentaSchema>;

export const ListarVentasQuerySchema = z.object({
  clienteId:    z.string().uuid().optional(),
  sesionCajaId: z.string().uuid().optional(),
  usuarioId:    z.string().uuid().optional(),
  estado:       z.enum(ESTADO_VENTA_VALUES).optional(),
  desde:        z.string().optional(),
  hasta:        z.string().optional(),
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
});

export type ListarVentasQuery = z.infer<typeof ListarVentasQuerySchema>;

export const ReporteMargenQuerySchema = z.object({
  itemId:   z.string().uuid().optional(),
  tipoItem: z.enum(TIPO_ITEM_VENTA_VALUES).optional(),
  desde:    z.string().optional(),
  hasta:    z.string().optional(),
});

export type ReporteMargenQuery = z.infer<typeof ReporteMargenQuerySchema>;

export const ReporteItemsVendidosQuerySchema = z.object({
  itemId:   z.string().uuid().optional(),
  tipoItem: z.enum(TIPO_ITEM_VENTA_VALUES).optional(),
  desde:    z.string().optional(),
  hasta:    z.string().optional(),
});

export type ReporteItemsVendidosQuery = z.infer<typeof ReporteItemsVendidosQuerySchema>;
