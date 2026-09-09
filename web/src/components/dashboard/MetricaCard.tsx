import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../ui/card.tsx";
import { cn } from "../ui/utils.ts";
import type { MetricaVisible } from "../../lib/dashboard.ts";

/**
 * Acentos disponibles para una tarjeta de métrica. Es una clave semántica, no
 * un color: el valor vive en los tokens `--metric-*` de theme.css y se resuelve
 * acá abajo. Quien agrega una métrica elige un acento de esta lista; no escribe
 * un color.
 */
export type MetricaAccent = "marca" | "ambar" | "info" | "exito" | "especial";

/**
 * Clases por acento. Tres piezas: la línea del borde izquierdo, la superficie
 * del chip y la tinta del icono. Las combinaciones están medidas en
 * docs/GUIA_ESTILO.md §1 (tinta sobre superficie >= 6.3:1; línea sobre card
 * blanca >= 5:1, holgada sobre el 3:1 que pide WCAG 1.4.11 para no-texto).
 */
const ACCENT_CLASS: Record<MetricaAccent, { linea: string; chip: string }> = {
  marca:    { linea: "border-l-metric-brand",   chip: "bg-metric-brand-surface text-metric-brand-ink" },
  ambar:    { linea: "border-l-metric-amber",   chip: "bg-metric-amber-surface text-metric-amber-ink" },
  info:     { linea: "border-l-metric-info",    chip: "bg-metric-info-surface text-metric-info-ink" },
  exito:    { linea: "border-l-metric-success", chip: "bg-metric-success-surface text-metric-success-ink" },
  especial: { linea: "border-l-metric-special", chip: "bg-metric-special-surface text-metric-special-ink" },
};

interface MetricaCardProps {
  metrica: MetricaVisible;
  icon:    LucideIcon;
  /** Acento de la tarjeta (clave semántica; el color sale de los tokens). */
  accent:  MetricaAccent;
}

/**
 * Tarjeta de métrica del panel de inicio.
 *
 * Es un enlace real (`<Link>`, no un div con onClick) para que llegue por
 * teclado y el navegador la anuncie como navegación. El `aria-label` dice el
 * número y a dónde lleva, porque el valor grande y la etiqueta están en nodos
 * separados.
 *
 * El acento de color (línea izquierda + chip del icono) es decoración: no porta
 * significado que no esté ya escrito en la etiqueta y el número, así que no hay
 * información que se pierda si el usuario no distingue los tonos.
 */
export function MetricaCard({ metrica, icon: Icon, accent }: MetricaCardProps) {
  const { linea, chip } = ACCENT_CLASS[accent];

  return (
    <Card
      className={cn(
        "border-l-4 shadow-card transition-shadow hover:shadow-card-hover focus-within:ring-2 focus-within:ring-ring",
        linea,
      )}
    >
      <CardContent className="p-4 md:p-5">
        <Link
          to={metrica.href}
          className="flex items-start justify-between gap-3 outline-none"
          aria-label={`${metrica.label}: ${metrica.valor}. ${metrica.hint}. Ir a ${metrica.label}`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-muted-foreground md:text-sm">
              {metrica.label}
            </p>
            <p className="mt-1 text-3xl leading-none font-bold tracking-tight text-foreground md:text-4xl">
              {metrica.valor}
            </p>
            <p className="mt-2 hidden text-xs text-muted-foreground md:block">{metrica.hint}</p>
          </div>
          <span className={cn("rounded-lg p-1.5 md:p-2", chip)}>
            <Icon className="size-4 md:size-5" aria-hidden />
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}
