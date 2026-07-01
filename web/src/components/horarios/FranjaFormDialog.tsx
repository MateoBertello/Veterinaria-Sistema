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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { ApiError, ErrorCode, type Franja, type FranjaInput } from "../../types/index.ts";

type FormValues = {
  dayOfWeek: string;
  startTime: string;
  endTime:   string;
  active:    boolean;
};

const DIAS = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Lunes" },
  { value: "2", label: "Martes" },
  { value: "3", label: "Miércoles" },
  { value: "4", label: "Jueves" },
  { value: "5", label: "Viernes" },
  { value: "6", label: "Sábado" },
];

const VACIO: FormValues = { dayOfWeek: "1", startTime: "", endTime: "", active: true };

interface Props {
  doctorId: string;
  /** Franja a editar; null/undefined = alta. */
  franja?: Franja | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crearFranja: (doctorId: string, input: FranjaInput) => Promise<Franja>;
  eliminarFranja: (horarioId: string) => Promise<{ deleted: true }>;
  onSaved: (franja: Franja) => void;
}

/**
 * El backend de horarios no tiene edición in-place (solo POST/PATCH active/DELETE).
 * "Editar" se resuelve como POST de la franja nueva PRIMERO; solo si ese POST
 * resuelve 2xx se elimina la franja vieja. Si el POST falla (INVALID_RANGE,
 * SCHEDULE_OVERLAP), la franja original no se toca. Si el POST tiene éxito pero
 * el DELETE posterior falla, se avisa con un toast explícito en vez de fallar en
 * silencio — la franja nueva ya quedó creada.
 */
export function FranjaFormDialog({
  doctorId,
  franja,
  open,
  onOpenChange,
  crearFranja,
  eliminarFranja,
  onSaved,
}: Props) {
  const esEdicion = Boolean(franja);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (!open) return;
    reset(
      franja
        ? {
            dayOfWeek: String(franja.dayOfWeek),
            startTime: franja.startTime,
            endTime: franja.endTime,
            active: franja.active,
          }
        : VACIO,
    );
  }, [open, franja, reset]);

  async function onSubmit(values: FormValues) {
    const input: FranjaInput = {
      dayOfWeek: Number(values.dayOfWeek),
      startTime: values.startTime,
      endTime: values.endTime,
      active: values.active,
    };

    let nueva: Franja;
    try {
      nueva = await crearFranja(doctorId, input);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.INVALID_RANGE) {
        setError("endTime", { type: "server", message: err.message });
        return;
      }
      if (err instanceof ApiError && err.code === ErrorCode.SCHEDULE_OVERLAP) {
        setError("startTime", { type: "server", message: err.message });
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
      return;
    }

    if (esEdicion && franja) {
      try {
        await eliminarFranja(franja.id);
      } catch {
        toast.error(
          "La franja nueva se creó, pero la anterior no se pudo eliminar. Revisá el listado.",
        );
        onSaved(nueva);
        onOpenChange(false);
        return;
      }
    }

    toast.success(esEdicion ? "Franja actualizada" : "Franja agregada");
    onSaved(nueva);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar franja" : "Agregar franja"}</DialogTitle>
          <DialogDescription>
            Definí el día y el rango horario en que el profesional atiende.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="dayOfWeek">Día *</Label>
            <Controller
              control={control}
              name="dayOfWeek"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="dayOfWeek">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {DIAS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="startTime">Hora inicio *</Label>
              <Controller
                control={control}
                name="startTime"
                rules={{ required: "Requerido" }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input
                    id="startTime"
                    type="time"
                    aria-invalid={Boolean(errors.startTime)}
                    aria-describedby={errors.startTime ? "startTime-error" : undefined}
                    {...field}
                  />
                )}
              />
              {errors.startTime ? (
                <p id="startTime-error" role="alert" className="text-sm text-destructive">
                  {errors.startTime.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="endTime">Hora fin *</Label>
              <Controller
                control={control}
                name="endTime"
                rules={{ required: "Requerido" }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input
                    id="endTime"
                    type="time"
                    aria-invalid={Boolean(errors.endTime)}
                    aria-describedby={errors.endTime ? "endTime-error" : undefined}
                    {...field}
                  />
                )}
              />
              {errors.endTime ? (
                <p id="endTime-error" role="alert" className="text-sm text-destructive">
                  {errors.endTime.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="active" className="flex-1">
              Activa
            </Label>
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {esEdicion ? "Guardar cambios" : "Agregar franja"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
