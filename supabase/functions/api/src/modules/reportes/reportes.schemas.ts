import { z } from "zod";

export const ValorizacionAFechaQuerySchema = z.object({
  fechaCorte: z.string().optional(),
  productoId: z.string().uuid("productoId debe ser un UUID válido").optional(),
  familiaId: z.string().uuid("familiaId debe ser un UUID válido").optional(),
});

export type ValorizacionAFechaQuery = z.infer<typeof ValorizacionAFechaQuerySchema>;

export const ReporteRotacionQuerySchema = z.object({
  diasSinMovimiento: z.coerce.number().int().min(1).default(30),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  familiaId: z.string().uuid("familiaId debe ser un UUID válido").optional(),
});

export type ReporteRotacionQuery = z.infer<typeof ReporteRotacionQuerySchema>;

export const ReporteRentabilidadQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  familiaId: z.string().uuid("familiaId debe ser un UUID válido").optional(),
  productoId: z.string().uuid("productoId debe ser un UUID válido").optional(),
});

export type ReporteRentabilidadQuery = z.infer<typeof ReporteRentabilidadQuerySchema>;

export const ReporteFraccionamientoQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  productoOrigenId: z.string().uuid("productoOrigenId debe ser un UUID válido").optional(),
  productoDestinoId: z.string().uuid("productoDestinoId debe ser un UUID válido").optional(),
});

export type ReporteFraccionamientoQuery = z.infer<typeof ReporteFraccionamientoQuerySchema>;

export const ReporteVentasUsuarioQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  usuarioId: z.string().uuid("usuarioId debe ser un UUID válido").optional(),
});

export type ReporteVentasUsuarioQuery = z.infer<typeof ReporteVentasUsuarioQuerySchema>;

export const ReporteVentasSesionQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  cajaId: z.string().uuid("cajaId debe ser un UUID válido").optional(),
  sesionId: z.string().uuid("sesionId debe ser un UUID válido").optional(),
});

export type ReporteVentasSesionQuery = z.infer<typeof ReporteVentasSesionQuerySchema>;

export const ReporteVentasMedioPagoQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  medioPagoId: z.string().uuid("medioPagoId debe ser un UUID válido").optional(),
});

export type ReporteVentasMedioPagoQuery = z.infer<typeof ReporteVentasMedioPagoQuerySchema>;

export const ReporteConsumoProfesionalQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  profesionalId: z.string().uuid("profesionalId debe ser un UUID válido").optional(),
});

export type ReporteConsumoProfesionalQuery = z.infer<typeof ReporteConsumoProfesionalQuerySchema>;

export const ReporteConsumoEspecieQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  especieId: z.string().uuid("especieId debe ser un UUID válido").optional(),
});

export type ReporteConsumoEspecieQuery = z.infer<typeof ReporteConsumoEspecieQuerySchema>;
