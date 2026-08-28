import { NavLink } from "react-router-dom";
import {
  Accessibility,
  BedDouble,
  CalendarClock,
  CalendarDays,
  Dog,
  FileText,
  History,
  Home,
  LogOut,
  PawPrint,
  Settings,
  Stethoscope,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { groupNavItems, type NavItem } from "../../lib/navigation.ts";
import type { AuthUser } from "../../types/index.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/utils.ts";

/**
 * Ícono de cada ítem, por `key`. Vive acá y no en `navigation.ts` para que ese
 * módulo siga siendo lógica pura sin dependencias de React: el ícono es
 * presentación. Se reusa el mismo ícono que el `<h1>` de cada pantalla
 * (GUIA_ESTILO §0) para que el sidebar y el header de la página coincidan.
 * Dos excepciones, porque en una lista vertical dos íconos iguales se leen como
 * el mismo destino: Historial Clínico usa `FileText` —el que ya usa su acceso
 * rápido del panel— en vez del `Stethoscope` que comparte con Doctores, y
 * Usuarios usa `UserCog` en vez del `Users` que comparte con Clientes.
 */
const NAV_ICON: Record<string, LucideIcon> = {
  inicio:            Home,
  clientes:          Users,
  mascotas:          PawPrint,
  historial_clinico: FileText,
  turnos:            CalendarDays,
  guarderia:         BedDouble,
  servicios:         Wrench,
  doctores:          Stethoscope,
  horarios:          CalendarClock,
  configuracion:     Settings,
  usuarios:          UserCog,
  auditoria:         History,
};

/** Clases del link de navegación, compartidas por el sidebar y el menú de cuenta. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary text-primary-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent",
  );
}

interface Props {
  items:  NavItem[];
  user:   AuthUser | null;
  onLogout: () => void;
  /** Se invoca al navegar a un ítem (el Sheet de mobile lo usa para cerrarse). */
  onNavigate?: () => void;
}

/**
 * Contenido de navegación del shell (identidad + secciones + cuenta). Se reusa
 * tal cual en el `<aside>` de desktop y dentro del Sheet de navegación mobile
 * (Etapa 10E) para no duplicar la lógica de ítems.
 *
 * Recibe la lista plana de `buildNavItems` y la agrupa acá con `groupNavItems`:
 * qué se muestra lo decide `buildNavItems` (módulo habilitado + permiso), cómo
 * se agrupa es decisión de presentación.
 */
export function SidebarNav({ items, user, onLogout, onNavigate }: Props) {
  const grupos = groupNavItems(items);

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

      {/* `overflow-y-auto` propio: con el `<aside>` sticky de alto de viewport,
          una lista larga scrollea acá adentro y la identidad y el menú de cuenta
          quedan siempre a la vista. */}
      <nav
        className="flex-1 space-y-4 overflow-y-auto px-3 pb-4"
        aria-label="Navegación principal"
      >
        {grupos.map((grupo) => {
          const headingId = `nav-grupo-${grupo.key}`;
          return (
            <div key={grupo.key}>
              {grupo.label ? (
                <h2
                  id={headingId}
                  className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700/80"
                >
                  {grupo.label}
                </h2>
              ) : null}
              <ul
                className="flex flex-col gap-1"
                aria-labelledby={grupo.label ? headingId : undefined}
              >
                {grupo.items.map((item) => {
                  const Icon = NAV_ICON[item.key] ?? FileText;
                  return (
                    <li key={item.key}>
                      <NavLink
                        to={item.href}
                        end={item.href === "/"}
                        onClick={onNavigate}
                        className={navLinkClass}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {item.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {user ? (
        <div className="mt-auto border-t px-3 py-4">
          <div className="px-3 pb-3">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.roleName}</p>
          </div>

          {/* Menú de cuenta, separado de la navegación de módulos: Preferencias
              (RN-UX3) es una pantalla DEL USUARIO —no lleva permiso, no toca
              datos de la clínica y se guarda por usuario en este navegador—, así
              que arriba, entre Servicios o Auditoría, mentiría sobre su alcance. */}
          <nav className="flex flex-col gap-1" aria-label="Cuenta">
            <NavLink to="/preferencias" onClick={onNavigate} className={navLinkClass}>
              <Accessibility className="size-4 shrink-0" aria-hidden />
              Preferencias
            </NavLink>
          </nav>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-sidebar-foreground"
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
