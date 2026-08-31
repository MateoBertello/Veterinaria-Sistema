import { z } from "zod";

export const crearCompraSchema = z.object({
  proveedorId: z.string().uuid("proveedorId debe ser un UUID válido"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  comprobanteProveedorTipo: z.string().max(50).optional(),
  comprobanteProveedorNumero: z.string().max(100).optional(),
  observaciones: z.string().optional(),
  generaEgresoCaja: z.boolean().default(false),
});

export const actualizarCompraSchema = z.object({
  proveedorId: z.string().uuid("proveedorId debe ser un UUID válido").optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").optional(),
  comprobanteProveedorTipo: z.string().max(50).nullable().optional(),
  comprobanteProveedorNumero: z.string().max(100).nullable().optional(),
  observaciones: z.string().nullable().optional(),
  generaEgresoCaja: z.boolean().optional(),
});

export const agregarItemCompraSchema = z.object({
  productoId: z.string().uuid("productoId debe ser un UUID válido"),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  costoUnitarioNeto: z.number().min(0, "El costo unitario neto debe ser mayor o igual a 0"),
  alicuotaIva: z.number().min(0).max(100, "La alícuota de IVA debe estar entre 0 y 100"),
  codigoLote: z.string().max(100).nullable().optional(),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").nullable().optional(),
});

export const actualizarItemCompraSchema = z.object({
  cantidad: z.number().positive("La cantidad debe ser mayor a 0").optional(),
  costoUnitarioNeto: z.number().min(0, "El costo unitario neto debe ser mayor o igual a 0").optional(),
  alicuotaIva: z.number().min(0).max(100, "La alícuota de IVA debe estar entre 0 y 100").optional(),
  codigoLote: z.string().max(100).nullable().optional(),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").nullable().optional(),
});

export const anularCompraSchema = z.object({
  motivo: z.string().min(10, "El motivo debe tener al menos 10 caracteres"),
});

export const buscarComprasQuerySchema = z.object({
  proveedorId: z.string().uuid().optional(),
  estado: z.enum(["borrador", "confirmada", "anulada"]).optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CrearCompraDto = z.infer<typeof crearCompraSchema>;
export type ActualizarCompraDto = z.infer<typeof actualizarCompraSchema>;
export type AgregarItemCompraDto = z.infer<typeof agregarItemCompraSchema>;
export type ActualizarItemCompraDto = z.infer<typeof actualizarItemCompraSchema>;
export type AnularCompraDto = z.infer<typeof anularCompraSchema>;
export type BuscarComprasQuery = z.infer<typeof buscarComprasQuerySchema>;
