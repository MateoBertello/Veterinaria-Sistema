import type { ReactNode } from "react";
import { useAuth } from "./AuthContext.tsx";
import { AccesoDenegado } from "../components/shell/AccesoDenegado.tsx";

/**
 * Gate de permiso para una ruta ya autenticada (se anida dentro de
 * `ProtectedRoute`, que resuelve loading/anonymous). RN-S2 exige que el backend
 * Y el front validen el permiso: ocultar el link en el sidebar no alcanza, la
 * ruta se abre igual escribiendo la URL.
 *
 * Sin el permiso, se renderiza la pantalla "Sin acceso" en vez de redirigir a
 * "/". El redirect era indistinguible de un bug —la URL cambiaba sola y nadie
 * explicaba por qué— y además rompía el back del navegador. La autorización real
 * la sigue haciendo el backend; esto es solo la explicación.
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
    return <AccesoDenegado />;
  }

  return <>{children}</>;
}
