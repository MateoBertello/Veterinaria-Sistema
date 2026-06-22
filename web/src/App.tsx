import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { PawPrint } from "lucide-react";
import { buildNavItems, type NavItem } from "./lib/navigation.ts";
import { fetchModulosHabilitados } from "./api/modulos.ts";
import { ClientesPage } from "./pages/ClientesPage.tsx";
import { cn } from "./components/ui/utils.ts";

/** Sidebar mínimo del shell: ítems base + módulos vendibles habilitados (RN-G2). */
function Sidebar() {
  const [items, setItems] = useState<NavItem[]>(buildNavItems([]));

  useEffect(() => {
    let activo = true;
    fetchModulosHabilitados()
      .then((modulos) => {
        if (activo) setItems(buildNavItems(modulos));
      })
      .catch(() => {
        // Sin sesión/backend: se muestran solo los ítems base.
        if (activo) setItems(buildNavItems([]));
      });
    return () => {
      activo = false;
    };
  }, []);

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:flex md:flex-col">
      <div className="flex items-center gap-2 px-6 py-5">
        <PawPrint className="size-6 text-primary" aria-hidden />
        <span className="text-lg font-semibold text-orange-800">Leo</span>
      </div>
      <nav className="flex flex-col gap-1 px-3" aria-label="Navegación principal">
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
    </aside>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-x-auto px-4 py-6 md:px-8">
        <Routes>
          <Route path="/" element={<Navigate to="/clientes" replace />} />
          <Route path="/clientes" element={<ClientesPage />} />
          <Route path="*" element={<Navigate to="/clientes" replace />} />
        </Routes>
      </main>
    </div>
  );
}
