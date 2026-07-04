import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type RegisterOptions,
} from "react-hook-form";
import { toast } from "sonner";
import { ArrowLeft, CalendarPlus, Lock } from "lucide-react";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { ClienteCombobox } from "../components/historial/ClienteCombobox.tsx";
import { DoctorCombobox } from "../components/horarios/DoctorCombobox.tsx";
import { ServicioCombobox } from "../components/turnos/ServicioCombobox.tsx";
import { SlotGrid } from "../components/turnos/SlotGrid.tsx";
import { listarServicios } from "../api/servicios.ts";
import { listarMascotas } from "../api/mascotas.ts";
import { crearTurno, obtenerSlotsDisponibles } from "../api/turnos.ts";
import {
  ApiError,
  ErrorCode,
  type Cliente,
  type Doctor,
  type Mascota,
  type Servicio,
  type SlotDisponible,
} from "../types/index.ts";

interface FormValues {
  servicioId: string;
  clientId:   string;
  petId:      string;
  doctorId:   string;
  date:       string;
  startTime:  string;
  reason:     string;
  notes:      string;
}

const VACIO: FormValues = {
  servicioId: "",
  clientId: "",
  petId: "",
  doctorId: "",
  date: "",
  startTime: "",
  reason: "",
  notes: "",
};

const FORM_FIELDS = new Set<keyof FormValues>([
  "servicioId", "clientId", "petId", "doctorId", "date", "startTime", "reason", "notes",
]);

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fieldFromDetail(d: unknown): string | undefined {
  const o = d as Record<string, unknown>;
  if (typeof o.field === "string") return o.field;
  if (Array.isArray(o.path) && typeof o.path[0] === "string") return o.path[0] as string;
  return undefined;
}

