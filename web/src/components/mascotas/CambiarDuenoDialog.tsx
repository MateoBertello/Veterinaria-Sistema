import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Button } from "../ui/button.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
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
import { ApiError, type CambiarDuenoInput, type Cliente, type Mascota } from "../../types/index.ts";

type FormValues = {
  newClientId: string;
  reason:      string;
  notes:       string;
};

const VACIO: FormValues = { newClientId: "", reason: "", notes: "" };

interface Props {
  mascota:      Mascota | null;
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess:    () => void;
  cambiarDueno: (id: string, input: CambiarDuenoInput) => Promise<unknown>;
}

export function CambiarDuenoDialog({ mascota, open, onOpenChange, onSuccess, cambiarDueno }: Props) {
  const {
    control, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (open) reset(VACIO);
  }, [open, reset]);

  async function onSubmit(values: FormValues) {
    if (!mascota) return;
    try {
      await cambiarDueno(mascota.id, {
        newClientId: values.newClientId,
        reason:      values.reason.trim() || null,
        notes:       values.notes.trim() || null,
      });
      toast.success("Dueño cambiado correctamente");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo cambiar el dueño");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar dueño</DialogTitle>
          <DialogDescription>
            Mascota: <strong>{mascota?.name}</strong> — dueño actual: {mascota?.ownerName ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label>Nuevo dueño *</Label>
            <Controller
              control={control}
              name="newClientId"
              rules={{ required: "El nuevo dueño es requerido" }}
              render={({ field }) => (
                <NuevoDuenoCombobox
                  value={field.value}
                  onChange={field.onChange}
                  currentClientId={mascota?.clientId}
                  invalid={Boolean(errors.newClientId)}
                />
              )}
            />
            {errors.newClientId ? (
              <p role="alert" className="text-sm text-destructive">{errors.newClientId.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Controller
              control={control}
              name="reason"
              rules={{ maxLength: { value: 500, message: "Máximo 500 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="reason" rows={2} placeholder="Opcional" {...field} />
              )}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notas adicionales</Label>
            <Controller
              control={control}
              name="notes"
              rules={{ maxLength: { value: 1000, message: "Máximo 1000 caracteres" } }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Textarea id="notes" rows={2} placeholder="Opcional" {...field} />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Confirmar cambio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NuevoDuenoCombobox({
  value,
  onChange,
  currentClientId,
  invalid,
}: {
  value:            string;
  onChange:         (val: string) => void;
  currentClientId?: string;
  invalid?:         boolean;
}) {
  const [open,     setOpen]     = useState(false);
  const [query,    setQuery]    = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selected, setSelected] = useState<Cliente | null>(null);

  useEffect(() => {
    listarClientes({ search: query || undefined, limit: 15 })
      .then(({ items }) => setClientes(items.filter((c) => c.id !== currentClientId)))
      .catch(() => setClientes([]));
  }, [query, currentClientId]);

  function handleSelect(cliente: Cliente) {
    setSelected(cliente);
    onChange(cliente.id);
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
          aria-invalid={invalid}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          {selected?.fullName ?? (value ? "Cargando..." : "Buscar nuevo dueño...")}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
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
                    className={cn("mr-2 size-4", value === c.id ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {c.fullName}
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
