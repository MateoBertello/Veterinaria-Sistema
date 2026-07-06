import { useEffect, useState } from "react";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type RegisterOptions,
} from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, BedDouble, Ruler, Utensils } from "lucide-react";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Badge } from "../components/ui/badge.tsx";
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
import { CupoDias } from "../components/guarderia/CupoDias.tsx";
import { hoyISO } from "../components/turnos/fechas.ts";
import { listarMascotas } from "../api/mascotas.ts";
import { crearEstadia } from "../api/estadias.ts";
import { ApiError, ErrorCode, type Cliente, type Mascota } from "../types/index.ts";

const DIETA_FALLBACK = "Sin indicaciones de dieta";

interface FormValues {
  clientId:     string;
  petId:        string;
  checkInDate:  string;
  checkOutDate: string;
  reason:       string;
  notes:        string;
}

const VACIO: FormValues = {
  clientId: "",
  petId: "",
  checkInDate: "",
  checkOutDate: "",
  reason: "",
  notes: "",
};

const FORM_FIELDS = new Set<keyof FormValues>([
  "clientId", "petId", "checkInDate", "checkOutDate", "reason", "notes",
]);

function fieldFromDetail(d: unknown): string | undefined {
  const o = d as Record<string, unknown>;
  if (typeof o.field === "string") return o.field;
  if (Array.isArray(o.path) && typeof o.path[0] === "string") return o.path[0] as string;
  return undefined;
}

export function RegistrarEstadiaPage() {
  const navigate = useNavigate();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [mascotaSeleccionada, setMascotaSeleccionada] = useState<Mascota | null>(null);

  const [mascotas, setMascotas] = useState<Mascota[]>([]);
  const [loadingMascotas, setLoadingMascotas] = useState(false);
  const [errorMascotas, setErrorMascotas] = useState<string | null>(null);

  const [diasAgotados, setDiasAgotados] = useState<string[]>([]);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const checkInDate = watch("checkInDate");
  const checkOutDate = watch("checkOutDate");

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

  async function onSubmit(values: FormValues) {
    try {
      const estadia = await crearEstadia({
        clientId: values.clientId,
        petId: values.petId,
        checkInDate: values.checkInDate,
        checkOutDate: values.checkOutDate,
        reason: values.reason.trim(),
        notes: values.notes.trim() || undefined,
      });
      toast.success(`Estadía registrada: ${estadia.petName}, ${estadia.checkInDate} a ${estadia.checkOutDate}`);
      reset(VACIO);
      setCliente(null);
      setMascotaSeleccionada(null);
      setMascotas([]);
      setDiasAgotados([]);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === ErrorCode.CUPO_GUARDERIA_AGOTADO) {
          setDiasAgotados(err.details as string[]);
          toast.error(err.message);
          return;
        }
        if (err.code === ErrorCode.STAY_OVERLAP) {
          toast.error(err.message);
          return;
        }
        if (err.code === ErrorCode.MASCOTA_NOT_FOUND || err.code === ErrorCode.PET_DECEASED) {
          setError("petId", { type: "server", message: err.message });
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
      <Button variant="ghost" size="sm" onClick={() => navigate("/guarderia")}>
        <ArrowLeft className="size-4" aria-hidden />
        Volver a Ocupación de guardería
      </Button>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <BedDouble className="size-6" aria-hidden />
          Registrar Estadía
        </h1>
        <p className="text-sm text-muted-foreground">
          Los campos marcados con * son obligatorios.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
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
                        setMascotaSeleccionada(null);
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
                      <Select
                        value={field.value || undefined}
                        onValueChange={(value) => {
                          field.onChange(value);
                          setMascotaSeleccionada(mascotas.find((m) => m.id === value) ?? null);
                        }}
                      >
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

            {mascotaSeleccionada ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-gradient-to-r from-orange-50 to-white p-4">
                <p className="text-base font-medium">{mascotaSeleccionada.name}</p>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    <Ruler className="size-3" aria-hidden />
                    {mascotaSeleccionada.tamano}
                  </Badge>
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                    <Utensils className="size-3" aria-hidden />
                    {mascotaSeleccionada.alimentoDieta ?? DIETA_FALLBACK}
                  </Badge>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="checkInDate">Check-in *</Label>
                <Controller
                  control={control}
                  name="checkInDate"
                  rules={{
                    required: "La fecha de check-in es requerida",
                    validate: (v) => (v < hoyISO() ? "No se puede registrar una estadía en una fecha pasada" : true),
                  }}
                  render={({ field: { ref: _ref, ...field } }) => (
                    <Input
                      id="checkInDate"
                      type="date"
                      min={hoyISO()}
                      aria-invalid={Boolean(errors.checkInDate)}
                      {...field}
                    />
                  )}
                />
                <FieldError message={errors.checkInDate?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="checkOutDate">Check-out *</Label>
                <Controller
                  control={control}
                  name="checkOutDate"
                  rules={{
                    required: "La fecha de check-out es requerida",
                    validate: (v) =>
                      v < watch("checkInDate") ? "El check-out no puede ser anterior al check-in" : true,
                  }}
                  render={({ field: { ref: _ref, ...field } }) => (
                    <Input
                      id="checkOutDate"
                      type="date"
                      min={checkInDate || hoyISO()}
                      aria-invalid={Boolean(errors.checkOutDate)}
                      {...field}
                    />
                  )}
                />
                <FieldError message={errors.checkOutDate?.message} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Disponibilidad de cupo</Label>
              <CupoDias
                checkInDate={checkInDate}
                checkOutDate={checkOutDate}
                diasAgotadosForzados={diasAgotados}
              />
            </div>

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
                Registrar Estadía
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
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
