// Almacenamiento del JWT de sesión. La clave `sb-token` es la MISMA que lee
// `api/client.ts` (Authorization: Bearer) y `api/catalogos.ts` (PostgREST directo);
// hasta la Etapa 2 se seteaba a mano por consola y ahora lo gestiona el login.
const TOKEN_KEY = "sb-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
