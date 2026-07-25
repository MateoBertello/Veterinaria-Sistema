import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../ui/card.tsx";
import type { MetricaVisible } from "../../lib/dashboard.ts";

interface MetricaCardProps {
  metrica: MetricaVisible;
  icon:    LucideIcon;
  /** Gradiente del ícono (paleta de la guía de estilo). */
  accent:  string;
}

/**
 * Tarjeta de métrica del panel de inicio.
 *
 * Es un enlace real (`<Link>`, no un div con onClick) para que llegue por
 * teclado y el navegador la anuncie como navegación. El `aria-label` dice el
 * número y a dónde lleva, porque el valor grande y la etiqueta están en nodos
 * separados.
 */
export function MetricaCard({ metrica, icon: Icon, accent }: MetricaCardProps) {
  return (
    <Card className="border-orange-200 transition-shadow hover:shadow-lg focus-within:ring-2 focus-within:ring-ring">
      <CardContent className="p-4 md:p-6">
        <Link
          to={metrica.href}
          className="flex items-start justify-between gap-3 outline-none"
          aria-label={`${metrica.label}: ${metrica.valor}. ${metrica.hint}. Ir a ${metrica.label}`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground md:text-sm">{metrica.label}</p>
            <p className="text-2xl font-semibold text-orange-800 md:text-3xl">{metrica.valor}</p>
            <p className="mt-1 hidden text-xs text-muted-foreground md:block">{metrica.hint}</p>
          </div>
          <span className={`rounded-xl bg-gradient-to-br p-2 shadow-md md:p-3 ${accent}`}>
            <Icon className="size-5 text-white md:size-6" aria-hidden />
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}
