import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { getPlatformSession } from "../lib/platform.ts";

/**
 * Gate del área de plataforma (`/admin/*`). NO se anida en `ProtectedRoute`: el
 * Super Admin no tiene sesión de tenant (su JWT no lleva `tenant_id`, así que
 * `GET /auth/me` lo rechazaría) y su identidad vive en el claim
 * `app_metadata.platform_role='super_admin'` — exactamente lo que exige el
 * middleware `requireSuperAdmin` del backend.
 *
 * Sin ese claim redirige a "/" en vez de limitarse a ocultar el acceso: el área
 * no se abre "porque no se ve el link". La autorización real la sigue haciendo
 * el backend en cada request (403 FORBIDDEN).
 *
 * El destino es "/" —y no /login— a propósito: un usuario de tenant con sesión
 * válida vuelve a su shell, y quien no tenga sesión cae igual en /login por
 * `ProtectedRoute`. Mandarlo a /login con `state.from=/admin/*` hacía rebotar al
 * usuario de tenant entre /login y /admin en un bucle de redirecciones.
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  if (!getPlatformSession()) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
