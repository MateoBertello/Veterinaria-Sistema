import { z } from "zod";

export const LoginSchema = z.object({
  // `trim` en el identificador: un espacio pegado desde el portapapeles o
  // agregado por el teclado predictivo no debe costar un 401. La CONTRASEÑA
  // no se toca — los espacios al borde pueden ser parte legítima de ella.
  username: z.string().trim().min(1, "El usuario es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const RecuperarPasswordSchema = z.object({
  email: z.string().email("Formato de email inválido"),
});

export const RecuperarUsuarioSchema = z.object({
  email: z.string().email("Formato de email inválido"),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, "El refresh token es requerido"),
});

export const ResetPasswordSchema = z.object({
  accessToken:   z.string().min(1, "El token es requerido"),
  nuevaPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export type LoginDto             = z.infer<typeof LoginSchema>;
export type RefreshDto           = z.infer<typeof RefreshSchema>;
export type RecuperarPasswordDto = z.infer<typeof RecuperarPasswordSchema>;
export type RecuperarUsuarioDto  = z.infer<typeof RecuperarUsuarioSchema>;
export type ResetPasswordDto     = z.infer<typeof ResetPasswordSchema>;
