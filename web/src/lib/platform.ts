import { getToken } from "./session.ts";

/**
 * Identidad de PLATAFORMA (Super Admin), leída del propio JWT de sesión.
 *
 * El Super Admin opera FUERA de todo tenant: su JWT no lleva
 * `app_metadata.tenant_id` sino `app_metadata.platform_role='super_admin'` — el
 * mismo claim que exige el middleware `requireSuperAdmin` del backend y la
 * función SQL `is_super_admin()`. Por eso NO se resuelve con `GET /auth/me`
 * (ese endpoint pasa por `tenantContext` y exige tenant_id): el front lee el
 * claim del token, que es el equivalente exacto de la sesión.
 *
 * Esto es un gate de UX, no la autorización: el backend revalida el claim en
 * cada request de /admin/*. Un token manipulado en el browser abre la pantalla
 * pero cada llamada responde 403 FORBIDDEN.
 */
export interface PlatformSession {
  /** `sub` del JWT: el id del Super Admin (el que audita el backend, RN-SA5). */
  superAdminId: string;
  email:        string | null;
  /** `exp` en milisegundos, o null si el token no lo declara. */
  expiresAt:    number | null;
}

/** Decodifica el payload de un JWT (sin verificar la firma: eso es del backend). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = atob(padded);

    // atob devuelve latin1: recomponer los bytes para leer UTF-8 (acentos, ñ).
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);

    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Sesión de plataforma del token dado, o null si no acredita super_admin. */
export function platformSessionFromToken(token: string | null): PlatformSession | null {
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const appMetadata = payload["app_metadata"] as Record<string, unknown> | undefined;
  if (appMetadata?.["platform_role"] !== "super_admin") return null;

  const superAdminId = payload["sub"];
  if (typeof superAdminId !== "string" || superAdminId.trim() === "") return null;

  // Token vencido: el backend lo rechazaría igual; no se abre la consola.
  const exp = typeof payload["exp"] === "number" ? payload["exp"] * 1000 : null;
  if (exp !== null && exp <= Date.now()) return null;

  const email = typeof payload["email"] === "string" ? payload["email"] : null;

  return { superAdminId, email, expiresAt: exp };
}

/** Sesión de plataforma del token almacenado, o null si no hay Super Admin. */
export function getPlatformSession(): PlatformSession | null {
  return platformSessionFromToken(getToken());
}

/** `true` si la sesión actual acredita Super Admin de plataforma. */
export function isSuperAdmin(): boolean {
  return getPlatformSession() !== null;
}
