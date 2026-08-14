import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Switch } from "../ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { NumberStepper } from "../common/NumberStepper.tsx";
import {
  ApiError,
  ErrorCode,
  type Servicio,
  type ServicioInput,
  type TipoServicio,
} from "../../types/index.ts";

type FormValues = ServicioInput;

const TIPOS: { value: TipoServicio; label: string }[] = [
  { value: "clinica", label: "Clínica" },
  { value: "peluqueria", label: "Peluquería" },
  { value: "guarderia", label: "Guardería" },
  { value: "cirugia", label: "Cirugía" },
  { value: "otro", label: "Otro" },
];

const VACIO: FormValues = {
  nombre: "",
  tipo: "clinica",
  duracionMinutos: 30,
  requiereProfesional: false,
  descripcion: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Servicio a editar; si es undefined/null, es alta. */
  servicio?: Servicio | null;
  onSaved: (servicio: Servicio) => void;
  crear: (input: ServicioInput) => Promise<Servicio>;
  editar: (id: string, input: ServicioInput) => Promise<Servicio>;
}

export function ServicioFormSheet({ open, onOpenChange, servicio, onSaved, crear, editar }: Props) {
  const esEdicion = Boolean(servicio);

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
      servicio
        ? {
            nombre: servicio.nombre,
            tipo: servicio.tipo,
            duracionMinutos: servicio.duracionMinutos,
            requiereProfesional: servicio.requiereProfesional,
            descripcion: servicio.descripcion ?? "",
          }
        : VACIO,
    );
  }, [open, servicio, reset]);

  async function onSubmit(values: FormValues) {
    const input: ServicioInput = {
      nombre: values.nombre.trim(),
      tipo: values.tipo,
      duracionMinutos: values.duracionMinutos,
      requiereProfesional: values.requiereProfesional,
      descripcion: values.descripcion?.trim() || undefined,
    };

    try {
      const guardado = esEdicion
        ? await editar(servicio!.id, input)
        : await crear(input);
      toast.success(esEdicion ? "Servicio actualizado" : "Servicio creado");
      onSaved(guardado);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.SERVICE_IN_USE) {
        // RN-SV2: nombre duplicado entre servicios activos del tenant.
        setError("nombre", { type: "server", message: err.message });
        return;
      }
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  const errorNombre = errors.nombre?.message;
  const errorDuracion = errors.duracionMinutos?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar servicio" : "Nuevo servicio"}</SheetTitle>
          <SheetDescription>
            Los campos marcados con * son obligatorios.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4 px-4"
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="nombre">Nombre *</Label>
            <Controller
              control={control}
              name="nombre"
              rules={{
                required: "El nombre es requerido",
                minLength: { value: 3, message: "Mínimo 3 caracteres" },
                maxLength: { value: 80, message: "Máximo 80 caracteres" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="nombre"
                  aria-invalid={Boolean(errorNombre)}
                  aria-describedby={errorNombre ? "nombre-error" : undefined}
                  {...field}
                />
              )}
            />
            {errorNombre ? (
              <p id="nombre-error" role="alert" className="text-sm text-destructive">
                {errorNombre}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tipo">Tipo *</Label>
            <Controller
              control={control}
              name="tipo"
              rules={{ required: true }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="tipo" aria-invalid={Boolean(errors.tipo)}>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="duracionMinutos">Duración (minutos) *</Label>
            <Controller
              control={control}
              name="duracionMinutos"
              rules={{
                required: true,
                min: { value: 5, message: "Mínimo 5 minutos" },
                max: { value: 480, message: "Máximo 480 minutos" },
                validate: (v) => v % 5 === 0 || "Debe ser múltiplo de 5",
              }}
              render={({ field }) => (
                <NumberStepper
                  id="duracionMinutos"
                  value={field.value}
                  onChange={field.onChange}
                  min={5}
                  max={480}
                  step={5}
                  aria-invalid={Boolean(errorDuracion)}
                  aria-describedby={errorDuracion ? "duracionMinutos-error" : undefined}
                />
              )}
            />
            <p className="text-sm text-muted-foreground">
              Define la duración del turno en la agenda.
            </p>
            {errorDuracion ? (
              <p id="duracionMinutos-error" role="alert" className="text-sm text-destructive">
                {errorDuracion}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="requiereProfesional" className="flex-1">
              Requiere profesional
            </Label>
            <Controller
              control={control}
              name="requiereProfesional"
              render={({ field }) => (
                <Switch
                  id="requiereProfesional"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="descripcion">Descripción</Label>
            <Controller
              control={control}
              name="descripcion"
              rules={{ maxLength: { value: 300, message: "Máximo 300 caracteres" } }}
              render={({ field: { ref: _ref, value, ...field } }) => (
                <Textarea
                  id="descripcion"
                  rows={3}
                  value={value ?? ""}
                  aria-invalid={Boolean(errors.descripcion)}
                  {...field}
                />
              )}
            />
            {errors.descripcion ? (
              <p role="alert" className="text-sm text-destructive">{errors.descripcion.message}</p>
            ) : null}
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {esEdicion ? "Guardar cambios" : "Crear servicio"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
