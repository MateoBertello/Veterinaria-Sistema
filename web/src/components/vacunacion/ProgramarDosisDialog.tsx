import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
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
import { listarTiposVacuna, type TipoVacuna } from "../../api/catalogos.ts";
import { programarDosis } from "../../api/vacunacion.ts";
import { hoyISO } from "../../lib/fechas.ts";
import { ApiError, ErrorCode, type DosisVacunacion } from "../../types/index.ts";

interface FormValues {
  tipoVacunaId:  string;
  fechaEstimada: string;
  notas:         string;
}

export interface ProgramarDosisInitialValues {
  tipoVacunaId?:  string;
  fechaEstimada?: string;
  notas?:         string;
}

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  petId:        string;
  onSaved:      (dosis: DosisVacunacion) => void;
  /** Catálogo global ya cargado por el padre; si no viene, el diálogo lo pide al abrirse. */
  tiposVacuna?:  TipoVacuna[];
  /** Valores con los que abrir el formulario (p. ej. el refuerzo sugerido, RN-PV10). */
  initialValues?: ProgramarDosisInitialValues;
  /**
   * Texto de la sugerencia de refuerzo (RN-PV10). Su presencia pone el diálogo en
   * modo "refuerzo sugerido": cambia el título y explica de dónde sale la fecha.
   */
  sugerencia?: string | null;
}

export function ProgramarDosisDialog({
  open,
  onOpenChange,
  petId,
  onSaved,
  tiposVacuna,
  initialValues,
  sugerencia,
}: Props) {
  const hoy = hoyISO();
  const esSugerencia = Boolean(sugerencia);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { tipoVacunaId: "", fechaEstimada: hoy, notas: "" } });

  const [tipos, setTipos] = useState<TipoVacuna[]>([]);

  // Solo al abrirse: pre-cargar es un valor inicial, no un valor controlado — si
  // el efecto corriera en cada render pisaría lo que el veterinario esté editando.
  useEffect(() => {
    if (!open) return;
    reset({
      tipoVacunaId:  initialValues?.tipoVacunaId  ?? "",
      fechaEstimada: initialValues?.fechaEstimada ?? hoy,
      notas:         initialValues?.notas         ?? "",
    });
    if (tiposVacuna && tiposVacuna.length > 0) {
      setTipos(tiposVacuna);
      return;
    }
    listarTiposVacuna()
      .then(setTipos)
      .catch(() => setTipos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    try {
      const dosis = await programarDosis(petId, {
        tipoVacunaId:  values.tipoVacunaId,
        fechaEstimada: values.fechaEstimada,
        notas:         values.notas || undefined,
      });
      toast.success("Dosis programada");
      onSaved(dosis);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.PAST_DATE) {
        // RN-PV2: fechaEstimada no puede ser anterior a hoy.
        setError("fechaEstimada", { type: "server", message: err.message });
        return;
      }
      if (err instanceof ApiError && err.code === ErrorCode.VACCINE_TYPE_NOT_FOUND) {
        // RN-PV3: tipoVacunaId debe existir en el catálogo global.
        setError("tipoVacunaId", { type: "server", message: err.message });
        return;
      }
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esSugerencia ? "Programar refuerzo sugerido" : "Programar dosis"}</DialogTitle>
          {/*
            En modo sugerencia el texto va dentro de DialogDescription (y no en un
            cartel aparte) para que sea la descripción accesible del diálogo y el
            lector de pantalla lo anuncie al abrirse. El ícono y el borde —no el
            color solo— lo distinguen visualmente.
          */}
          {esSugerencia ? (
            <DialogDescription className="flex items-start gap-2 rounded-md border border-amber-400 p-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <span>{sugerencia} Los campos marcados con * son obligatorios.</span>
            </DialogDescription>
          ) : (
            <DialogDescription>Los campos marcados con * son obligatorios.</DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="tipoVacunaId">Tipo de vacuna *</Label>
            <Controller
              control={control}
              name="tipoVacunaId"
              rules={{ required: "El tipo de vacuna es requerido" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="tipoVacunaId" aria-invalid={Boolean(errors.tipoVacunaId)}>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {tipos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.tipoVacunaId ? (
              <p role="alert" className="text-sm text-destructive">{errors.tipoVacunaId.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="fechaEstimada">Fecha estimada *</Label>
            <Controller
              control={control}
              name="fechaEstimada"
              rules={{
                required: "La fecha estimada es requerida",
                validate: (v) => v >= hoy || "La fecha estimada no puede ser anterior a hoy",
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="fechaEstimada"
                  type="date"
                  aria-invalid={Boolean(errors.fechaEstimada)}
                  {...field}
                />
              )}
            />
            {errors.fechaEstimada ? (
              <p role="alert" className="text-sm text-destructive">{errors.fechaEstimada.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notas">Notas</Label>
            <Controller
              control={control}
              name="notas"
              rules={{ maxLength: { value: 500, message: "Máximo 500 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="notas" rows={3} aria-invalid={Boolean(errors.notas)} {...field} />
              )}
            />
            {errors.notas ? (
              <p role="alert" className="text-sm text-destructive">{errors.notas.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Programar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
