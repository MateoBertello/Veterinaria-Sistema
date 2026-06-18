import { z } from "zod";

export const LoginSchema = z.object({
  username: z.string().min(1, "El usuario es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const RecuperarPasswordSchema = z.object({
  email: z.string().email("Formato de email inválido"),
});

export const RecuperarUsuarioSchema = z.object({
  email: z.string().email("Formato de email inválido"),
});

export const ResetPasswordSchema = z.object({
  accessToken:   z.string().min(1, "El token es requerido"),
  nuevaPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export type LoginDto             = z.infer<typeof LoginSchema>;
export type RecuperarPasswordDto = z.infer<typeof RecuperarPasswordSchema>;
export type RecuperarUsuarioDto  = z.infer<typeof RecuperarUsuarioSchema>;
export type ResetPasswordDto     = z.infer<typeof ResetPasswordSchema>;
