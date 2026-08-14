import { z } from "zod";

// Valores EXACTOS del ENUM plan_tenant (migración 001).
export const PlanTenantEnum = z.enum(["basico", "profesional", "premium"]);

export const CrearTenantSchema = z.object({
  nombre:        z.string().min(3, "El nombre debe tener al menos 3 caracteres").max(120),
  cuitRut:       z.string().min(1, "El CUIT/RUT es requerido").max(50),
  emailContacto: z.string().email("Formato de email inválido"),
  plan:          PlanTenantEnum.default("basico"),
});

// Datos comerciales editables. No incluye 'activo' (se cambia vía /estado).
export const EditarTenantSchema = z.object({
  nombre:        z.string().min(3).max(120).optional(),
  emailContacto: z.string().email("Formato de email inválido").optional(),
  plan:          PlanTenantEnum.optional(),
});

export const CambiarEstadoSchema = z.object({
  activo: z.boolean(),
});

export const ListarTenantsQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  q:      z.string().trim().min(1).max(100).optional(),
  plan:   PlanTenantEnum.optional(),
  estado: z.enum(["activo", "suspendido"]).optional(),
});

export type CrearTenantDto         = z.infer<typeof CrearTenantSchema>;
export type EditarTenantDto        = z.infer<typeof EditarTenantSchema>;
export type CambiarEstadoDto       = z.infer<typeof CambiarEstadoSchema>;
export type ListarTenantsQueryDto  = z.infer<typeof ListarTenantsQuerySchema>;
