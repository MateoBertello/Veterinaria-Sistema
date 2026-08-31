import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Button } from "../ui/button.tsx";
import { Badge } from "../ui/badge.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_LABEL,
  ESTADO_ROW_ACCENT,
  PENDIENTE_LABEL,
  esTerminal,
  pendienteDeAccion,
  puedeCancelar,
  puedeModificar,
  transicionSiguiente,
  type EstadoEstadia,
} from "./estadoEstadia.ts";
import { addDias, formatFechaLarga, hoyISO } from "../turnos/fechas.ts";
import {
  cancelarEstadia,
  checkinEstadia,
  checkoutEstadia,
  listarEstadias,
  obtenerCupo,
} from "../../api/estadias.ts";
import { ApiError, type CupoDia, type Estadia } from "../../types/index.ts";

const COLUMNAS = 5;

// Fallback de dieta (RN-MA9): el backend puede devolver null si la mascota no
// tiene indicaciones cargadas.
const SIN_DIETA = "Sin indicaciones de dieta";

function badgeClass(status: string): string {
  return ESTADO_BADGE_CLASS[status as EstadoEstadia] ?? "bg-gray-100 text-gray-800 hover:bg-gray-100";
}

function rowAccent(status: string): string {
  return ESTADO_ROW_ACCENT[status as EstadoEstadia] ?? "border-l-gray-300";
}

function estadoLabel(status: string): string {
  return ESTADO_LABEL[status as EstadoEstadia] ?? status;
}

interface Props {
  fecha:   string;
  onFecha: (iso: string) => void;
}

