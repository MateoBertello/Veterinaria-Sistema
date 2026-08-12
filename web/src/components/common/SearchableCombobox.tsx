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

export interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchableComboboxProps<T extends ComboboxOption> {
  /** Opción seleccionada actualmente */
  value: T | null;
  /** Callback cuando se selecciona una opción */
  onChange: (option: T) => void;
  /** Función asíncrona que busca opciones basado en el query */
  searchFn: (query: string) => Promise<T[]>;
  /** Placeholder para el input de búsqueda */
  placeholder?: string;
  /** Placeholder cuando no hay valor seleccionado */
  emptyLabel?: string;
  /** Mensaje cuando no hay resultados */
  emptyMessage?: string;
  /** Label accesible para el botón trigger */
  ariaLabel?: string;
  /** Ancho máximo del popover */
  popoverWidth?: string;
  /** Si true, muestra descripción de cada opción */
  showDescription?: boolean;
}

/**
 * Combobox buscable y reutilizable con soporte para opciones asíncronas.
 * 
 * @example
 * ```tsx
 * <SearchableCombobox
 *   value={selectedCliente}
 *   onChange={setSelectedCliente}
 *   searchFn={(q) => listarClientes({ search: q }).then(r => r.items)}
 *   placeholder="Buscar por nombre o DNI..."
 *   emptyLabel="Seleccionar dueño..."
 *   ariaLabel="Dueño"
 * />
 * ```
 */
export function SearchableCombobox<T extends ComboboxOption>({
  value,
  onChange,
  searchFn,
  placeholder = "Buscar...",
  emptyLabel = "Seleccionar...",
  emptyMessage = "Sin resultados.",
  ariaLabel = "Opción",
  popoverWidth = "w-80",
  showDescription = false,
}: SearchableComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let activo = true;
    setLoading(true);
    
    searchFn(query)
      .then((results) => {
        if (activo) setOptions(results);
      })
      .catch(() => {
        if (activo) setOptions([]);
      })
      .finally(() => {
        if (activo) setLoading(false);
      });
    
    return () => {
      activo = false;
    };
  }, [query, searchFn]);

  function handleSelect(option: T) {
    onChange(option);
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
          aria-label={ariaLabel}
          className={cn("w-full max-w-sm justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value?.label ?? emptyLabel}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", popoverWidth)} align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            disabled={loading}
          />
          <CommandList>
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Cargando...</div>
            ) : (
              <>
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem key={option.id} value={option.id} onSelect={() => handleSelect(option)}>
                      <Check
                        className={cn(
                          "mr-2 size-4",
                          value?.id === option.id ? "opacity-100" : "opacity-0"
                        )}
                        aria-hidden
                      />
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        {showDescription && option.description && (
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                      {option.metadata && Object.keys(option.metadata).length > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {Object.values(option.metadata)[0]}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
