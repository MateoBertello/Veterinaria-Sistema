import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import type { DosisVacunacion, EstadoVisualDosis } from "../../types/index.ts";

// Semántica de color por estadoVisual (docs/GUIA_ESTILO.md): rojo=vencido,
// ámbar=próximo a vencer, verde=completado, gris=neutral/inactivo. RN-PV1: el
// estadoVisual llega derivado del server, NO se recalcula en el front.
const ESTADO_VISUAL_CLASSNAME: Record<EstadoVisualDosis, string> = {
  "Vencida":   "bg-red-100 text-red-800",
  "Proxima":   "bg-amber-100 text-amber-800",
  "Aplicada":  "bg-green-100 text-green-800",
  "Cancelada": "bg-gray-100 text-gray-800",
};

const ESTADO_VISUAL_LABEL: Record<EstadoVisualDosis, string> = {
  "Vencida":   "Vencida",
  "Proxima":   "Próxima",
  "Aplicada":  "Aplicada",
  "Cancelada": "Cancelada",
};

function EstadoVisualBadge({ estadoVisual }: { estadoVisual: EstadoVisualDosis }) {
  return <Badge className={ESTADO_VISUAL_CLASSNAME[estadoVisual]}>{ESTADO_VISUAL_LABEL[estadoVisual]}</Badge>;
}

function formatFecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  dosis: DosisVacunacion[];
  onMarcarAplicada?: (dosis: DosisVacunacion) => void;
}

export function PlanVacunacionTimeline({ dosis, onMarcarAplicada }: Props) {
  return (
    <ul className="divide-y">
      {dosis.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-sm font-medium text-muted-foreground">{formatFecha(d.fechaEstimada)}</span>
          <span className="text-sm">{d.tipoVacunaNombre ?? "—"}</span>
          <EstadoVisualBadge estadoVisual={d.estadoVisual} />
          {d.notas ? <span className="text-sm text-muted-foreground">{d.notas}</span> : null}
          {/* RN-PV1: estado (no estadoVisual, que es derivado) es la fuente de verdad de si la dosis admite acción. */}
          {onMarcarAplicada && d.estado === "Pendiente" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onMarcarAplicada(d)}
            >
              Marcar aplicada
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
