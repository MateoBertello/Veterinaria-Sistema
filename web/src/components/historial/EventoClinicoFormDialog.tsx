import { useEffect, useState } from "react";
import { Controller, useForm, type Control, type FieldErrors, type RegisterOptions } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
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
import { crearEvento, subirAdjunto } from "../../api/historial-clinico.ts";
import { listarDoctores } from "../../api/doctores.ts";
import {
  ApiError,
  type CrearEventoClinicoInput,
  type Doctor,
  type EventoCreado,
  type TipoEventoClinico,
} from "../../types/index.ts";

// RN-EC1: excluye "Eutanasia" a propósito — tiene su flujo dedicado.
const TIPOS_EVENTO: TipoEventoClinico[] = [
  "Consulta", "Vacunación", "Cirugía", "Análisis", "Radiografía", "Ecografía",
  "Desparasitación", "Control", "Emergencia", "Internación", "Otro",
];

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FormValues {
  date:               string;
  eventType:          TipoEventoClinico | "";
  professionalId:     string;
  description:        string;
  weightKg:           string;
  temperatureC:       string;
  diagnosis:          string;
  treatment:          string;
  medication:         string;
  notes:              string;
  sendEmailToClient:  boolean;
}

const VACIO: FormValues = {
  date: "", eventType: "", professionalId: "", description: "",
  weightKg: "", temperatureC: "", diagnosis: "", treatment: "", medication: "",
  notes: "", sendEmailToClient: false,
};

interface AdjuntoEnCurso {
  file:   File;
  status: "pendiente" | "subiendo" | "ok" | "error";
  error?: string;
}

interface Props {
  open:        boolean;
  onOpenChange: (open: boolean) => void;
  petId:        string;
  onSaved:      (evento: EventoCreado) => void;
}

