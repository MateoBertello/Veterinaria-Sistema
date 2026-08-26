import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Dog, Menu } from "lucide-react";
import { buildNavItems, type NavItem } from "./lib/navigation.ts";
import { fetchModulosHabilitados } from "./api/modulos.ts";
import { useAuth } from "./auth/AuthContext.tsx";
import { ProtectedRoute } from "./auth/ProtectedRoute.tsx";
import { RequirePermission } from "./auth/RequirePermission.tsx";
import { RequireSuperAdmin } from "./auth/RequireSuperAdmin.tsx";
import { AdminShell } from "./components/admin/AdminShell.tsx";
import { SidebarNav } from "./components/shell/SidebarNav.tsx";
import { PlatformLoginPage } from "./pages/admin/PlatformLoginPage.tsx";
import { TenantsPage } from "./pages/admin/TenantsPage.tsx";
import { TenantDetallePage } from "./pages/admin/TenantDetallePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
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
import { OcupacionGuarderiaPage } from "./pages/OcupacionGuarderiaPage.tsx";
import { RegistrarEstadiaPage } from "./pages/RegistrarEstadiaPage.tsx";
import { UsuariosPage } from "./pages/UsuariosPage.tsx";
import { AuditoriaPage } from "./pages/AuditoriaPage.tsx";
import { PreferenciasPage } from "./pages/PreferenciasPage.tsx";
import { AccessibilityButton } from "./components/accesibilidad/AccessibilityButton.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/ui/sheet.tsx";

/**
 * Barra superior + Sheet de navegación para < md. Reusa el mismo SidebarNav
 * (mismos ítems, misma identidad/logout) que el `<aside>` de desktop, así que
 * no hay lógica de menú duplicada (Etapa 10E).
 */
function MobileNav({ items, user, onLogout }: {
  items: NavItem[];
  user: ReturnType<typeof useAuth>["user"];
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Cierra el Sheet ante cualquier cambio de ruta (link, back/forward, etc.),
  // además del cierre explícito al hacer click en un NavLink.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex items-center justify-between border-b bg-sidebar px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 p-1.5 shadow-md">
          <Dog className="size-5 text-white" aria-hidden />
        </div>
        <span className="text-base font-semibold text-orange-800">Leo</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Abrir menú"
            className="h-11 w-11"
          >
            <Menu className="size-6" aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-3/4 gap-0 p-0 sm:max-w-xs">
          <SheetHeader className="sr-only">
            <SheetTitle>Menú de navegación</SheetTitle>
            <SheetDescription>Accedé a las secciones del sistema.</SheetDescription>
          </SheetHeader>
          <SidebarNav items={items} user={user} onLogout={onLogout} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Navegación del shell: ítems base + módulos vendibles habilitados (RN-G2) + identidad/
 * logout, en el `<aside>` de desktop y en la barra+Sheet de mobile. */
function Navigation() {
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

  const onLogout = () => void logout();

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <SidebarNav items={items} user={user} onLogout={onLogout} />
      </aside>
      <MobileNav items={items} user={user} onLogout={onLogout} />
    </>
  );
}

/** Layout autenticado: navegación + área de contenido. Se renderiza solo con sesión válida. */
export function Shell() {
  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Skip-link (WCAG 2.4.1): visible al recibir foco por teclado, salta al contenido. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <Navigation />
      <main id="contenido" className="flex-1 overflow-x-auto px-4 py-6 md:px-8">
        <Outlet />
      </main>
      <AccessibilityButton />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Login de plataforma: FUERA del RequireSuperAdmin (es donde se cae sin
          sesión, así que no puede exigirla) y fuera del ProtectedRoute del
          tenant. React Router prioriza este path estático sobre el `*` de la
          consola, así que no compite con las rutas de abajo. */}
      <Route path="/admin/login" element={<PlatformLoginPage />} />

      {/* Consola de plataforma: shell propio y guard propio (claim super_admin del
          JWT). Fuera del ProtectedRoute del tenant: el Super Admin no tiene
          sesión de tenant, y este panel NO pasa por requireModule. */}
      <Route
        path="/admin"
        element={
          <RequireSuperAdmin>
            <AdminShell />
          </RequireSuperAdmin>
        }
      >
        <Route index element={<Navigate to="/admin/tenants" replace />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="tenants/:id" element={<TenantDetallePage />} />
        <Route path="*" element={<Navigate to="/admin/tenants" replace />} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/mascotas" element={<MascotasPage />} />
        <Route path="/historial" element={<HistorialClinicoIndexPage />} />
        <Route path="/historial/:mascotaId" element={<HistorialClinicoPage />} />
        <Route path="/servicios" element={<ServiciosPage />} />
        <Route path="/doctores" element={<DoctoresPage />} />
        <Route path="/horarios" element={<HorariosPage />} />
        <Route path="/turnos" element={<TurnosPage />} />
        <Route path="/turnos/nuevo" element={<AgendarTurnoPage />} />
        <Route path="/turnos/:id/editar" element={<AgendarTurnoPage />} />
        <Route path="/guarderia" element={<OcupacionGuarderiaPage />} />
        <Route path="/guarderia/nuevo" element={<RegistrarEstadiaPage />} />
        <Route path="/guarderia/:id/editar" element={<RegistrarEstadiaPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
        <Route path="/usuarios" element={<UsuariosPage />} />
        <Route
          path="/auditoria"
          element={
            <RequirePermission permission="view_audit">
              <AuditoriaPage />
            </RequirePermission>
          }
        />
        <Route path="/preferencias" element={<PreferenciasPage />} />
        {/* Ruta desconocida dentro de la sesión → panel de inicio. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
