import { z } from "zod";

/**
 * Login de PLATAFORMA (`POST /admin/auth/login`). El Super Admin no vive en la
 * tabla `usuarios` —no pertenece a ningún tenant—, así que no tiene username:
 * su identificador es el email con el que existe en Supabase Auth.
 *
 * El email NO se valida con `.email()` a propósito. Si lo hiciera, un
 * identificador mal formado saldría por 422 sin pasar por el rate limit ni por
 * GoTrue, y ese 422 sería una respuesta distinguible del 401 genérico: bastaría
 * para separar "esto no es un email" de "esto es un email pero falló". Se acepta
 * cualquier texto no vacío y lo rechaza GoTrue, de modo que TODO intento cuenta
 * contra el limitador y TODO fracaso se ve igual.
 */
export const PlatformLoginSchema = z.object({
  email:    z.string().trim().min(1, "El email es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const PlatformRefreshSchema = z.object({
  refreshToken: z.string().min(1, "El refresh token es requerido"),
});

export type PlatformLoginDto   = z.infer<typeof PlatformLoginSchema>;
export type PlatformRefreshDto = z.infer<typeof PlatformRefreshSchema>;
