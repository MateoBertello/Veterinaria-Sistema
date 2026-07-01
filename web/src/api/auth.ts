import { apiClient } from "./client.ts";
import type { AuthUser, LoginInput, LoginResult } from "../types/index.ts";

/**
 * Autentica por usuario/contraseña. El backend devuelve el mismo `401
 * UNAUTHORIZED "Credenciales inválidas"` para credenciales mal o usuario
 * inactivo (RN-AUT1): no revela cuál falló. Devuelve el JWT + datos del usuario.
 */
export function login(input: LoginInput): Promise<LoginResult> {
  return apiClient<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Perfil del usuario autenticado; usado para rehidratar la sesión al bootear. */
export function fetchMe(): Promise<AuthUser> {
  return apiClient<AuthUser>("/auth/me");
}

/** Invalida el token en Supabase y registra auditoría. Best-effort en el logout. */
export function logoutRequest(): Promise<{ message: string }> {
  return apiClient<{ message: string }>("/auth/logout", { method: "POST" });
}
