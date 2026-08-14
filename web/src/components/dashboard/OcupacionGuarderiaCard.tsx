import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../ui/chart.tsx";
import { addDias } from "../turnos/fechas.ts";
import { obtenerCupo } from "../../api/estadias.ts";
import { etiquetaDiaCorto, resumenOcupacionTexto } from "../../lib/dashboard.ts";
import { ApiError, type CupoDia } from "../../types/index.ts";

/** Ventana del gráfico: hoy + los 6 días siguientes. */
const DIAS = 7;

const CHART_CONFIG = {
  ocupados:   { label: "Ocupados",   color: "var(--chart-1)" },
  disponible: { label: "Disponible", color: "var(--chart-2)" },
} satisfies ChartConfig;

interface OcupacionGuarderiaCardProps {
  /** Primer día de la ventana (YYYY-MM-DD): la fecha del resumen. */
  fecha: string;
}

/**
 * Ocupación de guardería de la semana.
 *
 * `GET /estadias/cupo?dateFrom&dateTo` ya devuelve ocupados/cupo/disponible por
 * día en UNA consulta: el gráfico es un render directo de esa respuesta, sin un
 * request por día (eso sería el waterfall que prohíbe el CLAUDE.md).
 */
export function OcupacionGuarderiaCard({ fecha }: OcupacionGuarderiaCardProps) {
  const [dias,    setDias]    = useState<CupoDia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    setLoading(true);
    setError(null);

    obtenerCupo({ dateFrom: fecha, dateTo: addDias(fecha, DIAS - 1) })
      .then((items) => { if (activo) setDias(items); })
      .catch((err: unknown) => {
        if (!activo) return;
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la ocupación");
      })
      .finally(() => { if (activo) setLoading(false); });

    return () => { activo = false; };
  }, [fecha]);

  const datos = dias.map((d) => ({ ...d, dia: etiquetaDiaCorto(d.date) }));
  const sinOcupacion = datos.length > 0 && datos.every((d) => d.ocupados === 0);

  return (
    <Card className="border-orange-200">
      <CardHeader className="bg-gradient-to-r from-orange-50 to-transparent">
        <CardTitle className="flex items-center gap-2 text-base text-orange-800 md:text-lg">
          <Home className="size-5" aria-hidden />
          Ocupación de guardería
        </CardTitle>
        <CardDescription>Próximos {DIAS} días, sobre el cupo diario configurado</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {loading ? (
          <Skeleton className="h-40 w-full" aria-busy="true" aria-label="Cargando ocupación" />
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : datos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay datos de ocupación para esta semana.
          </p>
        ) : (
          <figure className="space-y-1">
            {sinOcupacion ? (
              <figcaption className="text-xs text-muted-foreground">
                Sin estadías reservadas en los próximos {DIAS} días.
              </figcaption>
            ) : null}
            <ChartContainer
              config={CHART_CONFIG}
              className="aspect-[2/1] w-full"
              role="img"
              aria-label={`Ocupación de guardería por día. ${resumenOcupacionTexto(datos)}`}
            >
              <BarChart data={datos} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="dia" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {/* Apiladas: ocupados + disponible = cupo del día, así se lee de
                    un vistazo cuánto margen queda. */}
                <Bar dataKey="ocupados"   stackId="cupo" fill="var(--color-ocupados)" radius={[0, 0, 4, 4]} />
                <Bar dataKey="disponible" stackId="cupo" fill="var(--color-disponible)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <p className="sr-only">{resumenOcupacionTexto(datos)}</p>
          </figure>
        )}

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/guarderia">Ver la guardería</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
