import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../ui/chart.tsx";
import { ESTADO_BADGE_CLASS, ESTADO_ROW_ACCENT } from "../turnos/estado.ts";
import { listarTurnos } from "../../api/turnos.ts";
import { turnosPorEstado } from "../../lib/dashboard.ts";
import { ApiError, type Turno } from "../../types/index.ts";

const MAX_FILAS = 5;

// Un color de la paleta de gráficos del tema por estado del turno (los tokens
// --chart-* viven en components/styles/theme.css y siguen el modo claro/oscuro).
const CHART_CONFIG = {
  cantidad:   { label: "Turnos" },
  Programado: { label: "Programado", color: "var(--chart-3)" },
  Confirmado: { label: "Confirmado", color: "var(--chart-2)" },
  Completado: { label: "Completado", color: "var(--chart-5)" },
  Cancelado:  { label: "Cancelado",  color: "var(--chart-4)" },
} satisfies ChartConfig;

interface TurnosHoyCardProps {
  /** Día a mostrar (YYYY-MM-DD). Lo fija el dashboard con la fecha del resumen. */
  fecha: string;
}

/**
 * Turnos del día: lista corta + distribución por estado.
 *
 * Ambas vistas salen de UNA sola llamada a `GET /turnos?date=` (el gráfico se
 * calcula sobre la misma lista, sin pedir conteos aparte). Se monta solo cuando
 * el resumen probó que el usuario ve la métrica de turnos, así que un 403 acá
 * sería una anomalía y se muestra como error, no como panel vacío.
 */
export function TurnosHoyCard({ fecha }: TurnosHoyCardProps) {
  const [turnos,  setTurnos]  = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    setLoading(true);
    setError(null);

    // Sin `status`: el backend devuelve la agenda vigente del día
    // (Programado + Confirmado), que es lo accionable de la jornada.
    listarTurnos({ date: fecha })
      .then((items) => { if (activo) setTurnos(items); })
      .catch((err: unknown) => {
        if (!activo) return;
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar los turnos de hoy");
      })
      .finally(() => { if (activo) setLoading(false); });

    return () => { activo = false; };
  }, [fecha]);

  const datos = turnosPorEstado(turnos);
  const resumenTexto = datos.map((d) => `${d.estado}: ${d.cantidad}`).join("; ");

  return (
    <Card className="border-orange-200">
      <CardHeader className="bg-gradient-to-r from-orange-50 to-transparent">
        <CardTitle className="flex items-center gap-2 text-base text-orange-800 md:text-lg">
          <Calendar className="size-5" aria-hidden />
          Turnos de hoy
        </CardTitle>
        <CardDescription>Agenda vigente del día</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Cargando turnos de hoy">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : turnos.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            <Calendar className="mx-auto mb-3 size-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm">No hay turnos agendados para hoy.</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {turnos.slice(0, MAX_FILAS).map((turno) => (
                <li
                  key={turno.id}
                  className={`rounded-lg border border-l-4 bg-orange-50/60 p-3 ${ESTADO_ROW_ACCENT[turno.status]}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-orange-800">{turno.startTime}</span>
                    <Badge className={ESTADO_BADGE_CLASS[turno.status]}>{turno.status}</Badge>
                  </div>
                  <p className="text-sm">
                    <strong>{turno.mascota?.name ?? "Mascota"}</strong>
                    {turno.cliente ? ` — ${turno.cliente.fullName}` : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {turno.servicio?.nombre ? `${turno.servicio.nombre} · ` : ""}
                    {turno.reason}
                  </p>
                </li>
              ))}
            </ul>

            {turnos.length > MAX_FILAS ? (
              <p className="text-xs text-muted-foreground">
                Mostrando {MAX_FILAS} de {turnos.length} turnos.
              </p>
            ) : null}

            {/* Gráfico: misma lista, cero requests extra. El SVG no es legible por
                lectores de pantalla, así que el detalle va como texto asociado. */}
            <figure className="space-y-1">
              <figcaption className="text-xs font-medium text-muted-foreground">
                Turnos por estado
              </figcaption>
              <ChartContainer
                config={CHART_CONFIG}
                className="aspect-[3/1] w-full"
                role="img"
                aria-label={`Turnos de hoy por estado. ${resumenTexto}`}
              >
                <BarChart data={datos} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="estado" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="cantidad" radius={4}>
                    {datos.map((d) => (
                      <Cell key={d.estado} fill={`var(--color-${d.estado})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <p className="sr-only">{resumenTexto}</p>
            </figure>
          </>
        )}

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/turnos">Ver todos los turnos</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