export function AgendarTurnoPage() {
  const navigate = useNavigate();

  const [serviciosCheck, setServiciosCheck] = useState<"cargando" | "vacio" | "ok">("cargando");

  const [servicio, setServicio] = useState<Servicio | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotDisponible | null>(null);

  const [mascotas, setMascotas] = useState<Mascota[]>([]);
  const [loadingMascotas, setLoadingMascotas] = useState(false);
  const [errorMascotas, setErrorMascotas] = useState<string | null>(null);

  const [slots, setSlots] = useState<SlotDisponible[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const fecha = watch("date");

  useEffect(() => {
    listarServicios({ activo: true, limit: 1 })
      .then(({ meta }) => setServiciosCheck(meta.total === 0 ? "vacio" : "ok"))
      .catch(() => setServiciosCheck("ok"));
  }, []);

  useEffect(() => {
    if (!cliente) {
      setMascotas([]);
      return;
    }
    setLoadingMascotas(true);
    setErrorMascotas(null);
    listarMascotas({ clientId: cliente.id, estado: "Activa", limit: 100 })
      .then(({ items }) => setMascotas(items))
      .catch((err) => {
        setErrorMascotas(err instanceof ApiError ? err.message : "No se pudieron cargar las mascotas");
      })
      .finally(() => setLoadingMascotas(false));
  }, [cliente]);

  useEffect(() => {
    if (!servicio?.requiereProfesional || !doctor || !fecha) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    obtenerSlotsDisponibles({ doctorId: doctor.id, date: fecha, servicioId: servicio.id })
      .then(setSlots)
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [servicio, doctor, fecha]);

  function limpiarHorario() {
    setSelectedSlot(null);
    setValue("startTime", "");
  }

  async function onSubmit(values: FormValues) {
    try {
      const turno = await crearTurno({
        servicioId: values.servicioId,
        clientId: values.clientId,
        petId: values.petId,
        doctorId: values.doctorId || undefined,
        date: values.date,
        startTime: values.startTime,
        reason: values.reason.trim(),
        notes: values.notes.trim() || undefined,
      });
      toast.success(`Turno agendado: ${turno.date} ${turno.startTime}–${turno.endTime}`);
      navigate("/turnos");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === ErrorCode.SERVICE_NOT_FOUND) {
          setError("servicioId", { type: "server", message: err.message });
          return;
        }
        if (err.code === ErrorCode.PAST_DATE) {
          setError("date", { type: "server", message: err.message });
          return;
        }
        if (err.code === ErrorCode.MASCOTA_NOT_FOUND || err.code === ErrorCode.PET_DECEASED) {
          setError("petId", { type: "server", message: err.message });
          return;
        }
        if (err.code === ErrorCode.TURNO_SOLAPADO || err.code === ErrorCode.DUPLICATE_APPOINTMENT) {
          setError("startTime", { type: "server", message: err.message });
          return;
        }
        if (err.code === ErrorCode.VALIDATION_ERROR && err.details.length > 0) {
          let mapped = false;
          for (const d of err.details) {
            const field = fieldFromDetail(d);
            if (field && FORM_FIELDS.has(field as keyof FormValues)) {
              const msg = (d as Record<string, unknown>).message;
              setError(field as keyof FormValues, {
                type: "server",
                message: typeof msg === "string" ? msg : err.message,
              });
              mapped = true;
            }
          }
          if (mapped) return;
        }
      }
      toast.error(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/turnos")}>
        <ArrowLeft className="size-4" aria-hidden />
        Volver a la agenda
      </Button>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <CalendarPlus className="size-6" aria-hidden />
          Agendar Turno
        </h1>
        <p className="text-sm text-muted-foreground">
          Los campos marcados con * son obligatorios.
        </p>
      </header>

      {serviciosCheck === "cargando" ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : serviciosCheck === "vacio" ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no hay servicios activos configurados.
            </p>
            <Link to="/servicios" className="text-sm font-medium text-orange-700 underline underline-offset-2">
              Configurar servicios
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
              <div className="space-y-1.5">
                <Label>Servicio *</Label>
                <Controller
                  control={control}
                  name="servicioId"
                  rules={{ required: "Elegí un servicio" }}
                  render={({ field }) => (
                    <ServicioCombobox
                      value={servicio}
                      onChange={(s) => {
                        setServicio(s);
                        field.onChange(s.id);
                        if (!s.requiereProfesional) {
                          setDoctor(null);
                          setValue("doctorId", "");
                        }
                        limpiarHorario();
                      }}
                    />
                  )}
                />
                <FieldError message={errors.servicioId?.message} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Cliente *</Label>
                  <Controller
                    control={control}
                    name="clientId"
                    rules={{ required: "Elegí un cliente" }}
                    render={({ field }) => (
                      <ClienteCombobox
                        value={cliente}
                        onChange={(c) => {
                          setCliente(c);
                          field.onChange(c.id);
                          setValue("petId", "");
                        }}
                      />
                    )}
                  />
                  <FieldError message={errors.clientId?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label>Mascota *</Label>
                  {!cliente ? (
                    <p className="text-sm text-muted-foreground">Elegí primero un cliente.</p>
                  ) : loadingMascotas ? (
                    <Skeleton className="h-9 w-full" />
                  ) : errorMascotas ? (
                    <p className="text-sm text-destructive">{errorMascotas}</p>
                  ) : mascotas.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Este cliente no tiene mascotas activas.</p>
                  ) : (
                    <Controller
                      control={control}
                      name="petId"
                      rules={{ required: "Elegí una mascota" }}
                      render={({ field }) => (
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <SelectTrigger aria-label="Mascota">
                            <SelectValue placeholder="Seleccionar mascota..." />
                          </SelectTrigger>
                          <SelectContent>
                            {mascotas.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                  <FieldError message={errors.petId?.message} />
                </div>
              </div>

              {servicio?.requiereProfesional ? (
                <div className="space-y-1.5">
                  <Label>Profesional *</Label>
                  <Controller
                    control={control}
                    name="doctorId"
                    rules={{
                      validate: (v) =>
                        servicio?.requiereProfesional && !v
                          ? "Este servicio requiere seleccionar un profesional"
                          : true,
                    }}
                    render={({ field }) => (
                      <DoctorCombobox
                        value={doctor}
                        onChange={(d) => {
                          setDoctor(d);
                          field.onChange(d.id);
                          limpiarHorario();
                        }}
                      />
                    )}
                  />
                  <p className="text-xs text-muted-foreground">Requerido por este servicio.</p>
                  <FieldError message={errors.doctorId?.message} />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="date">Fecha *</Label>
                <Controller
                  control={control}
                  name="date"
                  rules={{
                    required: "La fecha es requerida",
                    validate: (v) => (v < hoyISO() ? "No se puede agendar en una fecha pasada" : true),
                  }}
                  render={({ field: { ref: _ref, ...field } }) => (
                    <Input
                      id="date"
                      type="date"
                      min={hoyISO()}
                      aria-invalid={Boolean(errors.date)}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        limpiarHorario();
                      }}
                    />
                  )}
                />
                <FieldError message={errors.date?.message} />
              </div>

              <div className="space-y-1.5">
                <Label>Hora inicio *</Label>
                {servicio?.requiereProfesional ? (
                  !doctor || !fecha ? (
                    <p className="text-sm text-muted-foreground">
                      Elegí profesional y fecha para ver los horarios disponibles.
                    </p>
                  ) : (
                    <Controller
                      control={control}
                      name="startTime"
                      rules={{ required: "Elegí un horario de inicio" }}
                      render={({ field }) => (
                        <SlotGrid
                          slots={slots}
                          value={field.value}
                          loading={loadingSlots}
                          onChange={(slot) => {
                            field.onChange(slot.startTime);
                            setSelectedSlot(slot);
                          }}
                        />
                      )}
                    />
                  )
                ) : (
                  <Controller
                    control={control}
                    name="startTime"
                    rules={{ required: "Elegí un horario de inicio" }}
                    render={({ field: { ref: _ref, ...field } }) => (
                      <Input
                        type="time"
                        aria-label="Hora inicio"
                        aria-invalid={Boolean(errors.startTime)}
                        className="w-40"
                        {...field}
                      />
                    )}
                  />
                )}
                <FieldError message={errors.startTime?.message} />
              </div>

              {servicio?.requiereProfesional && selectedSlot ? (
                <div className="space-y-1.5">
                  <Label htmlFor="endTime-display" className="flex items-center gap-1">
                    Hora fin <Lock className="size-3" aria-hidden />
                  </Label>
                  <Input
                    id="endTime-display"
                    value={selectedSlot.endTime}
                    disabled
                    readOnly
                    className="w-40"
                  />
                  <p className="text-xs text-muted-foreground">
                    Definida por la duración del servicio.
                  </p>
                </div>
              ) : null}

              <TextField
                control={control}
                errors={errors}
                name="reason"
                label="Motivo *"
                rules={{
                  required: "El motivo es requerido",
                  maxLength: { value: 200, message: "Máximo 200 caracteres" },
                }}
              />

              <TextField
                control={control}
                errors={errors}
                name="notes"
                label="Notas"
                multiline
                rules={{ maxLength: { value: 500, message: "Máximo 500 caracteres" } }}
              />

              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                  Agendar y Confirmar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Campo controlado vía RHF Controller. El kit Input/Textarea no es forwardRef,
 * por eso no se usa `register` (su ref se perdería): el control es por value/onChange.
 */
function TextField({
  control,
  errors,
  name,
  label,
  rules,
  type,
  multiline,
}: {
  control: Control<FormValues>;
  errors: FieldErrors<FormValues>;
  name: keyof FormValues;
  label: string;
  rules?: Omit<
    RegisterOptions<FormValues, keyof FormValues>,
    "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
  >;
  type?: string;
  multiline?: boolean;
}) {
  const error = errors[name]?.message;
  const describedBy = error ? `${name}-error` : undefined;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Controller
        control={control}
        name={name}
        rules={rules}
        render={({ field: { ref: _ref, ...field } }) =>
          multiline ? (
            <Textarea
              id={name}
              rows={3}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              {...field}
            />
          ) : (
            <Input
              id={name}
              type={type}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              {...field}
            />
          )
        }
      />
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
