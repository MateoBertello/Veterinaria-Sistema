import { apiClient } from "./client.ts";
import { getRefreshToken } from "../lib/session.ts";
import type {
  PlatformLoginInput,
  PlatformLoginResult,
  RefreshResult,
} from "../types/index.ts";

/**
 * Autenticación de la consola de plataforma (`/api/v1/admin/auth/*`).
 *
 * Es el único camino que produce un token de Super Admin. El login de la clínica
 * (`POST /auth/login`) no puede darlo: resuelve el identificador contra la tabla
 * `usuarios`, donde el Super Admin no tiene fila porque no pertenece a ningún
 * tenant.
 *
 * Los tokens que devuelve `login` los guarda `PlatformAuthContext` en el scope
 * `platform` de `lib/session.ts`; `api/client.ts` los usa para todo request a
 * `/admin/*` y los renueva contra `/admin/auth/refresh` sin tocar la sesión de
 * la clínica.
 */

/**
 * Inicia sesión como Super Admin. El backend responde el MISMO
 * `401 UNAUTHORIZED "Credenciales inválidas"` ante cualquier fracaso —email
 * inexistente, contraseña equivocada o cuenta sin el claim de plataforma—, así
 * que no hay nada que interpretar acá: el formulario muestra un mensaje único.
 */
export function platformLogin(input: PlatformLoginInput): Promise<PlatformLoginResult> {
  return apiClient<PlatformLoginResult>("/admin/auth/login", {
    method: "POST",
    body:   JSON.stringify(input),
  });
}

/** Invalida la sesión de plataforma en Supabase y registra auditoría. Best-effort. */
export function platformLogoutRequest(): Promise<{ message: string }> {
  return apiClient<{ message: string }>("/admin/auth/logout", { method: "POST" });
}

// Un solo refresh de arranque en vuelo. `client.ts` ya deduplica los refrescos
// que dispara un 401, pero el del bootstrap sale de un `useEffect` — y en
// StrictMode los efectos corren dos veces al montar. Sin esta guarda, el segundo
// intento usaría un refresh token que GoTrue acaba de rotar y cerraría la sesión
// que estábamos justamente recuperando.
let refrescoEnVuelo: Promise<RefreshResult> | null = null;

/**
 * Renueva la sesión de plataforma con el refresh token guardado.
 *
 * La usa `PlatformAuthProvider` al arrancar cuando el access token ya venció
 * pero el refresh sigue vivo: es el caso de volver a la consola al otro día. Sin
 * esto, el guard veía un token vencido, lo daba por "sin sesión" y mandaba al
 * login aunque la sesión fuera perfectamente renovable — que es la forma nueva
 * del viejo "se muere a la hora exacta".
 */
export function platformRefresh(): Promise<RefreshResult> {
  if (refrescoEnVuelo) return refrescoEnVuelo;

  const refreshToken = getRefreshToken("platform");
  if (!refreshToken) {
    return Promise.reject(new Error("No hay refresh token de plataforma"));
  }

  refrescoEnVuelo = apiClient<RefreshResult>("/admin/auth/refresh", {
    method: "POST",
    body:   JSON.stringify({ refreshToken }),
  }).finally(() => {
    refrescoEnVuelo = null;
  });

  return refrescoEnVuelo;
}
