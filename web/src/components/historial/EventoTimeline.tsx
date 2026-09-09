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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  obtenerAdjuntoFirmado,
  obtenerAdjuntosFirmadosEvento,
  obtenerEvento,
} from "../../api/historial-clinico.ts";
import { ConsumoInsumosWidget } from "./ConsumoInsumosWidget.tsx";
import {
  ApiError,
  type AdjuntoFirmadoLote,
  type AdjuntoMeta,
  type HistorialDetalle,
  type HistorialItem,
  type TipoEventoClinico,
} from "../../types/index.ts";

// Tipos de imagen que el sistema acepta como adjunto (mismo CHECK de
// adjuntos_medicos, menos application/pdf: los PDF no tienen vista previa,
// siguen como enlace de descarga).
const TIPOS_IMAGEN = new Set(["image/jpeg", "image/png", "image/gif"]);

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

  // Vista previa de imágenes: signed URLs por adjunto, una sola petición por
  // evento abierto (no una por adjunto — ver obtenerAdjuntosFirmadosEvento).
  const [imagenes, setImagenes] = useState<Record<string, Record<string, AdjuntoFirmadoLote>>>({});
  const [cargandoImagenes, setCargandoImagenes] = useState<Record<string, boolean>>({});
  // Adjuntos para los que ya se reintentó una vez tras un error de carga (URL
  // vencida). Evita loops de reintento si la imagen está rota de verdad.
  const [reintentados, setReintentados] = useState<Set<string>>(new Set());

  async function alExpandir(id: string) {
    if (detalles[id] || cargando === id) return;
    setCargando(id);
    setErrorDetalle((e) => ({ ...e, [id]: "" }));
    try {
      const detalle = await obtenerEvento(id);
      setDetalles((d) => ({ ...d, [id]: detalle }));
      if (detalle.adjuntos.some((a) => TIPOS_IMAGEN.has(a.fileType))) {
        void cargarImagenes(id);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo cargar el detalle del evento";
      setErrorDetalle((e) => ({ ...e, [id]: message }));
    } finally {
      setCargando(null);
    }
  }

  async function cargarImagenes(eventoId: string) {
    setCargandoImagenes((c) => ({ ...c, [eventoId]: true }));
    try {
      const firmados = await obtenerAdjuntosFirmadosEvento(eventoId);
      setImagenes((m) => ({
        ...m,
        [eventoId]: Object.fromEntries(firmados.map((f) => [f.id, f])),
      }));
    } catch {
      // Sin vista previa disponible; el adjunto sigue accesible por descarga.
    } finally {
      setCargandoImagenes((c) => ({ ...c, [eventoId]: false }));
    }
  }

  function alFallarImagen(eventoId: string, adjuntoId: string) {
    if (reintentados.has(adjuntoId)) return;
    setReintentados((s) => new Set(s).add(adjuntoId));
    void cargarImagenes(eventoId); // la signed URL venció; se vuelve a pedir el lote
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
                  <span title="Tutor al momento del evento (distinto del actual)">
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
              <EventoDetalle
                detalle={detalles[evento.id]!}
                imagenesFirmadas={imagenes[evento.id]}
                cargandoImagenes={cargandoImagenes[evento.id] ?? false}
                onErrorImagen={(adjuntoId) => alFallarImagen(evento.id, adjuntoId)}
              />
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

interface EventoDetalleProps {
  detalle:           HistorialDetalle;
  imagenesFirmadas:  Record<string, AdjuntoFirmadoLote> | undefined;
  cargandoImagenes:  boolean;
  onErrorImagen:     (adjuntoId: string) => void;
}

function EventoDetalle({ detalle, imagenesFirmadas, cargandoImagenes, onErrorImagen }: EventoDetalleProps) {
  const imagenes = detalle.adjuntos.filter((a) => TIPOS_IMAGEN.has(a.fileType));
  const otros    = detalle.adjuntos.filter((a) => !TIPOS_IMAGEN.has(a.fileType));

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
      {imagenes.length > 0 ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Imágenes</span>
          <ul className="flex flex-wrap gap-2">
            {imagenes.map((adjunto) => (
              <li key={adjunto.id}>
                <AdjuntoImagenPreview
                  adjunto={adjunto}
                  firmado={imagenesFirmadas?.[adjunto.id]}
                  cargando={cargandoImagenes}
                  onError={() => onErrorImagen(adjunto.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {otros.length > 0 ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Adjuntos</span>
          <ul className="grid gap-1">
            {otros.map((adjunto) => (
              <AdjuntoRow key={adjunto.id} adjunto={adjunto} />
            ))}
          </ul>
        </div>
      ) : null}
      <ConsumoInsumosWidget
        historialId={detalle.id}
        profesionalNombre={detalle.professionalName}
      />
    </div>
  );
}

interface AdjuntoImagenPreviewProps {
  adjunto:  AdjuntoMeta;
  firmado:  AdjuntoFirmadoLote | undefined;
  cargando: boolean;
  onError:  () => void;
}

/**
 * Miniatura + lightbox (Dialog) para un adjunto de imagen. La signed URL llega
 * ya resuelta desde el lote pedido al expandir el evento (una sola petición
 * por evento, ver `cargarImagenes` en EventoTimeline); si no llegó (todavía
 * cargando, o la firma falló) cae a la fila de descarga existente.
 */
function AdjuntoImagenPreview({ adjunto, firmado, cargando, onError }: AdjuntoImagenPreviewProps) {
  if (!firmado) {
    return cargando
      ? <Skeleton className="size-20 rounded-md" aria-label={`Cargando vista previa de ${adjunto.fileName}`} />
      : <AdjuntoRow adjunto={adjunto} />;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block size-20 overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <img
            src={firmado.url}
            alt={adjunto.fileName}
            className="size-full object-cover"
            onError={onError}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{adjunto.fileName}</DialogTitle>
        </DialogHeader>
        <img
          src={firmado.url}
          alt={adjunto.fileName}
          className="max-h-[75vh] w-full rounded-md object-contain"
          onError={onError}
        />
        <DialogFooter>
          <Button asChild variant="outline" size="sm">
            <a href={firmado.url} target="_blank" rel="noopener noreferrer" download={adjunto.fileName}>
              <Download className="size-3.5" aria-hidden />
              Descargar
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
