import type { ApiMeta, ApiResponse, ApiSuccessResponse } from "../types/index.ts";
import { ApiError } from "../types/index.ts";

const API_BASE = import.meta.env["VITE_API_URL"] ?? "/api/v1";

async function getToken(): Promise<string | null> {
  // En Etapa 2 se integrará con supabase.auth.getSession().
  // Por ahora lee de localStorage para poder testear manualmente.
  return localStorage.getItem("sb-token");
}

/**
 * Realiza el fetch, agrega el JWT, parsea el envelope estándar y lanza ApiError
 * (negocio o red). Devuelve el envelope de éxito completo (data + meta).
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiSuccessResponse<T>> {
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
    return body;
  }

  throw new ApiError(
    body.error.code,
    body.error.statusCode,
    body.error.message,
    body.error.details,
  );
}

/** Desempaqueta el envelope estándar: devuelve `data` en éxito. */
export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const body = await request<T>(path, options);
  return body.data;
}

/**
 * Variante para listados: devuelve `data` junto con `meta` (paginación). El
 * `apiClient` descarta `meta`, por eso los listados paginados usan este helper.
 */
export async function apiClientList<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ items: T[]; meta: ApiMeta }> {
  const body = await request<T[]>(path, options);
  const meta = body.meta ?? { page: 1, limit: body.data.length, total: body.data.length };
  return { items: body.data, meta };
}
