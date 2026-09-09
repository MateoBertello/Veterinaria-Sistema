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

/**
 * Alta del usuario administrador inicial de una clínica
 * (`POST /admin/tenants/:id/admin`).
 *
 * El `tenant_id` NO viaja acá: sale del `:id` de la ruta, que es la convención
 * de toda la familia `/admin/tenants/*`. Un `tenantId` que llegue en el body se
 * ignora (Zod descarta las claves desconocidas), y hay un test que lo fija.
 *
 * `rol` es el NOMBRE del rol, no su id: el Super Admin opera fuera de la clínica
 * y no tiene por qué conocer los uuid que `on_tenant_created` le generó. El
 * Service lo resuelve contra los roles DE ESE tenant.
 *
 * `username` es opcional. Si no viene, el Service lo deriva del email y lo
 * desambigua dentro de la clínica: es un dato que el operador no siempre tiene
 * decidido en el momento del alta, y la columna es NOT NULL.
 *
 * `password` es OBLIGATORIA y no se genera. Una contraseña generada tendría que
 * volver en la respuesta de la API, y ahí queda en el scrollback de la terminal,
 * en el historial del cliente HTTP y en cualquier log de respuestas que alguien
 * agregue después — un rastro que nadie borra y que sobrevive al primer cambio
 * de contraseña. Que la elija quien da el alta la mantiene fuera de la respuesta
 * y deja la entrega por el canal que ese operador ya eligió.
 */
export const RolInicialEnum = z.enum(["admin", "veterinario", "recepcionista"]);

export const CrearAdminTenantSchema = z.object({
  email:    z.string().email("Formato de email inválido"),
  fullName: z.string().min(1, "El nombre completo es requerido").max(150),
  rol:      RolInicialEnum.default("admin"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  username: z.string()
              .min(3, "El usuario debe tener al menos 3 caracteres")
              .max(50)
              .regex(/^[a-zA-Z0-9_.-]+$/, "Solo letras, números, _, . y -")
              .optional(),
});

export type RolInicial          = z.infer<typeof RolInicialEnum>;
export type CrearAdminTenantDto = z.infer<typeof CrearAdminTenantSchema>;
