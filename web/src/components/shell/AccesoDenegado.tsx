import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";

/**
 * Pantalla que ve un usuario autenticado cuyo rol no tiene el permiso de la
 * sección (RN-S2). Reemplaza al redirect silencioso a "/": mandarlo al panel sin
 * decir nada deja al usuario creyendo que hizo click mal, y a quien le pasaron
 * el link sin saber por qué no funciona. Acá se le nombra lo que pasó y se le
 * dice a quién pedírselo.
 */
export function AccesoDenegado() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Lock className="size-6" aria-hidden />
          Sin acceso
        </h1>
        <p className="text-sm text-muted-foreground">
          Tu rol no tiene permiso para ver esta sección.
        </p>
      </header>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle className="text-base font-semibold">¿Necesitás entrar acá?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6 pt-6">
          <p className="text-sm text-muted-foreground">
            Los permisos los define el rol que tenés asignado en la clínica. Pedile a
            un administrador que revise tu rol desde <strong>Usuarios</strong> si
            necesitás acceso a esta sección.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
