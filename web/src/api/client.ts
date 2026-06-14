import type { ApiResponse } from "../types/index.ts";
import { ApiError } from "../types/index.ts";

const API_BASE = import.meta.env["VITE_API_URL"] ?? "/api/v1";

async function getToken(): Promise<string | null> {
  // En Etapa 2 se integrará con supabase.auth.getSession().
  // Por ahora lee de localStorage para poder testear manualmente.
  return localStorage.getItem("sb-token");
}

/**
 * Helper de fetch que:
 * 1. Agrega Authorization header con el JWT del usuario.
 * 2. Desempaqueta el envelope estándar: devuelve `data` en éxito.
 * 3. Lanza ApiError en caso de error de negocio o de red.
 */
export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkError) {
    throw new ApiError(
      "NETWORK_ERROR",
      0,
      "No se pudo conectar con el servidor",
      [networkError],
    );
  }

  const body = await response.json() as ApiResponse<T>;

  if (body.success) {
    return body.data;
  }

  throw new ApiError(
    body.error.code,
    body.error.statusCode,
    body.error.message,
    body.error.details,
  );
}
