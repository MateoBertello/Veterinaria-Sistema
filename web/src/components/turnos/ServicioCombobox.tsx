import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { cn } from "../ui/utils.ts";
import { listarServicios } from "../../api/servicios.ts";
import type { Servicio } from "../../types/index.ts";

interface Props {
  value:    Servicio | null;
  onChange: (servicio: Servicio) => void;
}

/** Combobox buscable de servicios activos (mismo patrón que DoctorCombobox/ClienteCombobox). */
export function ServicioCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [servicios, setServicios] = useState<Servicio[]>([]);

  useEffect(() => {
    listarServicios({ search: query || undefined, activo: true, limit: 15 })
      .then(({ items }) => setServicios(items))
      .catch(() => setServicios([]));
  }, [query]);

  function handleSelect(servicio: Servicio) {
    onChange(servicio);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Servicio"
          className={cn("w-full max-w-sm justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value?.nombre ?? "Buscar servicio..."}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nombre..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {servicios.map((s) => (
                <CommandItem key={s.id} value={s.id} onSelect={() => handleSelect(s)}>
                  <Check
                    className={cn("mr-2 size-4", value?.id === s.id ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span>{s.nombre}</span>
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {s.duracionMinutos} min
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