export function EventoClinicoFormDialog({ open, onOpenChange, petId, onSaved }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [archivos, setArchivos] = useState<AdjuntoEnCurso[]>([]);
  const [archivosError, setArchivosError] = useState("");
  const [eventoCreado, setEventoCreado] = useState<EventoCreado | null>(null);

  useEffect(() => {
    if (!open) return;
    reset(VACIO);
    setArchivos([]);
    setArchivosError("");
    setEventoCreado(null);
    // professional=true: el backend devuelve solo doctores con usuario
    // vinculado, los únicos válidos como professional_id (DT-2/DT-3).
    listarDoctores({ available: true, professional: true, limit: 100 })
      .then(({ items }) => setDoctores(items))
      .catch(() => setDoctores([]));
  }, [open, reset]);

  function alSeleccionarArchivos(fileList: FileList | null) {
    setArchivosError("");
    if (!fileList) return;
    const nuevos: AdjuntoEnCurso[] = [];
    for (const file of Array.from(fileList)) {
      if (!ALLOWED_MIME.includes(file.type)) {
        setArchivosError(`"${file.name}": tipo de archivo no permitido (solo JPG, PNG, GIF o PDF)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setArchivosError(`"${file.name}": supera el tamaño máximo de 10 MB`);
        continue;
      }
      nuevos.push({ file, status: "pendiente" });
    }
    setArchivos((prev) => [...prev, ...nuevos]);
  }

  function quitarArchivo(index: number) {
    setArchivos((prev) => prev.filter((_, i) => i !== index));
  }

  async function subirArchivo(eventoId: string, index: number) {
    setArchivos((prev) => prev.map((a, i) => (i === index ? { ...a, status: "subiendo", error: undefined } : a)));
    try {
      await subirAdjunto(eventoId, archivos[index]!.file);
      setArchivos((prev) => prev.map((a, i) => (i === index ? { ...a, status: "ok" } : a)));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "No se pudo subir el adjunto";
      setArchivos((prev) => prev.map((a, i) => (i === index ? { ...a, status: "error", error: message } : a)));
    }
  }

  async function onSubmit(values: FormValues) {
    const input: CrearEventoClinicoInput = {
      date:               values.date,
      eventType:          values.eventType as TipoEventoClinico,
      professionalId:     values.professionalId,
      description:        values.description,
      weightKg:           values.weightKg ? Number(values.weightKg) : null,
      temperatureC:       values.temperatureC ? Number(values.temperatureC) : null,
      diagnosis:          values.diagnosis || null,
      treatment:          values.treatment || null,
      medication:         values.medication || null,
      notes:              values.notes || null,
      sendEmailToClient:  values.sendEmailToClient,
    };

    try {
      const creado = await crearEvento(petId, input);
      toast.success("Evento clínico registrado");
      setEventoCreado(creado);
      onSaved(creado);

      if (archivos.length > 0) {
        for (let i = 0; i < archivos.length; i++) {
          await subirArchivo(creado.id, i);
        }
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  const hayArchivosConError = archivos.some((a) => a.status === "error");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar evento clínico</DialogTitle>
          <DialogDescription>Los campos marcados con * son obligatorios.</DialogDescription>
        </DialogHeader>

        {eventoCreado ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              El evento ya fue registrado. {archivos.length > 0 ? "Subiendo adjuntos..." : null}
            </p>
            {archivos.length > 0 ? (
              <ul className="grid gap-2">
                {archivos.map((a, i) => (
                  <li key={`${a.file.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{a.file.name}</span>
                    <span className="flex items-center gap-2">
                      {a.status === "subiendo" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      {a.status === "ok" ? <span className="text-green-700">Subido</span> : null}
                      {a.status === "error" ? (
                        <>
                          <span className="text-destructive">{a.error}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => void subirArchivo(eventoCreado.id, i)}>
                            <RotateCcw className="size-3.5" aria-hidden /> Reintentar
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={control} errors={errors} name="date" label="Fecha *" type="date"
                rules={{ required: "La fecha es requerida" }}
              />

              <div className="grid gap-1.5">
                <Label htmlFor="eventType">Tipo de evento *</Label>
                <Controller
                  control={control}
                  name="eventType"
                  rules={{ required: "El tipo de evento es requerido" }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="eventType" aria-invalid={Boolean(errors.eventType)}>
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_EVENTO.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.eventType ? (
                  <p role="alert" className="text-sm text-destructive">{errors.eventType.message}</p>
                ) : null}
              </div>

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
                        {/* professional_id es FK a usuarios(id): el valor es el
                            usuario logeable (d.userId), no el PK del doctor.
                            El backend ya filtra con professional=true; este
                            filter es defensa en profundidad y type-guard. */}
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
            </div>

            {/* Datos clínicos */}
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
              control={control} errors={errors} name="description" label="Descripción *" multiline
              rules={{
                required:  "La descripción es requerida",
                maxLength: { value: 2000, message: "Máximo 2000 caracteres" },
              }}
            />
            <TextField
              control={control} errors={errors} name="diagnosis" label="Diagnóstico" multiline
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
            />
            <TextField
              control={control} errors={errors} name="treatment" label="Tratamiento" multiline
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
            />
            <TextField
              control={control} errors={errors} name="medication" label="Medicación" multiline
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
            />
            <TextField
              control={control} errors={errors} name="notes" label="Notas" multiline
              rules={{ maxLength: { value: 2000, message: "Máximo 2000 caracteres" } }}
            />

            {/* Adjuntos */}
            <div className="grid gap-1.5">
              <Label htmlFor="adjuntos">Adjuntos (JPG, PNG, GIF o PDF, máx. 10 MB)</Label>
              <Input
                id="adjuntos"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,application/pdf"
                aria-invalid={Boolean(archivosError)}
                aria-describedby={archivosError ? "adjuntos-error" : undefined}
                onChange={(e) => {
                  alSeleccionarArchivos(e.target.files);
                  e.target.value = "";
                }}
              />
              {archivosError ? (
                <p id="adjuntos-error" role="alert" className="text-sm text-destructive">{archivosError}</p>
              ) : null}
              {archivos.length > 0 ? (
                <ul className="grid gap-1">
                  {archivos.map((a, i) => (
                    <li key={`${a.file.name}-${i}`} className="flex items-center justify-between text-sm">
                      <span className="truncate">{a.file.name}</span>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${a.file.name}`} onClick={() => quitarArchivo(i)}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* Notificación */}
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="sendEmailToClient"
                render={({ field: { value, onChange } }) => (
                  <Checkbox id="sendEmailToClient" checked={value} onCheckedChange={onChange} />
                )}
              />
              <Label htmlFor="sendEmailToClient">Enviar resumen del evento al cliente por email</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || hayArchivosConError}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Registrar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type TextFieldName = Exclude<keyof FormValues, "sendEmailToClient">;

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
