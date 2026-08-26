/**
 * Almacenamiento de los tokens de sesión.
 *
 * Hay DOS sesiones independientes y nunca se pisan:
 *
 *  • `tenant`   — la sesión de la clínica. Su clave `sb-token` es la MISMA que
 *    lee `api/catalogos.ts` para hablarle a PostgREST directo.
 *  • `platform` — la sesión del Super Admin (consola `/admin/*`). Vive en claves
 *    propias porque es OTRA identidad: no tiene tenant, no tiene permisos de rol
 *    y no la entiende ningún endpoint de tenant.
 *
 * Separarlas no es prolijidad: mientras compartían la clave `sb-token`, un 401
 * de cualquier endpoint de tenant disparaba el auto-logout y borraba un token
 * que era perfectamente válido para `/admin/*`, expulsando al Super Admin de la
 * consola por un error que no era suyo. Con claves distintas, cada 401 solo
 * puede cerrar la sesión que lo produjo.
 *
 * El access token dura una hora (`jwt_expiry`). Sin el refresh token, al vencer
 * se cerraba la sesión de golpe en medio de lo que el usuario estuviera
 * haciendo; con él, `api/client.ts` renueva y reintenta sin que se note. Vale
 * para las dos sesiones por igual.
 */

export type SessionScope = "tenant" | "platform";

const CLAVES: Record<SessionScope, { token: string; refresh: string }> = {
  tenant:   { token: "sb-token",          refresh: "sb-refresh-token" },
  platform: { token: "sb-platform-token", refresh: "sb-platform-refresh-token" },
};

export function getToken(scope: SessionScope = "tenant"): string | null {
  return localStorage.getItem(CLAVES[scope].token);
}

export function setToken(token: string, scope: SessionScope = "tenant"): void {
  localStorage.setItem(CLAVES[scope].token, token);
}

export function getRefreshToken(scope: SessionScope = "tenant"): string | null {
  return localStorage.getItem(CLAVES[scope].refresh);
}

export function setRefreshToken(token: string, scope: SessionScope = "tenant"): void {
  localStorage.setItem(CLAVES[scope].refresh, token);
}

/** Guarda el par completo. GoTrue ROTA el refresh token: siempre hay que pisar los dos. */
export function setSession(
  token: string,
  refreshToken: string,
  scope: SessionScope = "tenant",
): void {
  setToken(token, scope);
  if (refreshToken) setRefreshToken(refreshToken, scope);
}

/** Borra UNA sesión. Nunca las dos: son identidades distintas (ver arriba). */
export function clearToken(scope: SessionScope = "tenant"): void {
  localStorage.removeItem(CLAVES[scope].token);
  localStorage.removeItem(CLAVES[scope].refresh);
}
