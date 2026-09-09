import { z } from "zod";

// Valores del ENUM condicion_venta_producto (20260901000001_comercial_enums.sql).
export const CONDICION_VENTA_VALUES = [
  "libre",
  "bajo_receta",
  "bajo_receta_archivada",
  "uso_profesional",
] as const;

// RN-PR4: alícuotas admitidas. El CHECK de la base es la defensa real; esto
// devuelve un 422 legible en vez de un 500 con el mensaje de Postgres.
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;

export const CrearProductoSchema = z.object({
  codigo:                    z.string().trim().min(1).max(50),
  nombre:                    z.string().trim().min(3).max(150),
  descripcion:               z.string().max(500).nullish(),
  familiaId:                 z.string().uuid().nullish(),
  unidadMedidaId:            z.string().uuid(),
  marca:                     z.string().max(80).nullish(),
  alicuotaIva:               z
    .number()
    .refine(
      (v) => (ALICUOTAS_IVA as readonly number[]).includes(v),
      "La alícuota debe ser 0, 10.50, 21 o 27",
    )
    .default(21),
  condicionVenta:            z.enum(CONDICION_VENTA_VALUES).default("libre"),
  controlaLote:              z.boolean().default(true),
  controlaVencimiento:       z.boolean().default(true),
  vidaUtilPostAperturaDias:  z.number().int().min(1).max(3650).nullish(),
  precioVenta:               z.number().nonnegative().nullish(),
  costoReposicion:           z.number().nonnegative().nullish(),
  margenObjetivo:            z.number().min(0).max(999.99).nullish(),
  stockMinimo:               z.number().nonnegative().nullish(),
  esVendible:                z.boolean().default(true),
  esConsumibleClinico:       z.boolean().default(false),
  requiereFrio:              z.boolean().default(false),
  trazable:                  z.boolean().default(false),
  codigoBarras:              z.string().trim().max(50).nullish(),
});

export const ActualizarProductoSchema = CrearProductoSchema.partial();
export const CambiarEstadoProductoSchema = z.object({ activo: z.boolean() });

export const ListarProductosQuerySchema = z.object({
  search:       z.string().trim().min(1).max(100).optional(),
  familiaId:    z.string().uuid().optional(),
  codigoBarras: z.string().trim().optional(),
  activo:       z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  vendible:     z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
});

export const CrearFamiliaSchema = z.object({
  nombre:       z.string().trim().min(2).max(100),
  unidadBaseId: z.string().uuid(), // RN-PR8: obligatorio, sin default
});
export const ActualizarFamiliaSchema = CrearFamiliaSchema.partial();

export const ListarFamiliasQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  activo: z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export const CrearConversionSchema = z.object({
  productoOrigenId:        z.string().uuid(),
  productoDestinoId:       z.string().uuid(),
  factorTeorico:           z.number().positive(),
  mermaEsperadaPorcentaje: z.number().min(0).max(100).default(0),
});
export const ActualizarConversionSchema = CrearConversionSchema.partial();

export const ListarConversionesQuerySchema = z.object({
  productoOrigenId: z.string().uuid().optional(),
  activo:           z.string().optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:             z.coerce.number().int().min(1).default(1),
  limit:            z.coerce.number().int().min(1).max(100).default(20),
});

export const CrearDerivadoSchema = z.object({
  codigo:                   z.string().trim().min(1).max(50),
  nombre:                   z.string().trim().min(3).max(150),
  unidadMedidaId:           z.string().uuid(),
  factorTeorico:            z.number().positive(),
  mermaEsperadaPorcentaje:  z.number().min(0).max(100).default(0),
  precioVenta:              z.number().nonnegative().nullish(),
  vidaUtilPostAperturaDias: z.number().int().min(1).max(3650).nullish(),
  stockMinimo:              z.number().nonnegative().nullish(),
  descripcion:              z.string().max(500).nullish(),
});

export type CrearProductoDto = z.infer<typeof CrearProductoSchema>;
export type ActualizarProductoDto = z.infer<typeof ActualizarProductoSchema>;
export type CambiarEstadoProductoDto = z.infer<typeof CambiarEstadoProductoSchema>;
export type ListarProductosQuery = z.infer<typeof ListarProductosQuerySchema>;
export type CrearDerivadoDto = z.infer<typeof CrearDerivadoSchema>;

export type CrearFamiliaDto = z.infer<typeof CrearFamiliaSchema>;
export type ActualizarFamiliaDto = z.infer<typeof ActualizarFamiliaSchema>;
export type ListarFamiliasQuery = z.infer<typeof ListarFamiliasQuerySchema>;

export type CrearConversionDto = z.infer<typeof CrearConversionSchema>;
export type ActualizarConversionDto = z.infer<typeof ActualizarConversionSchema>;
export type ListarConversionesQuery = z.infer<typeof ListarConversionesQuerySchema>;

