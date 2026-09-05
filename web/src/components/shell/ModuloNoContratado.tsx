import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import type { ModuloVendible } from "../../types/index.ts";

const NOMBRES_MODULOS: Record<ModuloVendible, string> = {
  historial_clinico: "Historial Clínico",
  turnos:            "Turnos",
  guarderia:         "Guardería",
  stock:             "Stock e Inventario",
  ventas:            "Ventas y Facturación",
};

export interface ModuloNoContratadoProps {
  modulo: ModuloVendible;
}

/**
 * Pantalla que ve un usuario que accede por URL a una sección de un módulo vendible
 * que no está contratado ni habilitado en la suscripción del tenant (RN-G2).
 */
export function ModuloNoContratado({ modulo }: ModuloNoContratadoProps) {
  const nombreModulo = NOMBRES_MODULOS[modulo] ?? modulo;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <ShieldAlert className="size-6 text-orange-600" aria-hidden />
          Módulo no contratado
        </h1>
        <p className="text-sm text-muted-foreground">
          El módulo <strong>{nombreModulo}</strong> no forma parte del plan contratado por esta veterinaria.
        </p>
      </header>

      <Card>
        <CardHeader className="rounded-t-xl bg-gradient-to-r from-orange-50 to-white">
          <CardTitle className="text-base font-semibold">¿Te interesa habilitar esta funcionalidad?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6 pt-6">
          <p className="text-sm text-muted-foreground">
            Los módulos adicionales pueden activarse en la suscripción de la clínica en cualquier
            momento. Si necesitás utilizar {nombreModulo}, contactá al administrador de la
            clínica o al equipo de soporte de Veterinaria Leo para incorporarlo al plan.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
