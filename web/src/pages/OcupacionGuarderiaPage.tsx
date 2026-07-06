import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BedDouble, CalendarRange, LayoutList, Plus } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx";
import { OcupacionDia } from "../components/guarderia/OcupacionDia.tsx";
import { OcupacionMes } from "../components/guarderia/OcupacionMes.tsx";
import { hoyISO } from "../components/turnos/fechas.ts";

type Vista = "dia" | "mes";

/**
 * Vista de ocupación de la guardería (Etapa 7): día (qué mascotas están, cupo,
 * check-in/out) y mes (calendario con la ocupación por día). Molde = TurnosPage.
 */
export function OcupacionGuarderiaPage() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState(hoyISO());
  const [vista, setVista] = useState<Vista>("dia");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <BedDouble className="size-6" aria-hidden />
            Ocupación de Guardería
          </h1>
          <p className="text-sm text-muted-foreground">
            {vista === "dia"
              ? "Mascotas en la guardería el día seleccionado, con check-in y check-out."
              : "Vista mensual: los días muestran cuántas estadías hay y cuáles están pendientes de acción."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={vista}
            onValueChange={(v) => { if (v) setVista(v as Vista); }}
            variant="outline"
            aria-label="Elegir vista de la ocupación"
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
          <Button onClick={() => navigate("/guarderia/nuevo")}>
            <Plus className="size-4" aria-hidden />
            Registrar estadía
          </Button>
        </div>
      </header>

      {vista === "dia" ? (
        <OcupacionDia fecha={fecha} onFecha={setFecha} />
      ) : (
        <OcupacionMes
          fechaInicial={fecha}
          onSelectDay={(iso) => { setFecha(iso); setVista("dia"); }}
        />
      )}
    </div>
  );
}
