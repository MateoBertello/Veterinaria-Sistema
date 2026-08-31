import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Badge } from "../ui/badge.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { ESTADO_BADGE_CLASS, ESTADO_LABEL, PENDIENTE_LABEL, pendienteDeAccion } from "./estadoEstadia.ts";
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
  /** Estadías que ocupan lugar ese día (Reservada/EnCurso), para el popover de vista previa. */
  alojadas:   Estadia[];
}

function etiquetaResumen(resumen: ResumenDia): string {
  return resumen.total === 0
    ? "sin estadías"
    : `${resumen.total} estadía${resumen.total === 1 ? "" : "s"}${resumen.pendientes > 0 ? `, ${resumen.pendientes} pendiente${resumen.pendientes === 1 ? "" : "s"} de acción` : ""}`;
}

// Mismo fallback que OcupacionDia.tsx: `status` es un string abierto del backend.
function badgeClass(status: string): string {
  return ESTADO_BADGE_CLASS[status as keyof typeof ESTADO_BADGE_CLASS] ?? "bg-gray-100 text-gray-800 hover:bg-gray-100";
}

function estadoLabel(status: string): string {
  return ESTADO_LABEL[status as keyof typeof ESTADO_LABEL] ?? status;
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

  // Ocupación, pendientes y detalle por día: una estadía cuenta en cada día que
  // solapa (check_in ≤ iso ≤ check_out). Excluye Finalizada/Cancelada (ya no ocupan
  // lugar); las pendientes se derivan de Reservada/EnCurso vencidas. `alojadas`
  // conserva las mascotas de ese día (mismo dato ya traído) para el popover de
  // vista previa, sin pedir nada extra al abrirlo.
  const resumenPorDia = useMemo(() => {
    const map = new Map<string, ResumenDia>();
    for (const celda of celdas) map.set(celda.iso, { total: 0, pendientes: 0, alojadas: [] });
    for (const e of estadias) {
      const ocupa = e.status === "Reservada" || e.status === "EnCurso";
      if (!ocupa) continue;
      const pend = pendienteDeAccion(e, hoy) !== null;
      for (const celda of celdas) {
        const iso = celda.iso;
        if (e.checkInDate <= iso && iso <= e.checkOutDate) {
          const resumen = map.get(iso)!;
          resumen.total += 1;
          resumen.alojadas.push(e);
          if (pend) resumen.pendientes += 1;
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
              const resumen = resumenPorDia.get(celda.iso) ?? { total: 0, pendientes: 0, alojadas: [] };
              const esHoy = celda.iso === hoy;
              const ariaResumen = etiquetaResumen(resumen);
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
                    aria-label={`Ver el detalle del ${formatFechaLarga(celda.iso)}: ${ariaResumen}`}
                    className="flex w-full flex-1 cursor-pointer flex-col items-start gap-1 p-2 text-left transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-700"
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
                  {resumen.total > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Vista previa del ${formatFechaLarga(celda.iso)}: ${ariaResumen}`}
                          className="absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-full text-orange-700 hover:bg-orange-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-700"
                        >
                          <ChevronDown className="size-3.5" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-3">
                        <div className="space-y-2">
                          <p className="text-sm font-medium capitalize">{formatFechaLarga(celda.iso)}</p>
                          {resumen.alojadas.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin huéspedes alojados este día.</p>
                          ) : (
                            <ul className="max-h-64 space-y-2 overflow-y-auto">
                              {resumen.alojadas.map((e) => {
                                const pend = pendienteDeAccion(e, hoy);
                                return (
                                  <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
                                    <div className="flex flex-col">
                                      <span className="font-medium">{e.petName}</span>
                                      <span className="text-xs text-muted-foreground">{e.clientName}</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                      <Badge className={badgeClass(e.status)}>{estadoLabel(e.status)}</Badge>
                                      {pend ? (
                                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                                          {PENDIENTE_LABEL[pend]}
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </li>
                                );
                              })}
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
