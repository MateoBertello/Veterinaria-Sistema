import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Badge } from "../ui/badge.tsx";
import { ESTADO_BADGE_CLASS } from "./estado.ts";

/**
 * Ayuda breve del flujo de estados del turno (secundaria: explica, no reemplaza el
 * valor). Accesible por teclado; el trigger tiene nombre accesible.
 */
export function FlujoEstadosHelp() {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-orange-50 hover:text-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
        aria-label="Ayuda: flujo de estados del turno"
      >
        <HelpCircle className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <p className="mb-2 font-medium text-orange-800">Flujo de estados</p>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <Badge className={ESTADO_BADGE_CLASS.Programado}>Programado</Badge>
            <span className="text-muted-foreground">Turno agendado, a la espera de confirmación.</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className={ESTADO_BADGE_CLASS.Confirmado}>Confirmado</Badge>
            <span className="text-muted-foreground">El cliente confirmó; listo para atender.</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className={ESTADO_BADGE_CLASS.Completado}>Completado</Badge>
            <span className="text-muted-foreground">La atención se realizó. Queda como registro del día.</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className={ESTADO_BADGE_CLASS.Cancelado}>Cancelado</Badge>
            <span className="text-muted-foreground">El turno no se realizará. Se conserva con su motivo.</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Programado → Confirmado → Completado. Cancelar es posible mientras no esté cerrado.
        </p>
      </PopoverContent>
    </Popover>
  );
}
