import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
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

  const conteoPorDia = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of turnos) map.set(t.date, (map.get(t.date) ?? 0) + 1);
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
              const cantidad = conteoPorDia.get(celda.iso) ?? 0;
              const esHoy = celda.iso === hoy;
              return (
                <button
                  key={celda.iso}
                  type="button"
                  onClick={() => onSelectDay(celda.iso)}
                  aria-label={`${formatFechaLarga(celda.iso)}, ${cantidad === 0 ? "sin turnos" : `${cantidad} turno${cantidad === 1 ? "" : "s"}`}`}
                  className={[
                    "flex min-h-20 flex-col items-start gap-1 bg-white p-2 text-left transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-500",
                    celda.enMes ? "" : "bg-gray-50 text-muted-foreground",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex size-6 items-center justify-center rounded-full text-sm",
                      esHoy ? "bg-orange-600 font-semibold text-white" : "",
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
