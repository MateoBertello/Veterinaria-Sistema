import { Link } from "react-router-dom";
import {
  BarChart3,
  Barcode,
  Boxes,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Layers,
  Package,
  Scissors,
  ShoppingBag,
  SlidersHorizontal,
  Tag,
  Truck,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";

interface StockSeccion {
  id: string;
  titulo: string;
  descripcion: string;
  href: string;
  permission: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface StockGrupo {
  id: string;
  titulo: string;
  secciones: StockSeccion[];
}

const STOCK_GRUPOS: StockGrupo[] = [
  {
    id: "catalogo",
    titulo: "Catálogo",
    secciones: [
      {
        id: "productos",
        titulo: "Productos",
        descripcion: "Catálogo general de productos y control de existencias.",
        href: "/stock/productos",
        permission: "manage_products",
        icon: Package,
      },
      {
        id: "familias",
        titulo: "Familias",
        descripcion: "Agrupación de productos y unidades de medida base.",
        href: "/stock/familias",
        permission: "manage_products",
        icon: Layers,
      },
      {
        id: "proveedores",
        titulo: "Proveedores",
        descripcion: "Gestión de proveedores y condiciones comerciales.",
        href: "/stock/proveedores",
        permission: "manage_suppliers",
        icon: Truck,
      },
      {
        id: "precios",
        titulo: "Precios",
        descripcion: "Carga asistida y actualización de precios de venta.",
        href: "/stock/productos/precios",
        permission: "manage_products",
        icon: Tag,
      },
    ],
  },
  {
    id: "existencias",
    titulo: "Existencias",
    secciones: [
      {
        id: "existencias",
        titulo: "Existencias",
        descripcion: "Resumen de existencias por producto y valorización.",
        href: "/stock/existencias",
        permission: "view_stock",
        icon: Boxes,
      },
      {
        id: "vencimientos",
        titulo: "Vencimientos",
        descripcion: "Monitoreo de lotes próximos a vencer y vencidos.",
        href: "/stock/vencimientos",
        permission: "view_stock",
        icon: CalendarClock,
      },
      {
        id: "lotes",
        titulo: "Lotes",
        descripcion: "Control individual de lotes, estados y trazabilidad.",
        href: "/stock/lotes",
        permission: "view_stock",
        icon: Barcode,
      },
    ],
  },
  {
    id: "operaciones",
    titulo: "Operaciones",
    secciones: [
      {
        id: "compras",
        titulo: "Compras",
        descripcion: "Órdenes de compra, recepción de mercadería y remitos.",
        href: "/stock/compras",
        permission: "manage_suppliers",
        icon: ShoppingBag,
      },
      {
        id: "ajustes",
        titulo: "Ajustes",
        descripcion: "Ajustes manuales de existencias y bloqueos de lote.",
        href: "/stock/ajustes",
        permission: "manage_stock",
        icon: SlidersHorizontal,
      },
      {
        id: "recuentos",
        titulo: "Recuentos",
        descripcion: "Recuentos periódicos de inventario y conciliación.",
        href: "/stock/recuentos",
        permission: "manage_stock",
        icon: ClipboardList,
      },
      {
        id: "fraccionamiento",
        titulo: "Fraccionamiento",
        descripcion: "División de envases multidosis en unidades menores.",
        href: "/stock/fraccionamiento",
        permission: "split_stock",
        icon: Scissors,
      },
    ],
  },
  {
    id: "analisis",
    titulo: "Análisis",
    secciones: [
      {
        id: "reportes",
        titulo: "Reportes",
        descripcion: "Valorización, rotación de stock y consumo clínico.",
        href: "/stock/reportes",
        permission: "view_stock",
        icon: BarChart3,
      },
    ],
  },
];

export function StockPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  // Filtrar secciones según permisos del usuario.
  // Regla dura: Si un grupo se queda sin secciones permitidas, no se renderiza.
  const gruposVisibles = STOCK_GRUPOS.map((grupo) => ({
    ...grupo,
    secciones: grupo.secciones.filter((sec) => permissions.includes(sec.permission)),
  })).filter((grupo) => grupo.secciones.length > 0);

  return (
    <div className="container mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      {/* Header del Hub */}
      <header className="space-y-1 border-b pb-4">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-orange-950">
          <Boxes className="size-7 text-orange-600" aria-hidden />
          Stock
        </h1>
        <p className="text-sm text-muted-foreground">
          Gestión integral de catálogo, existencias de lotes, compras a proveedores y operaciones de inventario.
        </p>
      </header>

      {/* Contenido: Grupos de secciones */}
      {gruposVisibles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-base font-medium text-foreground">
            No tenés permisos para acceder a las secciones de Stock.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Comunicate con un administrador si necesitás gestionar el inventario.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {gruposVisibles.map((grupo) => (
            <section key={grupo.id} className="space-y-3" aria-labelledby={`grupo-${grupo.id}`}>
              <h2
                id={`grupo-${grupo.id}`}
                className="text-lg font-semibold tracking-tight text-orange-900"
              >
                {grupo.titulo}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {grupo.secciones.map((sec) => {
                  const Icon = sec.icon;
                  return (
                    <Card
                      key={sec.id}
                      className="group relative transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
                    >
                      <Link
                        to={sec.href}
                        className="flex h-full flex-col justify-between p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-lg"
                      >
                        <CardContent className="p-0 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-100 text-orange-700 transition-colors group-hover:bg-orange-600 group-hover:text-white">
                              <Icon className="size-5" aria-hidden />
                            </div>
                            <ChevronRight
                              className="size-5 text-muted-foreground/50 transition-transform group-hover:translate-x-1 group-hover:text-orange-600"
                              aria-hidden
                            />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground group-hover:text-orange-800">
                              {sec.titulo}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                              {sec.descripcion}
                            </p>
                          </div>
                        </CardContent>
                      </Link>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default StockPage;
