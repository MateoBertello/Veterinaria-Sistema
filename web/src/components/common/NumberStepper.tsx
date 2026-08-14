import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

interface Props {
  id?:      string;
  value:    number | undefined;
  onChange: (value: number) => void;
  min:      number;
  max:      number;
  step:     number;
  "aria-invalid"?:     boolean;
  "aria-describedby"?: string;
}

function clampTo(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Input numérico + botones +/- de a `step`, clamp a [min, max] al perder foco.
 * Mantiene texto local mientras se escribe para no "pisar" el valor a mitad de
 * edición (ej. al borrar todo para escribir un número nuevo).
 */
export function NumberStepper({ id, value, onChange, min, max, step, ...aria }: Props) {
  const committed = value ?? min;
  const [text, setText] = useState(String(committed));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(committed));
  }, [committed]);

  function step_(delta: number) {
    onChange(clampTo(committed + delta, min, max));
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Disminuir"
        disabled={committed <= min}
        onClick={() => step_(-step)}
      >
        <Minus className="size-4" aria-hidden />
      </Button>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        className="w-24 text-center"
        value={text}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = Number(raw);
          if (raw !== "" && !Number.isNaN(n)) onChange(n);
        }}
        onBlur={() => {
          focused.current = false;
          const n = Number(text);
          const next = text === "" || Number.isNaN(n) ? committed : clampTo(n, min, max);
          setText(String(next));
          onChange(next);
        }}
        {...aria}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Aumentar"
        disabled={committed >= max}
        onClick={() => step_(step)}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
