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
 *
 * Todo acceso a `localStorage` está envuelto en try/catch (mismo criterio que
 * `PreferencesContext.tsx`): en Safari iOS con navegación privada bloqueada,
 * en storage deshabilitado por política o en cuota agotada, `setItem`/`getItem`
 * pueden lanzar. Sin este resguardo, un login exitoso terminaba en una
 * excepción sin capturar (`AuthContext.tsx` llama a `setSession` justo después
 * de autenticar) y la pantalla mostraba "error inesperado" pese a que el
 * backend ya había aceptado las credenciales. Con el resguardo, la sesión cae
 * a un respaldo en memoria: no sobrevive un reload, pero la pestaña actual
 * queda autenticada igual.
 */

export type SessionScope = "tenant" | "platform";

const CLAVES: Record<SessionScope, { token: string; refresh: string }> = {
  tenant:   { token: "sb-token",          refresh: "sb-refresh-token" },
  platform: { token: "sb-platform-token", refresh: "sb-platform-refresh-token" },
};

/**
 * Respaldo en memoria, usado solo cuando `localStorage` no responde. Se
 * consulta ANTES que `localStorage.getItem`: en algunos navegadores `setItem`
 * lanza pero un `getItem` posterior no (devuelve `null`, como si nunca se
 * hubiera guardado nada), y ese `null` silencioso taparía el respaldo si se
 * consultara solo cuando `getItem` lanza.
 */
const memoria: Partial<Record<string, string>> = {};

function leer(clave: string): string | null {
  if (clave in memoria) return memoria[clave] ?? null;
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
    delete memoria[clave]; // se pudo persistir: dejá de enmascararlo con memoria.
  } catch {
    memoria[clave] = valor;
  }
}

function borrar(clave: string): void {
  delete memoria[clave];
  try {
    localStorage.removeItem(clave);
  } catch {
    // Si nunca se pudo persistir, tampoco hay nada que borrar ahí.
  }
}

export function getToken(scope: SessionScope = "tenant"): string | null {
  return leer(CLAVES[scope].token);
}

export function setToken(token: string, scope: SessionScope = "tenant"): void {
  escribir(CLAVES[scope].token, token);
}

export function getRefreshToken(scope: SessionScope = "tenant"): string | null {
  return leer(CLAVES[scope].refresh);
}

export function setRefreshToken(token: string, scope: SessionScope = "tenant"): void {
  escribir(CLAVES[scope].refresh, token);
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
  borrar(CLAVES[scope].token);
  borrar(CLAVES[scope].refresh);
}
