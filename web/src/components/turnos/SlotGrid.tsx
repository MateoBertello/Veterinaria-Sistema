import { Skeleton } from "../ui/skeleton.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/utils.ts";
import type { SlotDisponible } from "../../types/index.ts";

interface Props {
  slots:    SlotDisponible[];
  value:    string | null;
  onChange: (slot: SlotDisponible) => void;
  loading:  boolean;
}

/** Grilla de horarios de inicio disponibles (RN-TU2); solo los que el backend ya filtró como libres. */
export function SlotGrid({ slots, value, onChange, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16" />
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay horarios disponibles para esta fecha.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Horarios de inicio disponibles">
      {slots.map((slot) => (
        <Button
          key={slot.startTime}
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={value === slot.startTime}
          className={cn(
            value === slot.startTime && "border-orange-500 bg-orange-100 text-orange-800 hover:bg-orange-100",
          )}
          onClick={() => onChange(slot)}
        >
          {slot.startTime}
        </Button>
      ))}
    </div>
  );
}
