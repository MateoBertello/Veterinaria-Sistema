import { Navigate, useLocation } from "react-router-dom";
import { PawPrint } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext.tsx";

/**
 * Protege el shell autenticado: mientras rehidrata muestra carga; sin sesión
 * redirige a /login (preservando el destino en `state.from`); con sesión válida
 * renderiza el contenido.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <PawPrint className="size-8 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Cargando sesión…</span>
      </div>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
