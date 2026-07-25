import type { ApiMeta, ApiResponse, ApiSuccessResponse } from "../types/index.ts";
import { ApiError } from "../types/index.ts";
import { getToken } from "../lib/session.ts";

const API_BASE = import.meta.env["VITE_API_URL"] ?? "/api/v1";

// Handler de sesión expirada: lo registra el AuthProvider. Se dispara cuando un
// request AUTENTICADO (había token) recibe 401 → token vencido/inválido. El 401
// de credenciales en el propio login NO lo dispara (no había token todavía).
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Lee el cuerpo como envelope estándar, o `null` si la respuesta no lo es.
 *
 * No todo lo que contesta viene de nuestro handler de errores: una ruta que la
 * API desplegada no conoce devuelve el 404 en texto plano, y el gateway puede
 * responder 502/504 o HTML. Sin esto, `response.json()` explotaba con un
 * SyntaxError crudo que no era ApiError y llegaba a la pantalla como "error
 * inesperado", escondiendo el status —que es justo el dato que dice qué pasó.
 */
async function readEnvelope<T>(response: Response): Promise<ApiResponse<T> | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  if (!body || typeof body !== "object" || !("success" in body)) return null;
  return body as ApiResponse<T>;
}

/** Mensaje para una respuesta que no respeta el envelope, según su status. */
function mensajeFueraDeContrato(status: number): string {
  if (status === 404) {
    return "El servidor no reconoce este endpoint (404): puede que la API desplegada no incluya esta función.";
  }
  if (status >= 500) {
    return `El servidor no respondió correctamente (HTTP ${status}). Intentá de nuevo en unos minutos.`;
  }
  return `Respuesta inesperada del servidor (HTTP ${status}).`;
}

/**
 * Realiza el fetch, agrega el JWT, parsea el envelope estándar y lanza ApiError
 * (negocio o red). Devuelve el envelope de éxito completo (data + meta).
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiSuccessResponse<T>> {
  const token = getToken();

  // Con FormData (subida de adjuntos) el browser debe fijar su propio
  // Content-Type con el boundary del multipart; forzar JSON acá lo rompe.
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

  const body = await readEnvelope<T>(response);

  if (body?.success) {
    return body;
  }

  // Token vencido/inválido en un request autenticado → limpiar sesión y volver a
  // login. Solo si HABÍA token al hacer el request: así el 401 de credenciales
  // inválidas del propio login (sin token aún) no dispara el auto-logout. Vale
  // también cuando el 401 no trae envelope (lo corta el gateway, no la API).
  if (response.status === 401 && token) {
    onUnauthorized?.();
  }

  if (!body) {
    throw new ApiError(
      "INVALID_RESPONSE",
      response.status,
      mensajeFueraDeContrato(response.status),
    );
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

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"; ]+)"?/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Variante para endpoints que devuelven un archivo binario crudo en éxito (no
 * el envelope JSON estándar) — p. ej. exportación de historial en PDF/XLSX o
 * el CSV de auditoría. En error, el backend sí responde el envelope JSON de
 * siempre. Devuelve también los `headers` crudos: algunos exports (auditoría)
 * informan metadata propia ahí (p. ej. truncado) que no cabe en filename/blob.
 */
export async function apiClientBlob(
  path: string,
  options: RequestInit = {},
): Promise<{ blob: Blob; filename: string | null; headers: Headers }> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (networkError) {
    throw new ApiError("NETWORK_ERROR", 0, "No se pudo conectar con el servidor", [networkError]);
  }

  if (!response.ok) {
    // Mismo criterio que `request`: el error puede no venir de nuestro handler
    // (404 de ruta, 5xx del gateway) y ahí no hay envelope que leer.
    const body = await readEnvelope<never>(response);
    if (response.status === 401 && token) {
      onUnauthorized?.();
    }
    if (!body || body.success) {
      throw new ApiError("INVALID_RESPONSE", response.status, mensajeFueraDeContrato(response.status));
    }
    throw new ApiError(body.error.code, body.error.statusCode, body.error.message, body.error.details);
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(response.headers.get("Content-Disposition"));
  return { blob, filename, headers: response.headers };
}
