import { toast } from "sonner";
import { Accessibility } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { AccessibilityControls } from "../components/accesibilidad/AccessibilityControls.tsx";
import { usePreferences } from "../preferences/PreferencesContext.tsx";

/**
 * Panel global de preferencias de accesibilidad (RN-UX3). 
 * Ahora integrado dentro de Configuración como sub-sección.
 * Cada cambio aplica en vivo (CSS var/clases en el root vía PreferencesContext) 
 * y se persiste por usuario.
 */
export function PreferenciasSection() {
  const { reset } = usePreferences();

  function handleSaved() {
    toast.success("Preferencias guardadas");
  }

  function handleReset() {
    reset();
    toast.success("Preferencias restablecidas");
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-orange-800">
          <Accessibility className="size-5" aria-hidden />
          Preferencias de accesibilidad
        </h2>
        <p className="text-sm text-muted-foreground">
          Ajustá la interfaz a tu comodidad. Los cambios se aplican al instante y se
          guardan para tu usuario en este navegador.
        </p>
      </header>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle>Configuración de accesibilidad</CardTitle>
        </CardHeader>
        <CardContent>
          <AccessibilityControls 
            idPrefix="pref" 
            variant="basic"
            onSaved={handleSaved}
          />
          
          <div className="mt-6 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
            >
              Restablecer valores por defecto
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
