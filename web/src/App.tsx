import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { LogoMarca } from "./components/shell/LogoMarca.tsx";
import { Menu } from "lucide-react";
import { buildNavItems, type NavItem } from "./lib/navigation.ts";
import { useAuth } from "./auth/AuthContext.tsx";
import { ModulosProvider, useModulos } from "./auth/ModulosContext.tsx";
import { ProtectedRoute } from "./auth/ProtectedRoute.tsx";
import { RequireModule } from "./auth/RequireModule.tsx";
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
import { CatalogosPage } from "./pages/CatalogosPage.tsx";
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
import { CargaPreciosPage } from "./pages/CargaPreciosPage.tsx";
import { ProductosPage } from "./pages/ProductosPage.tsx";
import { FamiliasPage } from "./pages/FamiliasPage.tsx";
import { ProveedoresPage } from "./pages/ProveedoresPage.tsx";
import { ExistenciasPage } from "./pages/ExistenciasPage.tsx";
import { LoteDetallePage } from "./pages/LoteDetallePage.tsx";
import { VencimientosPage } from "./pages/VencimientosPage.tsx";
import { ComprasPage } from "./pages/ComprasPage.tsx";
import { CompraDetallePage } from "./pages/CompraDetallePage.tsx";
import { CajaPage } from "./pages/CajaPage.tsx";
import { ArqueoCajaPage } from "./pages/ArqueoCajaPage.tsx";
import { MostradorPage } from "./pages/MostradorPage.tsx";
import VentasHistorialPage from "./pages/VentasHistorialPage.tsx";
import VentaDetallePage from "./pages/VentaDetallePage.tsx";
import { AjustesPage } from "./pages/AjustesPage.tsx";
import { RecuentosPage } from "./pages/RecuentosPage.tsx";
import { RecuentoDetallePage } from "./pages/RecuentoDetallePage.tsx";
import { FraccionamientoPage } from "./pages/FraccionamientoPage.tsx";
import { ReportesStockPage } from "./pages/ReportesStockPage.tsx";
import { ReportesVentasPage } from "./pages/ReportesVentasPage.tsx";
import { StockPage } from "./pages/StockPage.tsx";
import { LotesPage } from "./pages/LotesPage.tsx";
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
    <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
      {/* Misma convención que la identidad del sidebar: el logo vuelve al inicio. */}
      <Link
        to="/"
        aria-label="Ir al inicio"
        className="flex items-center gap-2 rounded-lg transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogoMarca className="size-8 rounded-lg" />
        <span className="text-base font-semibold text-sidebar-accent-foreground">Leo</span>
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Abrir menú"
            className="h-11 w-11 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu className="size-6" aria-hidden />
          </Button>
        </SheetTrigger>
        {/* bg-sidebar/text-sidebar-foreground explícitos: SheetContent por defecto
            trae bg-background (claro) del kit, y SidebarNav no fija su propio
            fondo (lo hereda del <aside> en desktop). Sin esto, el contenido
            oscuro del sidebar (§3.1 GUIA_ESTILO) queda sobre un panel claro. */}
        <SheetContent
          side="left"
          className="w-3/4 gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-xs"
        >
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
  const { modulos } = useModulos();
  const permissions = user?.permissions ?? [];
  const items = useMemo(() => buildNavItems(modulos, permissions), [modulos, permissions]);

  const onLogout = () => void logout();

  return (
    <>
      {/* Sticky con alto de viewport: el sidebar no se va con el scroll del
          listado (el `<nav>` de SidebarNav tiene su propio overflow). */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start border-r bg-sidebar md:flex">
        <SidebarNav items={items} user={user} onLogout={onLogout} />
      </aside>
      <MobileNav items={items} user={user} onLogout={onLogout} />
    </>
  );
}

