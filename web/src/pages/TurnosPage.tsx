import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CalendarRange, LayoutList, Plus } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";
import { AgendaDia } from "../components/turnos/AgendaDia.tsx";
import { AgendaMes } from "../components/turnos/AgendaMes.tsx";
import { hoyISO } from "../components/turnos/fechas.ts";

type Vista = "dia" | "mes";

export function TurnosPage() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState(hoyISO());
  const [vista, setVista] = useState<Vista>("dia");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <CalendarDays className="size-6" aria-hidden />
            Agenda de Turnos
          </h1>
          <p className="text-sm text-muted-foreground">
            {vista === "dia"
              ? "Turnos del día seleccionado, filtrables por estado."
              : "Vista mensual: los días con turnos próximos muestran su cantidad."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={vista}
            onValueChange={(v) => { if (v) setVista(v as Vista); }}
            variant="outline"
            aria-label="Elegir vista de la agenda"
          >
            <ToggleGroupItem value="dia" aria-label="Vista día">
              <LayoutList className="size-4" aria-hidden />
              Día
            </ToggleGroupItem>
            <ToggleGroupItem value="mes" aria-label="Vista mes">
              <CalendarRange className="size-4" aria-hidden />
              Mes
            </ToggleGroupItem>
          </ToggleGroup>
          <Button onClick={() => navigate("/turnos/nuevo")}>
            <Plus className="size-4" aria-hidden />
            Nuevo turno
          </Button>
        </div>
      </header>

      {vista === "dia" ? (
        <AgendaDia fecha={fecha} onFecha={setFecha} />
      ) : (
        <AgendaMes
          fechaInicial={fecha}
          onSelectDay={(iso) => { setFecha(iso); setVista("dia"); }}
        />
      )}
    </div>
  );
}
