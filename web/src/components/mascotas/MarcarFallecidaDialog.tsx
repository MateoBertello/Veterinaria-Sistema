import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ApiError, type MarcarFallecidaInput, type Mascota } from "../../types/index.ts";

type FormValues = {
  deceasedReason: string;
  deceasedDate:   string;
  deceasedNotes:  string;
};

const VACIO: FormValues = { deceasedReason: "", deceasedDate: "", deceasedNotes: "" };

interface Props {
  mascota:         Mascota | null;
  open:            boolean;
  onOpenChange:    (open: boolean) => void;
  onSuccess:       () => void;
  marcarFallecida: (id: string, input: MarcarFallecidaInput) => Promise<unknown>;
}

export function MarcarFallecidaDialog({ mascota, open, onOpenChange, onSuccess, marcarFallecida }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);

  const {
    control, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (open) reset(VACIO);
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    if (!mascota) return;
    try {
      await marcarFallecida(mascota.id, {
        deceasedReason: values.deceasedReason.trim(),
        deceasedDate:   values.deceasedDate || null,
        deceasedNotes:  values.deceasedNotes.trim() || null,
      });
      toast.success(`${mascota.name} fue registrada como fallecida`);
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo registrar el fallecimiento");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Registrar fallecimiento</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Vas a marcar a <strong>{mascota?.name}</strong> como fallecida.
                Esta acción no se puede revertir (RN-MF5).
              </p>
              <p className="text-destructive font-medium">
                Una vez registrada como fallecida, no se podrán agregar nuevos
                registros a su historial clínico ni asignarle turnos o estadías.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-2" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="deceasedReason">Motivo del fallecimiento *</Label>
            <Controller
              control={control}
              name="deceasedReason"
              rules={{
                required:  "El motivo es requerido",
                maxLength: { value: 500, message: "Máximo 500 caracteres" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea
                  id="deceasedReason"
                  rows={2}
                  aria-invalid={Boolean(errors.deceasedReason)}
                  {...field}
                />
              )}
            />
            {errors.deceasedReason ? (
              <p role="alert" className="text-sm text-destructive">{errors.deceasedReason.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deceasedDate">Fecha de fallecimiento</Label>
            <Controller
              control={control}
              name="deceasedDate"
              render={({ field: { ref: _ref, ...field } }) => (
                <Input id="deceasedDate" type="date" max={hoy} {...field} />
              )}
            />
            <p className="text-xs text-muted-foreground">Opcional — si no se indica, se usa la fecha de hoy.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deceasedNotes">Notas adicionales</Label>
            <Controller
              control={control}
              name="deceasedNotes"
              rules={{ maxLength: { value: 1000, message: "Máximo 1000 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="deceasedNotes" rows={2} placeholder="Opcional" {...field} />
              )}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              Confirmar fallecimiento
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