/** Layout autenticado: navegación + área de contenido. Se renderiza solo con sesión válida. */
export function Shell() {
  return (
    <ModulosProvider>
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
    </ModulosProvider>
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
        {/* ─── Módulos Vendibles Clínicos (RN-G2) ─── */}
        <Route element={<RequireModule modulo="historial_clinico" />}>
          <Route path="/historial" element={<HistorialClinicoIndexPage />} />
          <Route path="/historial/:mascotaId" element={<HistorialClinicoPage />} />
        </Route>

        <Route
          path="/servicios"
          element={
            <RequirePermission permission="manage_services">
              <ServiciosPage />
            </RequirePermission>
          }
        />
        <Route
          path="/doctores"
          element={
            <RequirePermission permission="manage_users">
              <DoctoresPage />
            </RequirePermission>
          }
        />
        <Route
          path="/horarios"
          element={
            <RequirePermission permission="manage_schedules">
              <HorariosPage />
            </RequirePermission>
          }
        />

        <Route element={<RequireModule modulo="turnos" />}>
          <Route path="/turnos" element={<TurnosPage />} />
          <Route path="/turnos/nuevo" element={<AgendarTurnoPage />} />
          <Route path="/turnos/:id/editar" element={<AgendarTurnoPage />} />
        </Route>

        <Route element={<RequireModule modulo="guarderia" />}>
          <Route path="/guarderia" element={<OcupacionGuarderiaPage />} />
          <Route path="/guarderia/nuevo" element={<RegistrarEstadiaPage />} />
          <Route path="/guarderia/:id/editar" element={<RegistrarEstadiaPage />} />
        </Route>

        <Route
          path="/catalogos"
          element={
            <RequirePermission permission="manage_catalogs">
              <CatalogosPage />
            </RequirePermission>
          }
        />
        <Route
          path="/configuracion"
          element={
            <RequirePermission permission="manage_tenant_settings">
              <ConfiguracionPage />
            </RequirePermission>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RequirePermission permission="manage_users">
              <UsuariosPage />
            </RequirePermission>
          }
        />
        <Route
          path="/auditoria"
          element={
            <RequirePermission permission="view_audit">
              <AuditoriaPage />
            </RequirePermission>
          }
        />

        {/* ─── Rutas Comerciales: Stock (RN-G2) ─── */}
        <Route element={<RequireModule modulo="stock" />}>
          <Route
            path="/stock"
            element={
              <RequirePermission permission="view_stock">
                <StockPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/lotes"
            element={
              <RequirePermission permission="view_stock">
                <LotesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/existencias"
            element={
              <RequirePermission permission="view_stock">
                <ExistenciasPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/lotes/:id"
            element={
              <RequirePermission permission="view_stock">
                <LoteDetallePage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/vencimientos"
            element={
              <RequirePermission permission="view_stock">
                <VencimientosPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/productos"
            element={
              <RequirePermission permission="manage_products">
                <ProductosPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/productos/precios"
            element={
              <RequirePermission permission="manage_products">
                <CargaPreciosPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/familias"
            element={
              <RequirePermission permission="manage_products">
                <FamiliasPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/proveedores"
            element={
              <RequirePermission permission="manage_suppliers">
                <ProveedoresPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/compras"
            element={
              <RequirePermission permission="manage_suppliers">
                <ComprasPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/compras/:id"
            element={
              <RequirePermission permission="manage_suppliers">
                <CompraDetallePage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/ajustes"
            element={
              <RequirePermission permission="manage_stock">
                <AjustesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/recuentos"
            element={
              <RequirePermission permission="manage_stock">
                <RecuentosPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/recuentos/:id"
            element={
              <RequirePermission permission="manage_stock">
                <RecuentoDetallePage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/fraccionamiento"
            element={
              <RequirePermission permission="split_stock">
                <FraccionamientoPage />
              </RequirePermission>
            }
          />
          <Route
            path="/stock/reportes"
            element={
              <RequirePermission permission="view_stock">
                <ReportesStockPage />
              </RequirePermission>
            }
          />
        </Route>

        {/* ─── Rutas Comerciales: Ventas (RN-G2) ─── */}
        <Route element={<RequireModule modulo="ventas" />}>
          <Route
            path="/ventas"
            element={
              <RequirePermission permission="manage_sales">
                <MostradorPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/mostrador"
            element={
              <RequirePermission permission="manage_sales">
                <MostradorPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/historial"
            element={
              <RequirePermission permission="manage_sales">
                <VentasHistorialPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/:id"
            element={
              <RequirePermission permission="manage_sales">
                <VentaDetallePage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/caja"
            element={
              <RequirePermission permission="manage_cash">
                <CajaPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/caja/:sesionId"
            element={
              <RequirePermission permission="manage_cash">
                <ArqueoCajaPage />
              </RequirePermission>
            }
          />
          <Route
            path="/ventas/reportes"
            element={
              <RequirePermission permission="view_sales">
                <ReportesVentasPage />
              </RequirePermission>
            }
          />
        </Route>

        <Route path="/preferencias" element={<PreferenciasPage />} />
        {/* Ruta desconocida dentro de la sesión → panel de inicio. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
