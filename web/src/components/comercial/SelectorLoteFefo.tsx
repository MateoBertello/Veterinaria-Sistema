import { AlertCircle, AlertTriangle } from "lucide-react";
import { Badge } from "../ui/badge.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import type { LoteCandidato } from "../../types/index.ts";

export interface SelectorLoteFefoProps {
  candidatos?: LoteCandidato[];
  loadingLotes?: boolean;
  sinStock?: boolean;
  stockInsuficiente?: boolean;
  loteId?: string | null;
  loteSugeridoId?: string | null;
  motivoFefo?: string;
  nombreProducto: string;
  mensajeSinMotivo?: string;
  onSeleccionarLote: (loteId: string) => void;
  onActualizarMotivoFefo: (motivo: string) => void;
}

export function SelectorLoteFefo({
  candidatos = [],
  loadingLotes = false,
  sinStock = false,
  stockInsuficiente = false,
  loteId,
  loteSugeridoId,
  motivoFefo = "",
  nombreProducto,
  mensajeSinMotivo = "Debés especificar un motivo para poder continuar.",
  onSeleccionarLote,
  onActualizarMotivoFefo,
}: SelectorLoteFefoProps) {
  if (loadingLotes) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (sinStock) {
    return (
      <div className="rounded bg-destructive/10 p-2 text-xs font-medium text-destructive border border-destructive/20 flex items-center gap-1.5">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        Sin existencia disponible
      </div>
    );
  }

  const noEsSugerido = Boolean(loteId && loteSugeridoId && loteId !== loteSugeridoId);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase">
          Lote (criterio FEFO)
        </Label>
        {stockInsuficiente && (
          <span className="text-[10px] text-amber-600 font-medium">
            Existencia disponible menor a la pedida
          </span>
        )}
      </div>
      <Select
        value={loteId || ""}
        onValueChange={onSeleccionarLote}
      >
        <SelectTrigger
          aria-label={`Lote para ${nombreProducto}`}
          className="h-8 text-xs font-mono"
        >
          <SelectValue placeholder="Seleccionar lote..." />
        </SelectTrigger>
        <SelectContent>
          {candidatos.map((cand, idx) => {
            const esSugerido = idx === 0;
            return (
              <SelectItem key={cand.loteId} value={cand.loteId}>
                <div className="flex items-center gap-2">
                  <span>{cand.codigoLote || "Sin código"}</span>
                  {cand.fechaVencimiento && (
                    <span className="text-muted-foreground text-[10px]">
                      (vence: {cand.fechaVencimiento})
                    </span>
                  )}
                  <span className="text-muted-foreground text-[10px]">
                    Disp: {cand.cantidadDisponible}
                  </span>
                  {esSugerido && (
                    <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px] px-1 py-0 hover:bg-green-100">
                      Sugerido (vence antes)
                    </Badge>
                  )}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Campo motivoFefo en la misma línea (§2.2) */}
      {noEsSugerido && (
        <div className="pt-1 space-y-1 bg-amber-50/70 p-2 rounded-md border border-amber-200">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-900">
            <AlertTriangle className="size-3.5 text-amber-600" aria-hidden />
            Motivo de desvío de FEFO (requerido)
          </div>
          <Input
            type="text"
            placeholder="Explicá por qué elegís este lote en vez del sugerido..."
            aria-label={`Motivo FEFO para ${nombreProducto}`}
            value={motivoFefo}
            onChange={(e) => onActualizarMotivoFefo(e.target.value)}
            className="h-7 text-xs bg-white border-amber-300"
            required
          />
          {!motivoFefo.trim() && (
            <span className="text-[10px] text-destructive block">
              {mensajeSinMotivo}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
