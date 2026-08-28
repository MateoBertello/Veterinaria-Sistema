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
import { listarClientes } from "../../api/clientes.ts";
import type { Cliente } from "../../types/index.ts";

interface Props {
  value:    Cliente | null;
  onChange: (cliente: Cliente) => void;
}

/** Combobox buscable de un solo cliente (mismo patrón que DoctorCombobox). */
export function ClienteCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);

  useEffect(() => {
    listarClientes({ search: query || undefined, limit: 15 })
      .then(({ items }) => setClientes(items))
      .catch(() => setClientes([]));
  }, [query]);

  function handleSelect(cliente: Cliente) {
    onChange(cliente);
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
          aria-label="Tutor"
          className={cn("w-full max-w-sm justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value?.fullName ?? "Buscar tutor..."}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nombre o DNI..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {clientes.map((c) => (
                <CommandItem key={c.id} value={c.id} onSelect={() => handleSelect(c)}>
                  <Check
                    className={cn("mr-2 size-4", value?.id === c.id ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span>{c.fullName}</span>
                  {c.dniCuit ? (
                    <span className="ml-auto text-xs text-muted-foreground">{c.dniCuit}</span>
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
