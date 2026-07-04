import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { LogOut, PawPrint } from "lucide-react";
import { buildNavItems, type NavItem } from "./lib/navigation.ts";
import { fetchModulosHabilitados } from "./api/modulos.ts";
import { useAuth } from "./auth/AuthContext.tsx";
import { ProtectedRoute } from "./auth/ProtectedRoute.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ClientesPage } from "./pages/ClientesPage.tsx";
import { MascotasPage } from "./pages/MascotasPage.tsx";
import { HistorialClinicoIndexPage } from "./pages/HistorialClinicoIndexPage.tsx";
import { HistorialClinicoPage } from "./pages/HistorialClinicoPage.tsx";
import { ServiciosPage } from "./pages/ServiciosPage.tsx";
import { ConfiguracionPage } from "./pages/ConfiguracionPage.tsx";
import { DoctoresPage } from "./pages/DoctoresPage.tsx";
import { HorariosPage } from "./pages/HorariosPage.tsx";
import { TurnosPage } from "./pages/TurnosPage.tsx";
import { AgendarTurnoPage } from "./pages/AgendarTurnoPage.tsx";
import { Button } from "./components/ui/button.tsx";
import { cn } from "./components/ui/utils.ts";

/** Sidebar del shell: ítems base + módulos vendibles habilitados (RN-G2) + identidad/logout. */
function Sidebar() {
  const { user, logout } = useAuth();
  const permissions = user?.permissions ?? [];
  const [items, setItems] = useState<NavItem[]>(buildNavItems([], permissions));

  useEffect(() => {
    let activo = true;
    fetchModulosHabilitados()
      .then((modulos) => {
        if (activo) setItems(buildNavItems(modulos, permissions));
      })
      .catch(() => {
        // Sin módulos/backend: se muestran solo los ítems base.
        if (activo) setItems(buildNavItems([], permissions));
      });
    return () => {
      activo = false;
    };
  }, [permissions]);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex items-center gap-2 px-6 py-5">
        <PawPrint className="size-6 text-primary" aria-hidden />
        <span className="text-lg font-semibold text-orange-800">Leo</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Navegación principal">
        {items.map((item) => (
          <NavLink
            key={item.key}
            to={item.href}
            end={item.href === "/"}
            className={({ isActive }) =>
              cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {user ? (
        <div className="mt-auto border-t px-3 py-4">
          <div className="px-3 pb-3">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.roleName}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground"
            onClick={() => void logout()}
          >
            <LogOut aria-hidden />
            Cerrar sesión
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

/** Layout autenticado: sidebar + área de contenido. Se renderiza solo con sesión válida. */
function Shell() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-x-auto px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/clientes" replace />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/mascotas" element={<MascotasPage />} />
        <Route path="/historial" element={<HistorialClinicoIndexPage />} />
        <Route path="/historial/:mascotaId" element={<HistorialClinicoPage />} />
        <Route path="/servicios" element={<ServiciosPage />} />
        <Route path="/doctores" element={<DoctoresPage />} />
        <Route path="/horarios" element={<HorariosPage />} />
        <Route path="/turnos" element={<TurnosPage />} />
        <Route path="/turnos/nuevo" element={<AgendarTurnoPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
        <Route path="*" element={<Navigate to="/clientes" replace />} />
      </Route>
    </Routes>
  );
}
