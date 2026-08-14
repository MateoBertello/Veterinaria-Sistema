import { useState } from "react";
import { toast } from "sonner";
import { Palette, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet.tsx";
import { AccessibilityControls } from "./AccessibilityControls.tsx";
import { usePreferences } from "../../preferences/PreferencesContext.tsx";

/**
 * Botón flotante de accesibilidad (RN-UX3): capa de PRESENTACIÓN sobre
 * usePreferences(). No agrega estado propio; delega toda lectura/escritura
 * al PreferencesContext existente (persistencia por usuario, CSS var/clases).
 */
export function AccessibilityButton() {
  const [open, setOpen] = useState(false);
  const { reset } = usePreferences();

  function handleSaved() {
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
          <AccessibilityControls 
            idPrefix="ab" 
            variant="full"
            onSaved={handleSaved}
          />
        </div>

        <SheetFooter>
          <Button 
            type="button" 
            variant="outline" 
            className="w-full" 
            onClick={handleReset}
          >
            <RefreshCw className="size-4" aria-hidden />
            Restablecer valores por defecto
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
