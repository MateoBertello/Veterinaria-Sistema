import { Construction } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";

export interface PantallaEnConstruccionProps {
  titulo:       string;
  descripcion?: string;
}

/**
 * Placeholder accesible para pantallas comerciales de próximas tandas.
 * Fija el árbol de rutas y el gating por permisos en F1·T1.
 */
export function PantallaEnConstruccion({
  titulo,
  descripcion = "Esta pantalla se habilitará en las siguientes tandas del módulo comercial.",
}: PantallaEnConstruccionProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Construction className="size-6 text-orange-600" aria-hidden />
          {titulo}
        </h1>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </header>

      <Card className="border-dashed">
        <CardHeader className="bg-gradient-to-r from-orange-50 to-white">
          <CardTitle className="text-base font-medium text-orange-950">
            Módulo Comercial · En Construcción
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <p>
            Ruta configurada y protegida por permisos. La interfaz de usuario completa
            se entregará en su respectiva tanda.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
