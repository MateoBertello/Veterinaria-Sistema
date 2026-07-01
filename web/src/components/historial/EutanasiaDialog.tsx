import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
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
import { Checkbox } from "../ui/checkbox.tsx";
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
import { registrarEutanasia } from "../../api/historial-clinico.ts";
import { listarDoctores } from "../../api/doctores.ts";
import {
  ApiError,
  ErrorCode,
  type Doctor,
  type EutanasiaResultado,
  type RegistrarEutanasiaInput,
} from "../../types/index.ts";

interface FormValues {
  date:           string;
  professionalId: string;
  description:    string;
  weightKg:       string;
  temperatureC:   string;
  diagnosis:      string;
  notes:          string;
  confirmed:      boolean;
}

const VACIO: FormValues = {
  date: "", professionalId: "", description: "",
  weightKg: "", temperatureC: "", diagnosis: "", notes: "", confirmed: false,
};

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  petId:        string;
  mascotaName:  string;
  onSuccess:    (resultado: EutanasiaResultado) => void;
}

export function EutanasiaDialog({ open, onOpenChange, petId, mascotaName, onSuccess }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);

  const {
    control, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const confirmed = useWatch({ control, name: "confirmed" });

  const [doctores, setDoctores] = useState<Doctor[]>([]);

  useEffect(() => {
    if (!open) return;
    reset({ ...VACIO, date: hoy });
    listarDoctores({ available: true, limit: 100 })
      .then(({ items }) => setDoctores(items))
      .catch(() => setDoctores([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    const input: RegistrarEutanasiaInput = {
      date:                 values.date,
      professionalId:       values.professionalId,
      description:          values.description,
      weightKg:             values.weightKg ? Number(values.weightKg) : null,
      temperatureC:         values.temperatureC ? Number(values.temperatureC) : null,
      diagnosis:            values.diagnosis || null,
      notes:                values.notes || null,
      euthanasiaConfirmed:  values.confirmed,
    };

    try {
      const resultado = await registrarEutanasia(petId, input);
      const dosisMsg = resultado.cancelledDoses > 0
        ? ` Se cancelaron ${resultado.cancelledDoses} dosis de vacunación pendientes.`
        : "";
      toast.success(`Se registró la eutanasia de ${resultado.mascota.name}.${dosisMsg}`);
      onOpenChange(false);
      onSuccess(resultado);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.EUTHANASIA_CONFIRMATION_REQUIRED) {
        toast.error("Debés confirmar explícitamente que querés registrar la eutanasia.");
      } else if (err instanceof ApiError && err.code === ErrorCode.PET_DECEASED) {
        toast.error("Esta mascota ya está marcada como fallecida.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "No se pudo registrar la eutanasia");
      }
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-5" aria-hidden />
            Registrar eutanasia
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Vas a registrar la eutanasia de <strong>{mascotaName}</strong>.
              </p>
              <p className="text-destructive font-medium">
                Esta acción es irreversible (RN-EC12): la mascota pasará a estado
                "Fallecida" y no se podrán agregar más eventos a su historial clínico.
                No existe forma de deshacer este registro.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-2" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="eutanasia-date">Fecha *</Label>
              <Controller
                control={control}
                name="date"
                rules={{ required: "La fecha es requerida" }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input id="eutanasia-date" type="date" max={hoy} aria-invalid={Boolean(errors.date)} {...field} />
                )}
              />
              {errors.date ? (
                <p role="alert" className="text-sm text-destructive">{errors.date.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="eutanasia-professionalId">Profesional *</Label>
              <Controller
                control={control}
                name="professionalId"
                rules={{ required: "El profesional es requerido" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="eutanasia-professionalId" aria-invalid={Boolean(errors.professionalId)}>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {doctores.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.professionalId ? (
                <p role="alert" className="text-sm text-destructive">{errors.professionalId.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="eutanasia-weightKg">Peso (kg)</Label>
              <Controller
                control={control}
                name="weightKg"
                rules={{
                  validate: (v) => {
                    if (!v) return true;
                    const n = Number(v);
                    if (Number.isNaN(n) || n < 0 || n > 200) return "Debe estar entre 0 y 200 kg";
                    return true;
                  },
                }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input id="eutanasia-weightKg" type="number" aria-invalid={Boolean(errors.weightKg)} {...field} />
                )}
              />
              {errors.weightKg ? (
                <p role="alert" className="text-sm text-destructive">{errors.weightKg.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="eutanasia-temperatureC">Temperatura (°C)</Label>
              <Controller
                control={control}
                name="temperatureC"
                rules={{
                  validate: (v) => {
                    if (!v) return true;
                    const n = Number(v);
                    if (Number.isNaN(n) || n < 30 || n > 45) return "Debe estar entre 30 y 45 °C";
                    return true;
                  },
                }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input id="eutanasia-temperatureC" type="number" aria-invalid={Boolean(errors.temperatureC)} {...field} />
                )}
              />
              {errors.temperatureC ? (
                <p role="alert" className="text-sm text-destructive">{errors.temperatureC.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="eutanasia-description">Descripción *</Label>
            <Controller
              control={control}
              name="description"
              rules={{
                required:  "La descripción es requerida",
                maxLength: { value: 2000, message: "Máximo 2000 caracteres" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="eutanasia-description" rows={3} aria-invalid={Boolean(errors.description)} {...field} />
              )}
            />
            {errors.description ? (
              <p role="alert" className="text-sm text-destructive">{errors.description.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="eutanasia-diagnosis">Diagnóstico</Label>
            <Controller
              control={control}
              name="diagnosis"
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="eutanasia-diagnosis" rows={2} aria-invalid={Boolean(errors.diagnosis)} {...field} />
              )}
            />
            {errors.diagnosis ? (
              <p role="alert" className="text-sm text-destructive">{errors.diagnosis.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="eutanasia-notes">Notas</Label>
            <Controller
              control={control}
              name="notes"
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="eutanasia-notes" rows={2} aria-invalid={Boolean(errors.notes)} {...field} />
              )}
            />
            {errors.notes ? (
              <p role="alert" className="text-sm text-destructive">{errors.notes.message}</p>
            ) : null}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Controller
              control={control}
              name="confirmed"
              rules={{ required: true }}
              render={({ field: { value, onChange } }) => (
                <Checkbox id="eutanasia-confirmed" checked={value} onCheckedChange={onChange} className="mt-0.5" />
              )}
            />
            <Label htmlFor="eutanasia-confirmed" className="font-normal">
              Confirmo que deseo registrar la eutanasia de <strong>{mascotaName}</strong> — esta acción es irreversible.
            </Label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!confirmed || isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Confirmar eutanasia
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
