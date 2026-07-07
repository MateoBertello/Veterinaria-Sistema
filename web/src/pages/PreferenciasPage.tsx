import { toast } from "sonner";
import { Accessibility } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.tsx";
import { Switch } from "../components/ui/switch.tsx";
import {
  usePreferences,
  type Density,
  type FontSize,
  type Preferences,
} from "../preferences/PreferencesContext.tsx";

const FONT_SIZE_OPTS: { value: FontSize; label: string }[] = [
  { value: "sm", label: "Pequeño" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Grande" },
  { value: "xl", label: "Muy grande" },
];

const DENSITY_OPTS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Cómoda" },
  { value: "compact", label: "Compacta" },
];

/**
 * Panel global de preferencias de accesibilidad (RN-UX3). Cada cambio aplica en
 * vivo (CSS var/clases en el root vía PreferencesContext) y se persiste por usuario.
 */
export function PreferenciasPage() {
  const { prefs, setPref, reset } = usePreferences();

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPref(key, value);
    toast.success("Preferencias guardadas");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Accessibility className="size-6" aria-hidden />
          Preferencias de accesibilidad
        </h1>
        <p className="text-sm text-muted-foreground">
          Ajustá la interfaz a tu comodidad. Los cambios se aplican al instante y se
          guardan para tu usuario en este navegador.
        </p>
      </header>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle>Tamaño de fuente</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="mb-2 text-sm text-muted-foreground">
              Escala el texto de toda la aplicación.
            </legend>
            <RadioGroup
              aria-label="Tamaño de fuente"
              value={prefs.fontSize}
              onValueChange={(v) => update("fontSize", v as FontSize)}
              className="grid-cols-2 sm:grid-cols-4"
            >
              {FONT_SIZE_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`fontSize-${o.value}`} value={o.value} />
                  <Label htmlFor={`fontSize-${o.value}`} className="font-normal">{o.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle>Densidad de tablas</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="mb-2 text-sm text-muted-foreground">
              Compactá las filas para ver más datos por pantalla.
            </legend>
            <RadioGroup
              aria-label="Densidad de tablas"
              value={prefs.density}
              onValueChange={(v) => update("density", v as Density)}
              className="sm:grid-flow-col sm:justify-start sm:gap-8"
            >
              {DENSITY_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`density-${o.value}`} value={o.value} />
                  <Label htmlFor={`density-${o.value}`} className="font-normal">{o.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle>Contraste y movimiento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="highContrast">Alto contraste</Label>
              <p id="highContrast-help" className="text-sm text-muted-foreground">
                Refuerza el color del texto, los bordes y el indicador de foco.
              </p>
            </div>
            <Switch
              id="highContrast"
              aria-describedby="highContrast-help"
              checked={prefs.highContrast}
              onCheckedChange={(v) => update("highContrast", v)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="reducedMotion">Reducción de movimiento</Label>
              <p id="reducedMotion-help" className="text-sm text-muted-foreground">
                Minimiza animaciones y transiciones. Se activa por defecto si tu sistema
                lo pide.
              </p>
            </div>
            <Switch
              id="reducedMotion"
              aria-describedby="reducedMotion-help"
              checked={prefs.reducedMotion}
              onCheckedChange={(v) => update("reducedMotion", v)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            reset();
            toast.success("Preferencias restablecidas");
          }}
        >
          Restablecer valores por defecto
        </Button>
      </div>
    </div>
  );
}
