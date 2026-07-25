import { z } from "zod";

export const CrearUsuarioSchema = z.object({
  username:  z.string().min(3, "El usuario debe tener al menos 3 caracteres")
                       .max(50)
                       .regex(/^[a-zA-Z0-9_.-]+$/, "Solo letras, números, _, . y -"),
  password:  z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  fullName:  z.string().min(1, "El nombre completo es requerido").max(150),
  email:     z.string().email("Formato de email inválido"),
  phone:     z.string()
                       .regex(
                         /^\+?[\d\s()-]{6,20}$/,
                         "El teléfono solo admite números y los símbolos + - ( ) y espacios",
                       )
                       .optional(),
  roleId:    z.string().regex(
               /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
               "El roleId debe ser un UUID válido"
             ),
  active:    z.boolean().optional().default(true),
});

export const EditarUsuarioSchema = CrearUsuarioSchema
  .omit({ password: true })
  .partial()
  .extend({
    active: z.boolean().optional(),
  });

export const ListarUsuariosQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearUsuarioDto         = z.infer<typeof CrearUsuarioSchema>;
export type EditarUsuarioDto        = z.infer<typeof EditarUsuarioSchema>;
export type ListarUsuariosQueryDto  = z.infer<typeof ListarUsuariosQuerySchema>;
