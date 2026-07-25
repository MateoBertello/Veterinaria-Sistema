import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setUnauthorizedHandler } from "../api/client.ts";
import { fetchMe, login as loginRequest, logoutRequest } from "../api/auth.ts";
import { clearToken, getToken, setToken } from "../lib/session.ts";
import { isSuperAdmin } from "../lib/platform.ts";
import type { AuthUser, LoginInput } from "../types/index.ts";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user:   AuthUser | null;
  /** Autentica y deja la sesión activa. Propaga `ApiError` para que el form lo mapee. */
  login:  (input: LoginInput) => Promise<void>;
  /** Cierra sesión (best-effort en el backend) y vuelve a estado anónimo. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  // Estado anónimo: limpia token y usuario. Reutilizado por logout y por el
  // handler de 401 (token vencido) que registra el cliente HTTP.
  const goAnonymous = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus("anonymous");
  }, []);

  // Bootstrap: si hay token, rehidrata el perfil con /auth/me (y de paso valida
  // que el token siga vigente; si venció → 401 → anónimo). Sin token → anónimo.
  useEffect(() => {
    let activo = true;

    if (!getToken()) {
      setStatus("anonymous");
      return;
    }

    // Token de PLATAFORMA (Super Admin): no tiene tenant_id, así que /auth/me lo
    // rechazaría con 401 y el handler de sesión expirada borraría un token que
    // sí es válido para /admin/*. No hay perfil de tenant que rehidratar: queda
    // anónimo para el shell del tenant, y `RequireSuperAdmin` lee el claim.
    if (isSuperAdmin()) {
      setStatus("anonymous");
      return;
    }

    fetchMe()
      .then((perfil) => {
        if (!activo) return;
        setUser(perfil);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!activo) return;
        goAnonymous();
      });

    return () => {
      activo = false;
    };
  }, [goAnonymous]);

  // El cliente HTTP avisa cuando un request autenticado recibe 401: cerramos la
  // sesión; la redirección a /login la resuelve ProtectedRoute reactivamente.
  useEffect(() => {
    setUnauthorizedHandler(goAnonymous);
    return () => setUnauthorizedHandler(null);
  }, [goAnonymous]);

  const login = useCallback(async (input: LoginInput) => {
    const { token, user: perfil } = await loginRequest(input);
    setToken(token);
    setUser(perfil);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort: aunque falle la invalidación remota, limpiamos localmente.
    } finally {
      goAnonymous();
    }
  }, [goAnonymous]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
