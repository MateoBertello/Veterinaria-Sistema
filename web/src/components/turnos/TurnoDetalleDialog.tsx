import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { CalendarClock, PawPrint, Stethoscope, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Label } from "../ui/label.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ApiError, ErrorCode, type EstadoTurno, type Turno } from "../../types/index.ts";
import { ESTADO_BADGE_CLASS, TRANSICION_SIGUIENTE } from "./estado.ts";

/** Funciones de datos/mutación inyectadas (patrón DI para testeo). */
export interface TurnoDetalleApi {
  obtenerTurno:  (id: string) => Promise<Turno>;
  cancelarTurno: (id: string, cancellationReason: string) => Promise<Turno>;
  cambiarEstado: (id: string, status: EstadoTurno) => Promise<Turno>;
  eliminarTurno: (id: string) => Promise<void>;
}

interface Props {
  turnoId:      string | null;
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras cualquier acción exitosa para refrescar la agenda. */
  onSuccess:    () => void;
  /** Reabre el flujo de agendar en modo edición con los datos cargados (RN-MC2). */
  onModificar:  (id: string) => void;
  api:          TurnoDetalleApi;
}

// Códigos ante los que conviene re-fetchear el detalle: el estado del turno pudo
// cambiar bajo los pies (otro usuario lo tocó), así que refrescamos las acciones.
const CODIGOS_REFETCH = new Set<string>([
  ErrorCode.APPOINTMENT_LOCKED,
  ErrorCode.INVALID_TRANSITION,
  ErrorCode.TURNO_SOLAPADO,
]);

