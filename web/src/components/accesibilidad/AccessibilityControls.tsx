import { toast } from "sonner";
import { Label } from "../ui/label.tsx";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.tsx";
import { Switch } from "../ui/switch.tsx";
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

export interface AccessibilityControlsProps {
  /** Callback opcional para mostrar toast después de guardar */
  onSaved?: () => void;
  /** Prefijo único para IDs de formularios (evita colisiones entre instancias) */
  idPrefix?: string;
  /** Mostrar todas las opciones o solo las básicas */
  variant?: "full" | "basic";
}

/**
 * Componente reusable de controles de accesibilidad (RN-UX3).
 * Usado tanto en AccessibilityButton (panel flotante) como en PreferenciasPage (dentro de Configuración).
 * Delega toda lectura/escritura al PreferencesContext existente.
 */
export function AccessibilityControls({
  onSaved,
  idPrefix = "ac",
  variant = "full",
}: AccessibilityControlsProps) {
  const { prefs, setPref } = usePreferences();

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPref(key, value);
    if (onSaved) {
      onSaved();
    }
  }

  return (
    <div className="space-y-6">
      {/* Tamaño de fuente */}
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
              <RadioGroupItem id={`${idPrefix}-fontSize-${o.value}`} value={o.value} />
              <Label htmlFor={`${idPrefix}-fontSize-${o.value}`} className="font-normal">
                {o.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {/* Densidad de tablas */}
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
              <RadioGroupItem id={`${idPrefix}-density-${o.value}`} value={o.value} />
              <Label htmlFor={`${idPrefix}-density-${o.value}`} className="font-normal">
                {o.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {variant === "full" && (
        <>
          {/* Vista de tablas */}
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
                  <RadioGroupItem id={`${idPrefix}-tableViewMode-${o.value}`} value={o.value} />
                  <Label htmlFor={`${idPrefix}-tableViewMode-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          {/* Espaciado de tarjetas */}
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
                  <RadioGroupItem id={`${idPrefix}-cardSpacing-${o.value}`} value={o.value} />
                  <Label htmlFor={`${idPrefix}-cardSpacing-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </>
      )}

      {/* Interruptores */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor={`${idPrefix}-highContrast`} className="font-normal">
            Alto contraste
          </Label>
          <Switch
            id={`${idPrefix}-highContrast`}
            checked={prefs.highContrast}
            onCheckedChange={(v) => update("highContrast", v)}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <Label htmlFor={`${idPrefix}-reducedMotion`} className="font-normal">
            Reducción de movimiento
          </Label>
          <Switch
            id={`${idPrefix}-reducedMotion`}
            checked={prefs.reducedMotion}
            onCheckedChange={(v) => update("reducedMotion", v)}
          />
        </div>
      </div>
    </div>
  );
}
