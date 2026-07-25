import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext.tsx";

/**
 * Gate de permiso para una ruta ya autenticada (se anida dentro de
 * `ProtectedRoute`, que resuelve loading/anonymous). Si el usuario no tiene el
 * permiso requerido, redirige a "/" en vez de ocultar el link nomás en el
 * sidebar — RN-S2 exige que el backend Y el front validen el permiso.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children:   ReactNode;
}) {
  const { user } = useAuth();

  if (!user?.permissions.includes(permission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
