import { z } from "zod";

// Valores EXACTOS del ENUM modulo_vendible (migración 001) — módulos vendibles.
export const ModuloVendibleEnum = z.enum([
  "historial_clinico",
  "turnos",
  "guarderia",
  "stock",
  "ventas",
]);

// Body del toggle: PUT /admin/tenants/:id/modulos/:modulo (Addendum §7).
export const ToggleModuloSchema = z.object({
  habilitado: z.boolean(),
});

export type ModuloVendible  = z.infer<typeof ModuloVendibleEnum>;
export type ToggleModuloDto = z.infer<typeof ToggleModuloSchema>;
