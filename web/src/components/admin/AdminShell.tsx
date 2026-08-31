import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/utils.ts";
import { usePlatformAuth } from "../../auth/PlatformAuthContext.tsx";

/**
 * Shell del área de plataforma. Deliberadamente distinto del shell del tenant
 * (sidebar slate oscuro, mismo acento naranja): quien la usa debe ver de un
 * vistazo que NO está dentro de una clínica sino en el plano de control.
 */
export function AdminShell() {
  const navigate = useNavigate();
  const { session: sesion, logout } = usePlatformAuth();

  // Logout propio de plataforma (`POST /admin/auth/logout`): el del tenant pasa
  // por `tenantContext` y rechazaría este token. Además de limpiar el par local
  // invalida la sesión en GoTrue — importante ahora que la consola guarda un
  // refresh token, que de otro modo seguiría sirviendo para renovar.
  async function cerrarSesion() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#contenido-admin"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>

      {/* Sticky con alto de viewport, igual que el shell del tenant: la lista
          de tenants es larga y la navegación no puede irse con el scroll. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start border-r border-slate-800 bg-slate-900 text-slate-100 md:flex">
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 p-2 shadow-md">
            <ShieldCheck className="size-6 text-white" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold text-white">Plataforma</div>
            <div className="text-xs text-slate-400">Consola Super Admin</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Navegación de plataforma">
          <NavLink
            to="/admin/tenants"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )
            }
          >
            <Building2 className="size-4" aria-hidden />
            Tenants
          </NavLink>
        </nav>

        <div className="mt-auto border-t border-slate-800 px-3 py-4">
          <div className="px-3 pb-3">
            <p className="truncate text-sm font-medium text-white">
              {sesion?.email ?? "Super Admin"}
            </p>
            <p className="truncate text-xs text-slate-400">Super Admin de plataforma</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => void cerrarSesion()}
          >
            <LogOut aria-hidden />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <main id="contenido-admin" className="flex-1 overflow-x-auto px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
