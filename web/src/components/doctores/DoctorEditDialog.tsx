import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { Switch } from "../ui/switch.tsx";
import { ApiError, type Doctor, type DoctorInput } from "../../types/index.ts";

type FormValues = {
  specialty:     string;
  licenseNumber: string;
  available:     boolean;
};

const VACIO: FormValues = { specialty: "", licenseNumber: "", available: true };

interface Props {
  doctor: Doctor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editar: (id: string, input: DoctorInput) => Promise<Doctor>;
  onSaved: (doctor: Doctor) => void;
}

/**
 * Edita specialty/licenseNumber/available de un Doctor ya existente. No expone
 * 'name': se deriva de usuario.fullName (RN-SEC5) para no divergir de la fuente
 * de verdad. La baja es available=false; no hay delete físico de doctores.
 */
export function DoctorEditDialog({ doctor, open, onOpenChange, editar, onSaved }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (!open) return;
    reset(
      doctor
        ? {
            specialty: doctor.specialty ?? "",
            licenseNumber: doctor.licenseNumber ?? "",
            available: doctor.available,
          }
        : VACIO,
    );
  }, [open, doctor, reset]);

  async function onSubmit(values: FormValues) {
    if (!doctor) return;
    const input: DoctorInput = {
      specialty: values.specialty.trim() || null,
      licenseNumber: values.licenseNumber.trim() || null,
      available: values.available,
    };

    try {
      const guardado = await editar(doctor.id, input);
      toast.success("Doctor actualizado");
      onSaved(guardado);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar doctor</DialogTitle>
          <DialogDescription>
            {doctor ? `Datos profesionales de ${doctor.name}.` : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="specialty">Especialidad</Label>
            <Controller
              control={control}
              name="specialty"
              rules={{ maxLength: { value: 120, message: "Máximo 120 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="specialty"
                  aria-invalid={Boolean(errors.specialty)}
                  aria-describedby={errors.specialty ? "specialty-error" : undefined}
                  {...field}
                />
              )}
            />
            {errors.specialty ? (
              <p id="specialty-error" role="alert" className="text-sm text-destructive">
                {errors.specialty.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="licenseNumber">Matrícula</Label>
            <Controller
              control={control}
              name="licenseNumber"
              rules={{ maxLength: { value: 60, message: "Máximo 60 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="licenseNumber"
                  aria-invalid={Boolean(errors.licenseNumber)}
                  aria-describedby={errors.licenseNumber ? "licenseNumber-error" : undefined}
                  {...field}
                />
              )}
            />
            {errors.licenseNumber ? (
              <p id="licenseNumber-error" role="alert" className="text-sm text-destructive">
                {errors.licenseNumber.message}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="available" className="flex-1">
              Disponible
            </Label>
            <Controller
              control={control}
              name="available"
              render={({ field }) => (
                <Switch
                  id="available"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Guardar cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
