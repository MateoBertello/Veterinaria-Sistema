import { z } from "zod";

// Valores de los ENUMs de PostgreSQL (accion_auditoria, modulo_auditoria).
// Deben mantenerse sincronizados con shared/audit.ts y las migraciones.
export const AUDIT_ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "CANCEL",
  "LOGIN",  "LOGOUT", "VIEW",   "EXPORT",
] as const;

export const AUDIT_MODULES = [
  "clients", "pets", "medical_records", "appointments", "daycare",
  "users",   "security", "services", "system", "platform",
] as const;

const filtrosBase = {
  search:   z.string().trim().max(100).optional(),
  module:   z.enum(AUDIT_MODULES).optional(),
  action:   z.enum(AUDIT_ACTIONS).optional(),
  userId:   z.string().uuid().optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo:   z.string().datetime({ offset: true }).optional(),
};

export const ListarAuditoriaQuerySchema = z.object({
  ...filtrosBase,
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ExportarAuditoriaQuerySchema = z.object({
  ...filtrosBase,
});

export type ListarAuditoriaOpts   = z.infer<typeof ListarAuditoriaQuerySchema>;
export type ExportarAuditoriaOpts = z.infer<typeof ExportarAuditoriaQuerySchema>;
