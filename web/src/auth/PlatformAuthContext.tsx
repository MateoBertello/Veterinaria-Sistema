import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setPlatformUnauthorizedHandler } from "../api/client.ts";
import { platformLogin, platformLogoutRequest, platformRefresh } from "../api/platformAuth.ts";
import { clearToken, getRefreshToken, setSession as guardarSesion } from "../lib/session.ts";
import {
  getPlatformSession,
  platformSessionFromToken,
  type PlatformSession,
} from "../lib/platform.ts";
import type { PlatformLoginInput } from "../types/index.ts";

type PlatformAuthStatus = "loading" | "authenticated" | "anonymous";

interface PlatformAuthContextValue {
  /** `loading` mientras se intenta recuperar una sesión vencida pero renovable. */
  status:  PlatformAuthStatus;
  /** Sesión de plataforma vigente, o `null` si no hay Super Admin logueado. */
  session: PlatformSession | null;
  /** Autentica contra `/admin/auth/login`. Propaga `ApiError` para que el form lo mapee. */
  login:   (input: PlatformLoginInput) => Promise<void>;
  /** Cierra la sesión de plataforma (best-effort en el backend). */
  logout:  () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

/**
 * Sesión de la consola de plataforma (Super Admin), separada de la del tenant.
 *
 * No tiene bootstrap asíncrono, a diferencia de `AuthProvider`: la sesión de
 * plataforma ES el claim `app_metadata.platform_role` del JWT, así que se lee
 * del token guardado sin pedirle nada al backend. `GET /auth/me` no sirve para
 * esto — pasa por `tenantContext` y exige un `tenant_id` que el Super Admin no
 * tiene—, y por eso antes cualquier intento de rehidratar la consola terminaba
 * en un 401 que borraba el token.
 *
 * Las dos sesiones pueden convivir en el mismo browser sin interferirse: viven
 * en claves distintas de `localStorage` y cada una tiene su handler de 401.
 */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<PlatformSession | null>(() => getPlatformSession());

  // Con el access token vigente no hay nada que esperar; solo se arranca en
  // `loading` cuando venció y queda un refresh token con el que recuperarla.
  const [status, setStatus] = useState<PlatformAuthStatus>(() => {
    if (getPlatformSession()) return "authenticated";
    return getRefreshToken("platform") ? "loading" : "anonymous";
  });

  // Bootstrap: el access token vencido NO significa sesión terminada. Volver a
  // la consola al otro día tiene que renovar en silencio, igual que el shell del
  // tenant (que lo consigue de rebote, porque su rehidratación pasa por
  // `/auth/me` y el 401 dispara la renovación). Acá no hay ningún endpoint que
  // consultar —la sesión de plataforma ES el claim del JWT—, así que se renueva
  // explícitamente.
  useEffect(() => {
    let activo = true;

    if (getPlatformSession()) {
      setStatus("authenticated");
      return;
    }
    if (!getRefreshToken("platform")) {
      setStatus("anonymous");
      return;
    }

    platformRefresh()
      .then(({ token, refreshToken }) => {
        if (!activo) return;
        guardarSesion(token, refreshToken, "platform");
        setSessionState(platformSessionFromToken(token));
        setStatus("authenticated");
      })
      .catch(() => {
        if (!activo) return;
        clearToken("platform");
        setSessionState(null);
        setStatus("anonymous");
      });

    return () => {
      activo = false;
    };
  }, []);

  // El cliente HTTP avisa cuando un request a /admin/* recibe un 401 que no pudo
  // renovar (ya borró el token de plataforma). Solo se entera esta sesión: un
  // 401 de la API del tenant dispara el otro handler y no toca nada de acá.
  useEffect(() => {
    setPlatformUnauthorizedHandler(() => {
      setSessionState(null);
      setStatus("anonymous");
    });
    return () => setPlatformUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (input: PlatformLoginInput) => {
    const { token, refreshToken } = await platformLogin(input);

    // Se guarda el PAR. El refresh token es lo que le faltaba a la consola: sin
    // él la sesión moría a la hora exacta y había que volver a generar un token
    // por fuera de la aplicación para seguir trabajando.
    guardarSesion(token, refreshToken, "platform");
    setSessionState(platformSessionFromToken(token));
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await platformLogoutRequest();
    } catch {
      // Best-effort: aunque falle la invalidación remota, limpiamos localmente.
    } finally {
      clearToken("platform");
      setSessionState(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<PlatformAuthContextValue>(
    () => ({ status, session, login, logout }),
    [status, session, login, logout],
  );

  return (
    <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error("usePlatformAuth debe usarse dentro de <PlatformAuthProvider>");
  return ctx;
}
