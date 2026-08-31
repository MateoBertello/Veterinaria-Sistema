import { Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { usePlatformAuth } from "./PlatformAuthContext.tsx";

/**
 * Gate del área de plataforma (`/admin/*`). NO se anida en `ProtectedRoute`: el
 * Super Admin no tiene sesión de tenant (su JWT no lleva `tenant_id`, así que
 * `GET /auth/me` lo rechazaría) y su identidad vive en el claim
 * `app_metadata.platform_role='super_admin'` — exactamente lo que exige el
 * middleware `requireSuperAdmin` del backend.
 *
 * Sin ese claim redirige a `/admin/login` en vez de limitarse a ocultar el
 * acceso: el área no se abre "porque no se ve el link". La autorización real la
 * sigue haciendo el backend en cada request (403 FORBIDDEN).
 *
 * La sesión se lee del contexto y no de `localStorage` para que el gate sea
 * REACTIVO: cuando un 401 irrecuperable de /admin/* cierra la sesión de
 * plataforma, esta pantalla se entera y devuelve al login en vez de quedarse
 * mostrando una consola que ya no responde.
 *
 * El destino es `/admin/login` y no `/login`: son dos sistemas de identidad
 * distintos. Mandar al Super Admin al login de la clínica no le sirve de nada
 * —ahí no puede entrar, no tiene usuario de tenant— y mandarlo con
 * `state.from=/admin/*` hacía rebotar a los usuarios de tenant entre /login y
 * /admin en un bucle de redirecciones.
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { status, session } = usePlatformAuth();

  // Access token vencido pero renovable: se está recuperando la sesión. Redirigir
  // acá mandaría al login a alguien que sigue teniendo sesión válida.
  if (status === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-900"
        role="status"
        aria-live="polite"
      >
        <ShieldCheck className="size-8 animate-pulse text-primary" aria-hidden />
        <span className="sr-only">Cargando sesión…</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
