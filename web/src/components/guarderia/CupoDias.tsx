import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import { addDias, formatFechaLarga } from "../turnos/fechas.ts";
import { obtenerCupo } from "../../api/estadias.ts";
import { ApiError, type CupoDia } from "../../types/index.ts";

const MAX_DIAS_VISIBLES = 31;

interface Props {
  checkInDate:  string;
  checkOutDate: string;
  /** Fechas (YYYY-MM-DD) marcadas por un CUPO_GUARDERIA_AGOTADO reciente: se
   * fuerzan a "sin cupo" aunque el último fetch de /cupo diga lo contrario
   * (evita la ventana entre pintar el cupo y el conflicto real al crear). */
  diasAgotadosForzados?: string[];
}

function enumerarDias(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  let cursor = desde;
  while (cursor <= hasta && dias.length < MAX_DIAS_VISIBLES) {
    dias.push(cursor);
    cursor = addDias(cursor, 1);
  }
  return dias;
}

function labelCorta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Indicador visual de cupo de guardería por día (Addendum v1.1 pantalla 3):
 * un chip por día del rango elegido, verde si hay lugar y rojo si está lleno.
 * Puramente informativo — no bloquea el submit del form si el fetch falla,
 * porque el backend siempre revalida el cupo real al crear la estadía.
 */
export function CupoDias({ checkInDate, checkOutDate, diasAgotadosForzados }: Props) {
  const [cupos, setCupos] = useState<CupoDia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  const rangoValido = Boolean(checkInDate) && Boolean(checkOutDate) && checkOutDate >= checkInDate;

  useEffect(() => {
    if (!rangoValido) {
      setCupos([]);
      setError(null);
      return;
    }
    let vigente = true;
    setLoading(true);
    setError(null);
    obtenerCupo({ dateFrom: checkInDate, dateTo: checkOutDate })
      .then((data) => { if (vigente) setCupos(data); })
      .catch((err) => {
        if (vigente) {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la disponibilidad");
        }
      })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInDate, checkOutDate, rangoValido, intento]);

  // Un 409 CUPO_GUARDERIA_AGOTADO nuevo dispara un refetch para reconciliar el
  // cupo visual con el estado real post-conflicto.
  useEffect(() => {
    if (diasAgotadosForzados && diasAgotadosForzados.length > 0) {
      setIntento((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diasAgotadosForzados]);

  const cupoPorDia = useMemo(() => {
    const map = new Map<string, CupoDia>();
    for (const c of cupos) map.set(c.date, c);
    return map;
  }, [cupos]);

  const dias = useMemo(
    () => (rangoValido ? enumerarDias(checkInDate, checkOutDate) : []),
    [rangoValido, checkInDate, checkOutDate],
  );

  if (!rangoValido) {
    return (
      <p className="text-sm text-muted-foreground">
        Elegí las fechas de check-in y check-out para ver la disponibilidad de cupo.
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border p-3 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setIntento((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {dias.map((d) => (
          <Skeleton key={d} className="h-8 w-16" />
        ))}
      </div>
    );
  }

  const agotados = new Set(diasAgotadosForzados ?? []);

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Cupo de guardería por día">
      {dias.map((iso) => {
        const cupo = cupoPorDia.get(iso);
        const forzado = agotados.has(iso);
        const sinCupo = forzado || (cupo != null && cupo.disponible <= 0);
        const detalle = forzado
          ? `${formatFechaLarga(iso)}: sin cupo disponible (se ocupó el último lugar)`
          : cupo
            ? sinCupo
              ? `${formatFechaLarga(iso)}: sin cupo disponible (${cupo.ocupados}/${cupo.cupo})`
              : `${formatFechaLarga(iso)}: ${cupo.disponible} lugar${cupo.disponible === 1 ? "" : "es"} disponible (${cupo.ocupados}/${cupo.cupo})`
            : `${formatFechaLarga(iso)}: disponibilidad desconocida`;

        return (
          <Tooltip key={iso}>
            <TooltipTrigger asChild>
              <span
                role="listitem"
                aria-label={detalle}
                className={[
                  "rounded-full px-3 py-1 text-xs font-medium",
                  sinCupo ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800",
                ].join(" ")}
              >
                {labelCorta(iso)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{detalle}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