function formatFechaLarga(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Modal unificado de detalle del turno con acciones por estado (pantalla 2, RN-MC1).
 * Los botones modificar/cancelar/eliminar salen de `accionesDisponibles` (el backend
 * autoriza, no el front); el botón de transición se DIBUJA según la cadena lineal del
 * estado, pero el backend decide si procede (INVALID_TRANSITION).
 */
export function TurnoDetalleDialog({
  turnoId, open, onOpenChange, onSuccess, onModificar, api,
}: Props) {
  const [turno, setTurno] = useState<Turno | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const cargar = useCallback(async () => {
    if (!turnoId) return;
    setLoading(true);
    setError(null);
    try {
      setTurno(await api.obtenerTurno(turnoId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el turno");
    } finally {
      setLoading(false);
    }
  }, [turnoId, api]);

  useEffect(() => {
    if (!open) {
      // Limpia el estado al cerrar para no mostrar datos viejos al reabrir otra fila.
      setTurno(null);
      setError(null);
      setCancelOpen(false);
      setDeleteOpen(false);
      return;
    }
    void cargar();
  }, [open, cargar]);

  /** Traduce el error de una acción a toast + re-fetch cuando el estado pudo cambiar. */
  function manejarErrorAccion(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      toast.error(err.message);
      if (CODIGOS_REFETCH.has(err.code)) void cargar();
      return;
    }
    toast.error(fallback);
  }

  async function transicionar(status: EstadoTurno, label: string) {
    if (!turno) return;
    setBusy(true);
    try {
      await api.cambiarEstado(turno.id, status);
      toast.success(`Turno marcado como ${status.toLowerCase()}`);
      onSuccess();
      await cargar(); // el modal sigue abierto: refrescar estado y acciones
    } catch (err) {
      manejarErrorAccion(err, `No se pudo ${label.toLowerCase()} el turno`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmarCancelacion(cancellationReason: string) {
    if (!turno) return;
    setBusy(true);
    try {
      await api.cancelarTurno(turno.id, cancellationReason);
      toast.success("Turno cancelado");
      setCancelOpen(false);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      manejarErrorAccion(err, "No se pudo cancelar el turno");
    } finally {
      setBusy(false);
    }
  }

  async function confirmarEliminacion() {
    if (!turno) return;
    setBusy(true);
    try {
      await api.eliminarTurno(turno.id);
      toast.success("Turno eliminado");
      setDeleteOpen(false);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      manejarErrorAccion(err, "No se pudo eliminar el turno");
    } finally {
      setBusy(false);
    }
  }

  const acciones = turno?.accionesDisponibles ?? [];
  const puede = (a: string) => acciones.includes(a);
  const transicion = turno ? TRANSICION_SIGUIENTE[turno.status] : null;
  const hayAcciones = turno
    ? Boolean(transicion) || puede("modificar") || puede("cancelar") || puede("eliminar")
    : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-800">
            <CalendarClock className="size-5" aria-hidden />
            Detalle del turno
          </DialogTitle>
          <DialogDescription>
            {turno
              ? `${turno.mascota?.name ?? "Mascota"} · ${formatFechaLarga(turno.date)}`
              : "Turno seleccionado de la agenda."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid gap-3 py-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="py-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
              Reintentar
            </Button>
          </div>
        ) : turno ? (
          <>
            <div className="grid gap-4 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium capitalize">
                  <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                  {turno.startTime} – {turno.endTime}
                </span>
                <Badge className={ESTADO_BADGE_CLASS[turno.status]}>{turno.status}</Badge>
              </div>

              <DetalleFila icon={<Stethoscope className="size-4" aria-hidden />} label="Servicio">
                {turno.servicio ? (
                  <>
                    {turno.servicio.nombre}
                    <span className="text-muted-foreground"> · {turno.servicio.duracionMinutos} min</span>
                  </>
                ) : "—"}
              </DetalleFila>

              <DetalleFila icon={<User className="size-4" aria-hidden />} label="Doctor">
                {turno.doctor?.name ?? "Sin profesional asignado"}
              </DetalleFila>

              <DetalleFila icon={<PawPrint className="size-4" aria-hidden />} label="Mascota / Cliente">
                <span className="font-medium">{turno.mascota?.name ?? "—"}</span>
                <span className="text-muted-foreground"> · {turno.cliente?.fullName ?? "—"}</span>
              </DetalleFila>

              <DetalleFila label="Motivo">{turno.reason || "—"}</DetalleFila>

              {turno.notes ? <DetalleFila label="Notas">{turno.notes}</DetalleFila> : null}

              {turno.status === "Cancelado" ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                  <p className="font-medium text-red-800">Turno cancelado</p>
                  {turno.cancellationReason ? (
                    <p className="mt-1 text-red-700">{turno.cancellationReason}</p>
                  ) : null}
                  {turno.cancelledAt ? (
                    <p className="mt-1 text-xs text-red-600">{formatTimestamp(turno.cancelledAt)}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <DialogFooter className="gap-2">
              {!hayAcciones ? (
                <p className="text-sm text-muted-foreground">
                  No hay acciones disponibles para este turno.
                </p>
              ) : (
                <>
                  {puede("eliminar") ? (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setDeleteOpen(true)}
                    >
                      Eliminar
                    </Button>
                  ) : null}
                  {puede("cancelar") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancelar turno
                    </Button>
                  ) : null}
                  {puede("modificar") ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        onModificar(turno.id);
                        onOpenChange(false);
                      }}
                    >
                      Modificar
                    </Button>
                  ) : null}
                  {transicion ? (
                    <Button
                      disabled={busy}
                      onClick={() => void transicionar(transicion.status, transicion.label)}
                    >
                      {transicion.label}
                    </Button>
                  ) : null}
                </>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>

      {/* Cancelar: motivo obligatorio (RN-MC5). Se superpone al modal de detalle. */}
      <CancelarTurnoAlert
        open={cancelOpen}
        busy={busy}
        onOpenChange={setCancelOpen}
        onConfirm={confirmarCancelacion}
      />

      {/* Eliminar: confirmación destructiva. */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar turno</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción elimina el turno de forma permanente. ¿Querés continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Volver</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmarEliminacion()}>
              Eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function DetalleFila({
  icon, label, children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

interface CancelarProps {
  open:         boolean;
  busy:         boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm:    (cancellationReason: string) => void;
}

function CancelarTurnoAlert({ open, busy, onOpenChange, onConfirm }: CancelarProps) {
  const {
    control, handleSubmit, reset,
    formState: { errors },
  } = useForm<{ cancellationReason: string }>({ defaultValues: { cancellationReason: "" } });

  useEffect(() => {
    if (open) reset({ cancellationReason: "" });
  }, [open, reset]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar turno</AlertDialogTitle>
          <AlertDialogDescription>
            Indicá el motivo de la cancelación. Queda registrado en el turno.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          onSubmit={handleSubmit((v) => onConfirm(v.cancellationReason.trim()))}
          className="grid gap-2 py-1"
          noValidate
        >
          <Label htmlFor="cancellationReason">Motivo *</Label>
          <Controller
            control={control}
            name="cancellationReason"
            rules={{
              required: "El motivo es requerido",
              maxLength: { value: 500, message: "Máximo 500 caracteres" },
              validate: (v) => v.trim().length > 0 || "El motivo es requerido",
            }}
            render={({ field: { ref: _ref, ...field } }) => (
              <Textarea
                id="cancellationReason"
                rows={3}
                aria-invalid={Boolean(errors.cancellationReason)}
                aria-describedby={errors.cancellationReason ? "cancellationReason-error" : undefined}
                {...field}
              />
            )}
          />
          {errors.cancellationReason ? (
            <p id="cancellationReason-error" role="alert" className="text-sm text-destructive">
              {errors.cancellationReason.message}
            </p>
          ) : null}

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel type="button" disabled={busy}>Volver</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={busy}>
              Confirmar cancelación
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
