import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Info, Settings, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { NumberStepper } from "../components/common/NumberStepper.tsx";
import { actualizarConfiguracion, obtenerConfiguracion } from "../api/configuracion.ts";
import { ApiError, ErrorCode, type ConfiguracionInput } from "../types/index.ts";
import { PreferenciasSection } from "./PreferenciasPage.tsx";

type FormValues = ConfiguracionInput;

export function ConfiguracionPage() {
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saved, setSaved] = useState<FormValues | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { cupoMaximoDiario: 10, diasAvisoVacuna: 7 },
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const config = await obtenerConfiguracion();
      const values: FormValues = {
        cupoMaximoDiario: config.cupoMaximoDiario,
        diasAvisoVacuna: config.diasAvisoVacuna,
      };
      reset(values);
      setSaved(values);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.CONFIG_NOT_FOUND) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración");
      }
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(values: FormValues) {
    try {
      const guardado = await actualizarConfiguracion(values);
      toast.success("Configuración actualizada");
      const nuevos: FormValues = {
        cupoMaximoDiario: guardado.cupoMaximoDiario,
        diasAvisoVacuna: guardado.diasAvisoVacuna,
      };
      reset(nuevos);
      setSaved(nuevos);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.VALIDATION_ERROR) {
        const details = err.details as { field?: string; message?: string }[] | undefined;
        const detalle = details?.find((d) => d.field === "cupoMaximoDiario" || d.field === "diasAvisoVacuna");
        if (detalle?.field) {
          setFieldError(detalle.field as keyof FormValues, { type: "server", message: detalle.message ?? err.message });
          return;
        }
      }
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Settings className="size-6" aria-hidden />
          Configuración de la Clínica
        </h1>
        <p className="text-sm text-muted-foreground">
          Parámetros operativos que usan Guardería y el Plan de Vacunación.
        </p>
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : notFound ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            No se encontró la configuración de este tenant. Contactá a soporte para resolver este problema.
          </AlertDescription>
        </Alert>
      ) : error ? (
        <div className="rounded-lg border py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Alert className="border-blue-200 bg-blue-50 text-blue-900">
            <Info aria-hidden />
            <AlertDescription className="text-blue-800">
              Los cambios tienen efecto inmediato en las próximas validaciones. Reducir el cupo
              no cancela las estadías de guardería ya reservadas.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
              <CardTitle>Guardería</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Label htmlFor="cupoMaximoDiario">Cupo máximo diario</Label>
              <Controller
                control={control}
                name="cupoMaximoDiario"
                rules={{
                  required: true,
                  min: { value: 1, message: "Mínimo 1" },
                  max: { value: 500, message: "Máximo 500" },
                }}
                render={({ field }) => (
                  <NumberStepper
                    id="cupoMaximoDiario"
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={500}
                    step={1}
                    aria-invalid={Boolean(errors.cupoMaximoDiario)}
                    aria-describedby={
                      errors.cupoMaximoDiario
                        ? "cupoMaximoDiario-help cupoMaximoDiario-error"
                        : "cupoMaximoDiario-help"
                    }
                  />
                )}
              />
              <p id="cupoMaximoDiario-help" className="text-sm text-muted-foreground">
                Cantidad máxima de mascotas alojadas por día. Las reservas que excedan este cupo
                serán rechazadas.
              </p>
              {errors.cupoMaximoDiario ? (
                <p id="cupoMaximoDiario-error" role="alert" className="text-sm text-destructive">
                  {errors.cupoMaximoDiario.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
              <CardTitle>Notificaciones de vacunación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Label htmlFor="diasAvisoVacuna">Días de aviso de vacunas</Label>
              <Controller
                control={control}
                name="diasAvisoVacuna"
                rules={{
                  required: true,
                  min: { value: 1, message: "Mínimo 1" },
                  max: { value: 90, message: "Máximo 90" },
                }}
                render={({ field }) => (
                  <NumberStepper
                    id="diasAvisoVacuna"
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={90}
                    step={1}
                    aria-invalid={Boolean(errors.diasAvisoVacuna)}
                    aria-describedby={
                      errors.diasAvisoVacuna
                        ? "diasAvisoVacuna-help diasAvisoVacuna-error"
                        : "diasAvisoVacuna-help"
                    }
                  />
                )}
              />
              <p id="diasAvisoVacuna-help" className="text-sm text-muted-foreground">
                Con cuántos días de anticipación se notifica al cliente el vencimiento de una vacuna.
              </p>
              {errors.diasAvisoVacuna ? (
                <p id="diasAvisoVacuna-error" role="alert" className="text-sm text-destructive">
                  {errors.diasAvisoVacuna.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {isDirty ? (
            <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background py-3 shadow-lg">
              <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saved && reset(saved)}
                  disabled={isSubmitting}
                >
                  Descartar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  Guardar cambios
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      )}

      {/* Sección de Preferencias de Accesibilidad integrada en Configuración */}
      <PreferenciasSection />
    </div>
  );
}
