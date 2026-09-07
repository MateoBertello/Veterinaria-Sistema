import { useLocation, Link, useInRouterContext } from "react-router-dom";
import { BarChart3, Receipt, ShoppingCart, Wallet } from "lucide-react";
import { useAuth } from "../../auth/AuthContext.tsx";
import { cn } from "../ui/utils.ts";
import type { AuthUser } from "../../types/index.ts";

interface VentasNavItem {
  id: string;
  label: string;
  href: string;
  permission: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: (pathname: string) => boolean;
}

const VENTAS_NAV_ITEMS: VentasNavItem[] = [
  {
    id: "mostrador",
    label: "Mostrador de Ventas",
    href: "/ventas",
    permission: "manage_sales",
    icon: ShoppingCart,
    isActive: (pathname) => pathname === "/ventas" || pathname === "/ventas/mostrador",
  },
  {
    id: "historial",
    label: "Historial",
    href: "/ventas/historial",
    permission: "manage_sales",
    icon: Receipt,
    isActive: (pathname) => pathname.startsWith("/ventas/historial") || (pathname.startsWith("/ventas/") && !pathname.startsWith("/ventas/caja") && !pathname.startsWith("/ventas/reportes") && !pathname.startsWith("/ventas/mostrador")),
  },
  {
    id: "caja",
    label: "Caja",
    href: "/ventas/caja",
    permission: "manage_cash",
    icon: Wallet,
    isActive: (pathname) => pathname.startsWith("/ventas/caja"),
  },
  {
    id: "reportes",
    label: "Reportes",
    href: "/ventas/reportes",
    permission: "view_sales",
    icon: BarChart3,
    isActive: (pathname) => pathname.startsWith("/ventas/reportes"),
  },
];

interface VentasNavProps {
  className?: string;
}

function VentasNavContent({
  className,
  user,
}: {
  className?: string;
  user: AuthUser | null;
}) {
  const location = useLocation();
  const permissions = user?.permissions ?? [];

  const itemsPermitidos = VENTAS_NAV_ITEMS.filter((item) =>
    permissions.includes(item.permission),
  );

  if (itemsPermitidos.length <= 1) {
    // Si solo tiene acceso a una sola sección, no es necesario renderizar la barra
    return null;
  }

  return (
    <nav
      aria-label="Navegación de ventas"
      className={cn("flex flex-wrap items-center gap-1.5 border-b border-border pb-3", className)}
    >
      {itemsPermitidos.map((item) => {
        const Icon = item.icon;
        const active = item.isActive(location.pathname);

        return (
          <Link
            key={item.id}
            to={item.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-orange-100 text-orange-900 shadow-sm dark:bg-orange-950 dark:text-orange-100"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-orange-600" : "text-muted-foreground")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function VentasNav({ className }: VentasNavProps) {
  const inRouter = useInRouterContext();
  let user: AuthUser | null = null;
  try {
    const auth = useAuth();
    user = auth.user;
  } catch {
    user = null;
  }

  if (!inRouter) return null;
  return <VentasNavContent className={className} user={user} />;
}

export default VentasNav;
