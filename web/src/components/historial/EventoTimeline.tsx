import { useState } from "react";
import { Download, Loader2, Paperclip, UserRoundX } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { obtenerAdjuntoFirmado, obtenerEvento } from "../../api/historial-clinico.ts";
import {
  ApiError,
  type HistorialDetalle,
  type HistorialItem,
  type TipoEventoClinico,
} from "../../types/index.ts";

// Semántica de color por tipo de evento (docs/GUIA_ESTILO.md): naranja=clínica
// general, verde=vacunación, rojo=emergencia, ámbar=control/seguimiento,
// púrpura=procedimientos/estudios especiales.
const TIPO_EVENTO_CLASSNAME: Record<TipoEventoClinico, string> = {
  "Consulta":        "bg-orange-100 text-orange-800",
  "Vacunación":      "bg-green-100 text-green-800",
  "Cirugía":         "bg-purple-100 text-purple-800",
  "Análisis":        "bg-purple-100 text-purple-800",
  "Radiografía":     "bg-purple-100 text-purple-800",
  "Ecografía":       "bg-purple-100 text-purple-800",
  "Desparasitación": "bg-amber-100 text-amber-800",
  "Control":         "bg-amber-100 text-amber-800",
  "Emergencia":      "bg-red-100 text-red-800",
  "Internación":     "bg-red-100 text-red-800",
  "Eutanasia":       "bg-red-100 text-red-800",
  "Otro":            "bg-gray-100 text-gray-800",
};

function TipoEventoBadge({ tipo }: { tipo: TipoEventoClinico }) {
  return <Badge className={TIPO_EVENTO_CLASSNAME[tipo]}>{tipo}</Badge>;
}

function formatFecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  eventos: HistorialItem[];
}

export function EventoTimeline({ eventos }: Props) {
  const [detalles, setDetalles] = useState<Record<string, HistorialDetalle>>({});
  const [cargando, setCargando] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<Record<string, string>>({});

  async function alExpandir(id: string) {
    if (detalles[id] || cargando === id) return;
    setCargando(id);
    setErrorDetalle((e) => ({ ...e, [id]: "" }));
    try {
      const detalle = await obtenerEvento(id);
      setDetalles((d) => ({ ...d, [id]: detalle }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el detalle del evento";
      setErrorDetalle((e) => ({ ...e, [id]: message }));
    } finally {
      setCargando(null);
    }
  }

  return (
    <Accordion type="single" collapsible onValueChange={(v) => v && void alExpandir(v)}>
      {eventos.map((evento) => (
        <AccordionItem key={evento.id} value={evento.id}>
          <AccordionTrigger>
            <div className="flex flex-1 flex-wrap items-center gap-3 pr-2">
              <span className="text-sm font-medium text-muted-foreground">{formatFecha(evento.date)}</span>
              <TipoEventoBadge tipo={evento.eventType} />
              <span className="text-sm">{evento.professionalName ?? "—"}</span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {evento.clientNameAtTime}
                {evento.isPreviousOwner ? (
                  <span title="Dueño al momento del evento (distinto del actual)">
                    <UserRoundX className="size-3.5" aria-hidden />
                  </span>
                ) : null}
              </span>
              {evento.hasAttachments ? <Paperclip className="size-4 text-muted-foreground" aria-hidden /> : null}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            {cargando === evento.id ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : errorDetalle[evento.id] ? (
              <p className="text-sm text-destructive">{errorDetalle[evento.id]}</p>
            ) : detalles[evento.id] ? (
              <EventoDetalle detalle={detalles[evento.id]!} />
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function EventoDetalle({ detalle }: { detalle: HistorialDetalle }) {
  return (
    <div className="grid gap-3 text-sm">
      <p>{detalle.description}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {detalle.weightKg != null ? <Campo label="Peso" valor={`${detalle.weightKg} kg`} /> : null}
        {detalle.temperatureC != null ? <Campo label="Temperatura" valor={`${detalle.temperatureC} °C`} /> : null}
        {detalle.diagnosis ? <Campo label="Diagnóstico" valor={detalle.diagnosis} /> : null}
        {detalle.treatment ? <Campo label="Tratamiento" valor={detalle.treatment} /> : null}
        {detalle.medication ? <Campo label="Medicación" valor={detalle.medication} /> : null}
        {detalle.notes ? <Campo label="Notas" valor={detalle.notes} /> : null}
      </dl>
      {detalle.adjuntos.length > 0 ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Adjuntos</span>
          <ul className="grid gap-1">
            {detalle.adjuntos.map((adjunto) => (
              <AdjuntoRow key={adjunto.id} adjunto={adjunto} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function AdjuntoRow({ adjunto }: { adjunto: { id: string; fileName: string } }) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");

  async function descargar() {
    setDescargando(true);
    setError("");
    try {
      const firmado = await obtenerAdjuntoFirmado(adjunto.id);
      window.open(firmado.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo obtener el adjunto");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <li className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void descargar()}
        disabled={descargando}
      >
        {descargando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
        {adjunto.fileName}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </li>
  );
}
