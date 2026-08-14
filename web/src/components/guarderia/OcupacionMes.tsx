import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { pendienteDeAccion } from "./estadoEstadia.ts";
import {
  addMeses,
  construirGrillaMes,
  diaDelMes,
  formatFechaLarga,
  formatMesLargo,
  hoyISO,
} from "../turnos/fechas.ts";
import { listarEstadiasRango } from "../../api/estadias.ts";
import { ApiError, type Estadia } from "../../types/index.ts";

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Props {
  /** Fecha de referencia inicial (define el mes visible al abrir). */
  fechaInicial: string;
  /** Al elegir un día se navega a la ocupación de ese día (reusa la vista día). */
  onSelectDay: (iso: string) => void;
}

interface ResumenDia {
  total:      number;
  pendientes: number;
}

export function OcupacionMes({ fechaInicial, onSelectDay }: Props) {
  const [anchor, setAnchor] = useState(fechaInicial);
  const [estadias, setEstadias] = useState<Estadia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  const semanas = useMemo(() => construirGrillaMes(anchor), [anchor]);
  const celdas = useMemo(() => semanas.flat(), [semanas]);
  const rangoDesde = celdas[0]?.iso;
  const rangoHasta = celdas[celdas.length - 1]?.iso;

  useEffect(() => {
    if (!rangoDesde || !rangoHasta) return;
    let vigente = true;
    setLoading(true);
    setError(null);
    // Una sola consulta trae todas las estadías que solapan la grilla visible; se
    // agrupan por día en el cliente (sin N+1), igual que el calendario de Turnos.
    listarEstadiasRango({ dateFrom: rangoDesde, dateTo: rangoHasta })
      .then((e) => { if (vigente) setEstadias(e); })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : "No se pudo cargar el calendario");
      })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
  }, [rangoDesde, rangoHasta, intento]);

  const hoy = hoyISO();

  // Ocupación y pendientes por día: una estadía cuenta en cada día que solapa
  // (check_in ≤ iso ≤ check_out). Excluye Finalizada del conteo de ocupación (ya
  // no ocupa lugar), pero las pendientes se derivan de Reservada/EnCurso vencidas.
  const resumenPorDia = useMemo(() => {
    const map = new Map<string, ResumenDia>();
    for (const e of estadias) {
      const pend = pendienteDeAccion(e, hoy) !== null;
      const ocupa = e.status === "Reservada" || e.status === "EnCurso";
      for (const celda of celdas) {
        const iso = celda.iso;
        if (e.checkInDate <= iso && iso <= e.checkOutDate) {
          const prev = map.get(iso) ?? { total: 0, pendientes: 0 };
          map.set(iso, {
            total:      prev.total + (ocupa ? 1 : 0),
            pendientes: prev.pendientes + (pend ? 1 : 0),
          });
        }
      }
    }
    return map;
  }, [estadias, celdas, hoy]);

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
            {celdas.map((celda) => {
              const resumen = resumenPorDia.get(celda.iso) ?? { total: 0, pendientes: 0 };
              const esHoy = celda.iso === hoy;
              const ariaResumen = resumen.total === 0
                ? "sin estadías"
                : `${resumen.total} estadía${resumen.total === 1 ? "" : "s"}${resumen.pendientes > 0 ? `, ${resumen.pendientes} pendiente${resumen.pendientes === 1 ? "" : "s"} de acción` : ""}`;
              return (
                <button
                  key={celda.iso}
                  type="button"
                  onClick={() => onSelectDay(celda.iso)}
                  aria-label={`${formatFechaLarga(celda.iso)}, ${ariaResumen}`}
                  className={[
                    "flex min-h-20 flex-col items-start gap-1 bg-white p-2 text-left transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-700",
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
                  {resumen.total > 0 ? (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                      {resumen.total} estadía{resumen.total === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {resumen.pendientes > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {resumen.pendientes} pendiente{resumen.pendientes === 1 ? "" : "s"}
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
