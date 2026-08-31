import { z } from "zod";

export const AbrirSesionSchema = z.object({
  cajaId:       z.string().uuid().optional(),   // si falta, se usa la caja principal
  saldoInicial: z.number().nonnegative(),
});
export type AbrirSesionDto = z.infer<typeof AbrirSesionSchema>;

export const TIPO_MOVIMIENTO_CAJA_VALUES = [
  "ingreso_venta",
  "ingreso_cobro_cuenta_corriente",
  "ingreso_manual",
  "egreso_pago_proveedor",
  "egreso_devolucion",
  "egreso_manual",
  "egreso_retiro",
] as const;
export type TipoMovimientoCaja = (typeof TIPO_MOVIMIENTO_CAJA_VALUES)[number];

export const RegistrarMovimientoSchema = z.object({
  tipo:        z.enum(TIPO_MOVIMIENTO_CAJA_VALUES),
  medioPagoId: z.string().uuid(),
  importe:     z.number().positive(),
  motivo:      z.string().trim().min(10).max(500).nullish(),
  referencia:  z.string().trim().max(100).nullish(),
});
export type RegistrarMovimientoDto = z.infer<typeof RegistrarMovimientoSchema>;

export const CerrarSesionSchema = z.object({
  efectivoContado: z.number().nonnegative(),
  motivo:          z.string().trim().min(10).max(500).nullish(),
  observaciones:   z.string().trim().max(500).nullish(),
});
export type CerrarSesionDto = z.infer<typeof CerrarSesionSchema>;

export const ListarSesionesQuerySchema = z.object({
  estado: z.enum(["abierta", "cerrada"]).optional(),
  desde:  z.string().date().optional(),
  hasta:  z.string().date().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});
export type ListarSesionesQuery = z.infer<typeof ListarSesionesQuerySchema>;
