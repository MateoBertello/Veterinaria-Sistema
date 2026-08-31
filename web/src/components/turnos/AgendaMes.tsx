import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Badge } from "../ui/badge.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { ESTADO_BADGE_CLASS } from "./estado.ts";
import {
  addMeses,
  construirGrillaMes,
  diaDelMes,
  formatFechaLarga,
  formatMesLargo,
  hoyISO,
} from "./fechas.ts";
import { listarTurnosActivosDelMes } from "../../api/turnos.ts";
import { ApiError, type Turno } from "../../types/index.ts";

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Props {
  /** Fecha de referencia inicial (define el mes visible al abrir). */
  fechaInicial: string;
  /** Al elegir un día se navega a la agenda de ese día (reusa la vista día). */
  onSelectDay: (iso: string) => void;
}

function etiquetaCantidad(cantidad: number): string {
  return cantidad === 0 ? "sin turnos" : `${cantidad} turno${cantidad === 1 ? "" : "s"}`;
}

export function AgendaMes({ fechaInicial, onSelectDay }: Props) {
  const [anchor, setAnchor] = useState(fechaInicial);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setLoading(true);
    setError(null);
    // Una sola consulta trae todos los turnos activos; se agrupan por día (sin N+1).
    listarTurnosActivosDelMes()
      .then((t) => { if (vigente) setTurnos(t); })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : "No se pudo cargar el calendario");
      })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
  }, [intento]);

  // Agrupa por día conservando los turnos completos (no solo el conteo): el
  // popover de vista previa se arma con datos ya traídos, sin pedir nada al abrir.
  const turnosPorDia = useMemo(() => {
    const map = new Map<string, Turno[]>();
    for (const t of turnos) {
      const arr = map.get(t.date);
      if (arr) arr.push(t); else map.set(t.date, [t]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [turnos]);

  const semanas = useMemo(() => construirGrillaMes(anchor), [anchor]);
  const hoy = hoyISO();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => setAnchor(addMeses(anchor, -1))}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="min-w-48 text-center text-sm font-medium capitalize">
          {formatMesLargo(anchor)}
        </span>
        <Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => setAnchor(addMeses(anchor, 1))}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" className="ml-2" onClick={() => setAnchor(hoy)}>
          Este mes
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : loading ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[560px] grid-cols-7 gap-px rounded-lg border bg-border">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="bg-orange-50 py-2 text-center text-xs font-medium text-orange-800">
                {d}
              </div>
            ))}
            {semanas.flat().map((celda) => {
              const items = turnosPorDia.get(celda.iso) ?? [];
              const cantidad = items.length;
              const esHoy = celda.iso === hoy;
              const etiqueta = etiquetaCantidad(cantidad);
              return (
                <div
                  key={celda.iso}
                  className={[
                    "relative flex min-h-20 flex-col bg-white",
                    celda.enMes ? "" : "bg-gray-50 text-muted-foreground",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(celda.iso)}
                    aria-label={`Ver el detalle del ${formatFechaLarga(celda.iso)}: ${etiqueta}`}
                    className="flex w-full flex-1 cursor-pointer flex-col items-start gap-1 p-2 text-left transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-700"
                  >
                    <span
                      className={[
                        "flex size-6 items-center justify-center rounded-full text-sm",
                        esHoy ? "bg-orange-700 font-semibold text-white" : "",
                      ].join(" ")}
                    >
                      {diaDelMes(celda.iso)}
                    </span>
                    {cantidad > 0 ? (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                        {cantidad} turno{cantidad === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </button>
                  {cantidad > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Vista previa del ${formatFechaLarga(celda.iso)}: ${etiqueta}`}
                          className="absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-full text-orange-700 hover:bg-orange-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-700"
                        >
                          <ChevronDown className="size-3.5" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-3">
                        <div className="space-y-2">
                          <p className="text-sm font-medium capitalize">{formatFechaLarga(celda.iso)}</p>
                          {items.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin turnos este día.</p>
                          ) : (
                            <ul className="max-h-64 space-y-2 overflow-y-auto">
                              {items.map((t) => (
                                <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                                  <div className="flex flex-col">
                                    <span className="font-medium">{t.mascota?.name ?? "—"}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {t.cliente?.fullName ?? "—"} · {t.startTime}
                                    </span>
                                  </div>
                                  <Badge className={ESTADO_BADGE_CLASS[t.status]}>{t.status}</Badge>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
