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
import { listarDoctores } from "../../api/doctores.ts";
import type { Doctor } from "../../types/index.ts";

interface Props {
  value:    Doctor | null;
  onChange: (doctor: Doctor) => void;
}

/** Combobox buscable de un solo doctor (patrón ClienteCombobox de MascotaFormDialog). */
export function DoctorCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [doctores, setDoctores] = useState<Doctor[]>([]);

  useEffect(() => {
    listarDoctores({ search: query || undefined, limit: 15 })
      .then(({ items }) => setDoctores(items))
      .catch(() => setDoctores([]));
  }, [query]);

  function handleSelect(doctor: Doctor) {
    onChange(doctor);
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
          aria-label="Doctor"
          className={cn("w-full max-w-sm justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value?.name ?? "Buscar doctor..."}
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
              {doctores.map((d) => (
                <CommandItem key={d.id} value={d.id} onSelect={() => handleSelect(d)}>
                  <Check
                    className={cn("mr-2 size-4", value?.id === d.id ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span>{d.name}</span>
                  {d.specialty ? (
                    <span className="ml-auto text-xs text-muted-foreground">{d.specialty}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
