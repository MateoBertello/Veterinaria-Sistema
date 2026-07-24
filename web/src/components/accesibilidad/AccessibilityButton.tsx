import { useState } from "react";
import { toast } from "sonner";
import { Palette, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Label } from "../ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.tsx";
import { Switch } from "../ui/switch.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet.tsx";
import {
  usePreferences,
  type CardSpacing,
  type Density,
  type FontSize,
  type Preferences,
  type TableViewMode,
} from "../../preferences/PreferencesContext.tsx";

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

const TABLE_VIEW_MODE_OPTS: { value: TableViewMode; label: string }[] = [
  { value: "compact", label: "Compacta" },
  { value: "comfortable", label: "Cómoda" },
  { value: "expanded", label: "Expandida" },
];

const CARD_SPACING_OPTS: { value: CardSpacing; label: string }[] = [
  { value: "tight", label: "Ajustado" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relajado" },
];

/**
 * Botón flotante de accesibilidad (RN-UX3): capa de PRESENTACIÓN sobre
 * usePreferences(). No agrega estado propio; delega toda lectura/escritura
 * al PreferencesContext existente (persistencia por usuario, CSS var/clases).
 */
export function AccessibilityButton() {
  const [open, setOpen] = useState(false);
  const { prefs, setPref, reset } = usePreferences();

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPref(key, value);
    toast.success("Preferencias guardadas");
  }

  function handleReset() {
    reset();
    toast.success("Preferencias restablecidas");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          aria-label="Abrir panel de accesibilidad"
          title="Accesibilidad y personalización"
          className="fixed bottom-6 right-6 z-40 h-16 w-16 rounded-full p-0 shadow-lg hover:shadow-xl"
        >
          <Palette className="size-7" aria-hidden />
        </Button>
      </SheetTrigger>

      <SheetContent className="flex flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-orange-800">
            <Palette className="size-5" aria-hidden />
            Accesibilidad y personalización
          </SheetTitle>
          <SheetDescription>
            Ajustá la interfaz a tu comodidad. Los cambios se aplican al instante y
            se guardan para tu usuario en este navegador.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Tamaño de fuente</legend>
            <RadioGroup
              aria-label="Tamaño de fuente"
              value={prefs.fontSize}
              onValueChange={(v) => update("fontSize", v as FontSize)}
              className="grid-cols-2"
            >
              {FONT_SIZE_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`ab-fontSize-${o.value}`} value={o.value} />
                  <Label htmlFor={`ab-fontSize-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Densidad de tablas</legend>
            <RadioGroup
              aria-label="Densidad de tablas"
              value={prefs.density}
              onValueChange={(v) => update("density", v as Density)}
              className="grid-cols-2"
            >
              {DENSITY_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`ab-density-${o.value}`} value={o.value} />
                  <Label htmlFor={`ab-density-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Vista de tablas</legend>
            <RadioGroup
              aria-label="Vista de tablas"
              value={prefs.tableViewMode}
              onValueChange={(v) => update("tableViewMode", v as TableViewMode)}
              className="grid-cols-1"
            >
              {TABLE_VIEW_MODE_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`ab-tableViewMode-${o.value}`} value={o.value} />
                  <Label htmlFor={`ab-tableViewMode-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Espaciado de tarjetas</legend>
            <RadioGroup
              aria-label="Espaciado de tarjetas"
              value={prefs.cardSpacing}
              onValueChange={(v) => update("cardSpacing", v as CardSpacing)}
              className="grid-cols-1"
            >
              {CARD_SPACING_OPTS.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`ab-cardSpacing-${o.value}`} value={o.value} />
                  <Label htmlFor={`ab-cardSpacing-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <Label htmlFor="ab-highContrast" className="font-normal">
                Alto contraste
              </Label>
              <Switch
                id="ab-highContrast"
                checked={prefs.highContrast}
                onCheckedChange={(v) => update("highContrast", v)}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <Label htmlFor="ab-reducedMotion" className="font-normal">
                Reducción de movimiento
              </Label>
              <Switch
                id="ab-reducedMotion"
                checked={prefs.reducedMotion}
                onCheckedChange={(v) => update("reducedMotion", v)}
              />
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" className="w-full" onClick={handleReset}>
            <RefreshCw className="size-4" aria-hidden />
            Restablecer valores por defecto
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
