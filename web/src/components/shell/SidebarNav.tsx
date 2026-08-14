import { NavLink } from "react-router-dom";
import { Dog, LogOut } from "lucide-react";
import type { NavItem } from "../../lib/navigation.ts";
import type { AuthUser } from "../../types/index.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/utils.ts";

interface Props {
  items:  NavItem[];
  user:   AuthUser | null;
  onLogout: () => void;
  /** Se invoca al navegar a un ítem (el Sheet de mobile lo usa para cerrarse). */
  onNavigate?: () => void;
}

/**
 * Contenido de navegación del shell (identidad + links + logout). Se reusa tal
 * cual en el `<aside>` de desktop y dentro del Sheet de navegación mobile
 * (Etapa 10E) para no duplicar la lógica de ítems.
 */
export function SidebarNav({ items, user, onLogout, onNavigate }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 p-2 shadow-md">
          <Dog className="size-6 text-white" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold text-orange-800">Veterinaria Leo</div>
          <div className="text-xs text-orange-600">Sistema de Gestión</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Navegación principal">
        {items.map((item) => (
          <NavLink
            key={item.key}
            to={item.href}
            end={item.href === "/"}
            onClick={onNavigate}
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
            onClick={onLogout}
          >
            <LogOut aria-hidden />
            Cerrar sesión
          </Button>
        </div>
      ) : null}
    </div>
  );
}
