import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, PencilLine } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableScrollContainer,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.tsx";
import { Button } from "../ui/button.tsx";
import { Badge } from "../ui/badge.tsx";
import { Input } from "../ui/input.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { TurnoDetalleDialog } from "./TurnoDetalleDialog.tsx";
import { FlujoEstadosHelp } from "./FlujoEstadosHelp.tsx";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_ROW_ACCENT,
  TRANSICION_SIGUIENTE,
  esTerminal,
} from "./estado.ts";
import { addDias, formatFechaLarga, hoyISO } from "./fechas.ts";
import {
  cambiarEstado,
  cancelarTurno,
  eliminarTurno,
  listarTurnos,
  obtenerTurno,
} from "../../api/turnos.ts";
import { ApiError, type EstadoTurno, type Turno } from "../../types/index.ts";

const COLUMNAS = 6;

// API de detalle inyectada al modal (patrón DI: facilita el testeo del diálogo).
const TURNO_DETALLE_API = { obtenerTurno, cancelarTurno, cambiarEstado, eliminarTurno };

type Filtro = "activos" | "completados" | "cancelados";

const FILTROS: { id: Filtro; label: string; status?: EstadoTurno }[] = [
  { id: "activos", label: "Activos" },
  { id: "completados", label: "Completados", status: "Completado" },
  { id: "cancelados", label: "Cancelados", status: "Cancelado" },
];

interface Props {
  fecha:   string;
  onFecha: (iso: string) => void;
}

export function AgendaDia({ fecha, onFecha }: Props) {
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<Filtro>("activos");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [actuandoId, setActuandoId] = useState<string | null>(null);

  const status = FILTROS.find((f) => f.id === filtro)?.status;

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTurnos(await listarTurnos({ date: fecha, status }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la agenda");
    } finally {
      setLoading(false);
    }
  }, [fecha, status]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Resumen del día: en "Activos" desglosa Programado vs Confirmado (efecto
  // observable al confirmar); en filtros terminales, solo el total.
  const resumen = useMemo(() => {
    const programados = turnos.filter((t) => t.status === "Programado").length;
    const confirmados = turnos.filter((t) => t.status === "Confirmado").length;
    return { programados, confirmados, total: turnos.length };
  }, [turnos]);

  async function transicionar(t: Turno) {
    const siguiente = TRANSICION_SIGUIENTE[t.status];
    if (!siguiente) return;
    setActuandoId(t.id);
    try {
      await cambiarEstado(t.id, siguiente.status);
      toast.success(`Turno marcado como ${siguiente.status.toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo cambiar el estado");
    } finally {
      setActuandoId(null);
      await cargar(); // refresca la lista y el resumen (RN-ES / efecto observable)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Día anterior"
            onClick={() => onFecha(addDias(fecha, -1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-56 text-center text-sm font-medium capitalize">
            {formatFechaLarga(fecha)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Día siguiente"
            onClick={() => onFecha(addDias(fecha, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={fecha === hoyISO()}
          onClick={() => onFecha(hoyISO())}
        >
          Hoy
        </Button>

        <Input
          type="date"
          aria-label="Elegir fecha de la agenda"
          className="w-40"
          value={fecha}
          onChange={(e) => { if (e.target.value) onFecha(e.target.value); }}
        />
      </div>

      {/* Filtro por estado (RN-ES / valor del estado) + ayuda del flujo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filtro === f.id ? "default" : "outline"}
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <FlujoEstadosHelp />
      </div>

      {!loading && !error ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtro === "activos"
            ? `${resumen.programados} programado${resumen.programados === 1 ? "" : "s"} · ${resumen.confirmados} confirmado${resumen.confirmados === 1 ? "" : "s"} · ${resumen.total} en total`
            : `${resumen.total} turno${resumen.total === 1 ? "" : "s"}`}
        </p>
      ) : null}

      <TableScrollContainer aria-label="Turnos del día">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Hora</TableHead>
              <TableHead>Servicio</TableHead>
              <TableHead className="hidden md:table-cell">Doctor</TableHead>
              <TableHead>Mascota / Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={COLUMNAS} className="py-10 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : turnos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNAS} className="py-10 text-center text-sm text-muted-foreground">
                  No hay turnos para el {formatFechaLarga(fecha)}.
                </TableCell>
              </TableRow>
            ) : (
              turnos.map((t) => {
                const siguiente = TRANSICION_SIGUIENTE[t.status];
                const editable = !esTerminal(t.status);
                return (
                  <TableRow
                    key={t.id}
                    tabIndex={0}
                    aria-label={`Turno de ${t.mascota?.name ?? "sin mascota"} a las ${t.startTime}, estado ${t.status}${t.vencido ? ", vencido sin cerrar" : ""}`}
                    className={`cursor-pointer border-l-4 ${t.vencido ? "border-l-red-500" : ESTADO_ROW_ACCENT[t.status]} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange-500`}
                    onClick={() => setDetalleId(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetalleId(t.id);
                      }
                    }}
                  >
                    <TableCell className="font-medium">
                      {t.startTime} – {t.endTime}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col">
                        <span>{t.servicio?.nombre ?? "—"}</span>
                        {t.servicio ? (
                          <span className="text-xs text-muted-foreground">
                            {t.servicio.duracionMinutos} min
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal md:table-cell">
                      {t.doctor?.name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col">
                        <span className="font-medium">{t.mascota?.name ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.cliente?.fullName ?? "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={ESTADO_BADGE_CLASS[t.status]}>{t.status}</Badge>
                        {t.vencido ? (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Vencido</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {editable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Editar turno de ${t.mascota?.name ?? "mascota"}`}
                            onClick={() => navigate(`/turnos/${t.id}/editar`)}
                          >
                            <PencilLine className="size-4" aria-hidden />
                            Editar
                          </Button>
                        ) : null}
                        {siguiente ? (
                          <Button
                            size="sm"
                            disabled={actuandoId === t.id}
                            onClick={() => void transicionar(t)}
                          >
                            {siguiente.label}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableScrollContainer>

      <TurnoDetalleDialog
        turnoId={detalleId}
        open={detalleId !== null}
        onOpenChange={(o) => { if (!o) setDetalleId(null); }}
        onSuccess={() => void cargar()}
        onModificar={(id) => navigate(`/turnos/${id}/editar`)}
        api={TURNO_DETALLE_API}
      />
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUMNAS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
