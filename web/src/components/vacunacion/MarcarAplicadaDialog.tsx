import { useEffect, useState } from "react";
import { Controller, useForm, type Control, type FieldErrors, type RegisterOptions } from "react-hook-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { listarDoctores } from "../../api/doctores.ts";
import { marcarDosisAplicada } from "../../api/vacunacion.ts";
import { ApiError, type Doctor, type DosisVacunacion } from "../../types/index.ts";

interface FormValues {
  professionalId: string;
  date:           string;
  weightKg:       string;
  temperatureC:   string;
  notes:          string;
}

const VACIO: FormValues = { professionalId: "", date: "", weightKg: "", temperatureC: "", notes: "" };

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  dosis:        DosisVacunacion | null;
  onSaved:      (dosis: DosisVacunacion) => void;
}

export function MarcarAplicadaDialog({ open, onOpenChange, dosis, onSaved }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const [doctores, setDoctores] = useState<Doctor[]>([]);

  useEffect(() => {
    if (!open) return;
    reset(VACIO);
    // professional=true: solo doctores con usuario vinculado, los únicos
    // válidos como professionalId del evento clínico creado (DT-2/DT-3).
    listarDoctores({ available: true, professional: true, limit: 100 })
      .then(({ items }) => setDoctores(items))
      .catch(() => setDoctores([]));
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    if (!dosis) return;
    try {
      const actualizada = await marcarDosisAplicada(dosis.id, {
        professionalId: values.professionalId,
        date:           values.date || undefined,
        weightKg:       values.weightKg ? Number(values.weightKg) : undefined,
        temperatureC:   values.temperatureC ? Number(values.temperatureC) : undefined,
        notes:          values.notes || undefined,
      });
      toast.success("Dosis aplicada — se registró el evento clínico");
      onSaved(actualizada);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar dosis aplicada</DialogTitle>
          <DialogDescription>
            {dosis?.tipoVacunaNombre ?? "Dosis"} — se registrará un evento clínico de Vacunación.
            Los campos marcados con * son obligatorios.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="professionalId">Profesional *</Label>
            <Controller
              control={control}
              name="professionalId"
              rules={{ required: "El profesional es requerido" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="professionalId" aria-invalid={Boolean(errors.professionalId)}>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {doctores
                      .filter((d) => d.userId)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.userId!}>{d.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.professionalId ? (
              <p role="alert" className="text-sm text-destructive">{errors.professionalId.message}</p>
            ) : null}
          </div>

          <TextField control={control} errors={errors} name="date" label="Fecha" type="date" />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={control} errors={errors} name="weightKg" label="Peso (kg)" type="number"
              rules={{
                validate: (v) => {
                  if (!v) return true;
                  const n = Number(v);
                  if (Number.isNaN(n) || n < 0 || n > 200) return "Debe estar entre 0 y 200 kg";
                  return true;
                },
              }}
            />
            <TextField
              control={control} errors={errors} name="temperatureC" label="Temperatura (°C)" type="number"
              rules={{
                validate: (v) => {
                  if (!v) return true;
                  const n = Number(v);
                  if (Number.isNaN(n) || n < 30 || n > 45) return "Debe estar entre 30 y 45 °C";
                  return true;
                },
              }}
            />
          </div>

          <TextField
            control={control} errors={errors} name="notes" label="Notas" multiline
            rules={{ maxLength: { value: 500, message: "Máximo 500 caracteres" } }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Confirmar aplicación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TextFieldName = Exclude<keyof FormValues, "professionalId">;

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
  name: TextFieldName;
  label: string;
  rules?: Omit<
    RegisterOptions<FormValues, TextFieldName>,
    "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
  >;
  type?: string;
  multiline?: boolean;
}) {
  const error = errors[name]?.message as string | undefined;
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