export function OcupacionDia({ fecha, onFecha }: Props) {
  const navigate = useNavigate();
  const [estadias, setEstadias] = useState<Estadia[]>([]);
  const [cupo, setCupo] = useState<CupoDia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actuandoId, setActuandoId] = useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [busyCancelar, setBusyCancelar] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Dos consultas independientes: filas del día + ocupación vs. cupo de ese día.
      const [filas, cupos] = await Promise.all([
        listarEstadias({ date: fecha }),
        obtenerCupo({ dateFrom: fecha, dateTo: fecha }),
      ]);
      setEstadias(filas);
      setCupo(cupos[0] ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la ocupación");
    } finally {
      setLoading(false);
    }
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const hoy = hoyISO();
  // Estadías vencidas sin la transición hecha (RN-CK): el sistema avisa, el humano actúa.
  const pendientes = useMemo(
    () => estadias.filter((e) => pendienteDeAccion(e, hoy) !== null).length,
    [estadias, hoy],
  );

  async function accionar(e: Estadia) {
    const siguiente = transicionSiguiente(e.status);
    if (!siguiente) return;
    setActuandoId(e.id);
    try {
      if (siguiente.action === "checkin") {
        await checkinEstadia(e.id);
        toast.success(`Check-in de ${e.petName} registrado`);
      } else {
        await checkoutEstadia(e.id);
        toast.success(`Check-out de ${e.petName} registrado`);
      }
    } catch (err) {
      // El backend es la autoridad: si rechaza (p. ej. INVALID_TRANSITION), lo mostramos.
      toast.error(err instanceof ApiError ? err.message : "No se pudo completar la acción");
    } finally {
      setActuandoId(null);
      await cargar(); // refresca lista y cupo (efecto observable RN-CK)
    }
  }

  async function confirmarCancelacion(motivo: string) {
    if (!cancelandoId) return;
    setBusyCancelar(true);
    try {
      await cancelarEstadia(cancelandoId, motivo);
      toast.success("Estadía cancelada");
      setCancelandoId(null);
      await cargar(); // el cupo se libera al cancelar (RN-ME) — refresco observable
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo cancelar la estadía");
    } finally {
      setBusyCancelar(false);
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
          aria-label="Elegir fecha de la ocupación"
          className="w-40"
          value={fecha}
          onChange={(ev) => { if (ev.target.value) onFecha(ev.target.value); }}
        />
      </div>

      {/* Indicador de cupo del día (RN-GU4): ocupados vs. cupo configurado. */}
      {!loading && !error && cupo ? (
        <div className="flex items-center gap-3" aria-live="polite">
          <span
            className={[
              "rounded-full px-3 py-1 text-sm font-medium",
              cupo.disponible <= 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800",
            ].join(" ")}
          >
            {cupo.ocupados} de {cupo.cupo} lugares ocupados
          </span>
          <span className="text-sm text-muted-foreground">
            {cupo.disponible <= 0
              ? "Sin cupo disponible"
              : `${cupo.disponible} lugar${cupo.disponible === 1 ? "" : "es"} disponible${cupo.disponible === 1 ? "" : "s"}`}
          </span>
        </div>
      ) : null}

      {/* Aviso de estadías vencidas sin acción (RN-CK): salta a la vista. */}
      {!loading && !error && pendientes > 0 ? (
        <div
          className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            {pendientes} estadía{pendientes === 1 ? "" : "s"} pendiente{pendientes === 1 ? "" : "s"} de acción
            {" "}(fecha vencida sin check-in/out)
          </span>
        </div>
      ) : null}

      <TableScrollContainer aria-label="Estadías del día en guardería">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Huésped</TableHead>
              <TableHead className="hidden md:table-cell">Dieta</TableHead>
              <TableHead>Tutor</TableHead>
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
            ) : estadias.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNAS} className="py-10 text-center text-sm text-muted-foreground">
                  No hay huéspedes en la guardería el {formatFechaLarga(fecha)}.
                </TableCell>
              </TableRow>
            ) : (
              estadias.map((e) => {
                const siguiente = transicionSiguiente(e.status);
                const pend = pendienteDeAccion(e, hoy);
                return (
                  <TableRow
                    key={e.id}
                    className={`border-l-4 ${pend ? "border-l-amber-500 bg-amber-50/50" : rowAccent(e.status)}`}
                    aria-label={`Estadía de ${e.petName}, estado ${estadoLabel(e.status)}${pend ? ", pendiente de acción" : ""}`}
                  >
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col">
                        <span className="font-medium">{e.petName}</span>
                        <span className="text-xs text-muted-foreground">{e.petTamano}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal md:table-cell text-sm text-muted-foreground">
                      {e.petDieta ?? SIN_DIETA}
                    </TableCell>
                    <TableCell className="whitespace-normal">{e.clientName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge className={badgeClass(e.status)}>{estadoLabel(e.status)}</Badge>
                        {pend ? (
                          <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100">
                            <AlertTriangle className="size-3" aria-hidden />
                            {PENDIENTE_LABEL[pend]}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {siguiente ? (
                          <Button
                            size="sm"
                            disabled={actuandoId === e.id}
                            onClick={() => void accionar(e)}
                          >
                            {siguiente.label}
                          </Button>
                        ) : null}
                        {puedeModificar(e.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actuandoId === e.id}
                            onClick={() => navigate(`/guarderia/${e.id}/editar`, { state: e })}
                          >
                            Modificar
                          </Button>
                        ) : null}
                        {puedeCancelar(e.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            disabled={actuandoId === e.id}
                            onClick={() => setCancelandoId(e.id)}
                          >
                            Cancelar
                          </Button>
                        ) : null}
                        {!siguiente && esTerminal(e.status) ? (
                          <span className="text-xs text-muted-foreground">—</span>
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

      <CancelarEstadiaAlert
        open={cancelandoId !== null}
        busy={busyCancelar}
        onOpenChange={(open) => { if (!open) setCancelandoId(null); }}
        onConfirm={(motivo) => void confirmarCancelacion(motivo)}
      />
    </div>
  );
}

interface CancelarProps {
  open:         boolean;
  busy:         boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm:    (cancellationReason: string) => void;
}

function CancelarEstadiaAlert({ open, busy, onOpenChange, onConfirm }: CancelarProps) {
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
          <AlertDialogTitle>Cancelar estadía</AlertDialogTitle>
          <AlertDialogDescription>
            Indicá el motivo de la cancelación. Queda registrado en la estadía y el cupo se libera.
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

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
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
