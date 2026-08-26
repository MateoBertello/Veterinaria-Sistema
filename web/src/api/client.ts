import type { ApiMeta, ApiResponse, ApiSuccessResponse } from "../types/index.ts";
import { ApiError } from "../types/index.ts";
import {
  clearToken,
  getRefreshToken,
  getToken,
  setSession,
  type SessionScope,
} from "../lib/session.ts";

const API_BASE = import.meta.env["VITE_API_URL"] ?? "/api/v1";

// Handlers de sesión expirada, UNO POR SESIÓN. Se disparan cuando un request
// AUTENTICADO (había token) recibe 401 → token vencido/inválido. El 401 de
// credenciales en el propio login NO los dispara (no había token todavía).
//
// Están separados porque las dos sesiones no tienen nada que ver entre sí: el
// Super Admin vive fuera de todo tenant. Con un único handler, cualquier 401 de
// un endpoint de tenant —una pestaña vieja del shell de la clínica, un
// /auth/me con el token vencido— terminaba en `clearToken()` y se llevaba
// puesta la sesión de plataforma, que seguía siendo válida para /admin/*.
// Ahora el 401 de un scope solo puede cerrar ese scope.
const onUnauthorized: Record<SessionScope, (() => void) | null> = {
  tenant:   null,
  platform: null,
};

/** Registra el handler de 401 de la sesión de TENANT (lo hace `AuthProvider`). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized.tenant = handler;
}

/** Registra el handler de 401 de la sesión de PLATAFORMA (lo hace `PlatformAuthProvider`). */
export function setPlatformUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized.platform = handler;
}

/**
 * A qué sesión pertenece un request, por su path.
 *
 * Todo lo que cuelga de `/admin` es consola de plataforma y viaja con el token
 * del Super Admin; el resto de la API es del tenant. No hay path que sirva a las
 * dos, así que la regla alcanza y no hace falta que cada llamador lo declare.
 */
function scopeDePath(path: string): SessionScope {
  return path.startsWith("/admin") ? "platform" : "tenant";
}

// ─── Renovación de sesión ────────────────────────────────────────────────────

/** Endpoint de renovación de cada sesión. */
const RUTA_REFRESH: Record<SessionScope, string> = {
  tenant:   "/auth/refresh",
  platform: "/admin/auth/refresh",
};

/**
 * Rutas cuyo 401 NO se intenta renovar: el del login es "credenciales mal" y el
 * del refresh es "el refresh token ya no sirve". Reintentarlos sería un bucle.
 * Vale para los dos logins: el del tenant y el de plataforma.
 */
function esRenovable(path: string): boolean {
  return ![
    "/auth/login",
    "/auth/refresh",
    "/admin/auth/login",
    "/admin/auth/refresh",
  ].some((ruta) => path.startsWith(ruta));
}

// Un solo refresh en vuelo POR SESIÓN: si vencen varios requests en paralelo (el
// caso normal al volver a una pestaña dormida), todos esperan la MISMA
// renovación en vez de disparar una cada uno y pisarse el refresh token rotado.
const refrescoEnVuelo: Record<SessionScope, Promise<boolean> | null> = {
  tenant:   null,
  platform: null,
};

async function renovarSesion(scope: SessionScope): Promise<boolean> {
  const enVuelo = refrescoEnVuelo[scope];
  if (enVuelo) return enVuelo;

  const refreshToken = getRefreshToken(scope);
  if (!refreshToken) return false;

  const promesa = (async () => {
    try {
      const response = await fetch(`${API_BASE}${RUTA_REFRESH[scope]}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refreshToken }),
      });

      const body = await response.json().catch(() => null) as
        | { success?: boolean; data?: { token?: string; refreshToken?: string } }
        | null;

      if (!response.ok || !body?.success || !body.data?.token) return false;

      // GoTrue rota el refresh token en cada uso: hay que guardar el nuevo par.
      setSession(body.data.token, body.data.refreshToken ?? "", scope);
      return true;
    } catch {
      return false;
    } finally {
      refrescoEnVuelo[scope] = null;
    }
  })();

  refrescoEnVuelo[scope] = promesa;
  return promesa;
}

/**
 * Cierra la sesión del scope que acaba de recibir un 401 irrecuperable: borra
 * SUS tokens y avisa al provider correspondiente. La otra sesión no se toca.
 */
function cerrarSesionVencida(scope: SessionScope): void {
  clearToken(scope);
  onUnauthorized[scope]?.();
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
  yaReintentado = false,
): Promise<ApiSuccessResponse<T>> {
  // El path decide con QUÉ sesión viaja el request: /admin/* va con el token de
  // plataforma, el resto con el del tenant.
  const scope = scopeDePath(path);
  const token = getToken(scope);

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

  // Token vencido/inválido en un request autenticado. Antes de cerrar la sesión
  // se intenta renovarla con el refresh token y repetir el request UNA vez: el
  // access token dura una hora y vencía en medio de cualquier pantalla, tirando
  // al usuario a /login y haciéndole perder lo que estuviera cargando.
  // Solo si HABÍA token: así el 401 de credenciales inválidas del propio login
  // (sin token aún) no dispara nada. Vale también cuando el 401 no trae envelope
  // (lo corta el gateway, no la API).
  if (response.status === 401 && token) {
    if (!yaReintentado && esRenovable(path) && await renovarSesion(scope)) {
      return request<T>(path, options, true);
    }
    cerrarSesionVencida(scope);
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
  yaReintentado = false,
): Promise<{ blob: Blob; filename: string | null; headers: Headers }> {
  const scope = scopeDePath(path);
  const token = getToken(scope);
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
      // Mismo criterio que `request`: renovar y reintentar una vez antes de
      // cerrar la sesión (una exportación larga puede cruzar el vencimiento).
      if (!yaReintentado && esRenovable(path) && await renovarSesion(scope)) {
        return apiClientBlob(path, options, true);
      }
      cerrarSesionVencida(scope);
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
