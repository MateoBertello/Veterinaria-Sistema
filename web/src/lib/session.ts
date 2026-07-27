// Almacenamiento de los tokens de sesión. La clave `sb-token` es la MISMA que lee
// `api/client.ts` (Authorization: Bearer) y `api/catalogos.ts` (PostgREST directo);
// hasta la Etapa 2 se seteaba a mano por consola y ahora lo gestiona el login.
const TOKEN_KEY = "sb-token";

// El access token dura una hora (`jwt_expiry`). Sin el refresh token, al vencer
// se cerraba la sesión de golpe en medio de lo que el usuario estuviera
// haciendo; con él, `api/client.ts` renueva y reintenta sin que se note.
const REFRESH_TOKEN_KEY = "sb-refresh-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/** Guarda el par completo. GoTrue ROTA el refresh token: siempre hay que pisar los dos. */
export function setSession(token: string, refreshToken: string): void {
  setToken(token);
  if (refreshToken) setRefreshToken(refreshToken);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
