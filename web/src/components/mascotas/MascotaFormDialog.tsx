import { useCallback, useEffect, useState } from "react";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type RegisterOptions,
} from "react-hook-form";
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
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { listarEspecies, listarRazas } from "../../api/catalogos.ts";
import { listarClientes } from "../../api/clientes.ts";
import { cn } from "../ui/utils.ts";
import {
  ApiError,
  type EditarMascotaInput,
  type Especie,
  type Mascota,
  type MascotaInput,
  type Raza,
} from "../../types/index.ts";
import type { Cliente } from "../../types/index.ts";

const SEXO_OPTIONS = ["Macho", "Hembra", "Desconocido"] as const;
const TAMANO_OPTIONS = ["Pequeño", "Mediano", "Grande"] as const;

type FormValues = {
  name:          string;
  clientId:      string;
  especieId:     string;
  razaId:        string;
  sex:           string;
  tamano:        string;
  alimentoDieta: string;
  birthDate:     string;
  color:         string;
  observations:  string;
};

// Radix Select no acepta value="" en SelectItem → usamos sentinel para "sin raza".
const RAZA_NONE = "__none__";

const VACIO: FormValues = {
  name: "", clientId: "", especieId: "", razaId: RAZA_NONE,
  sex: "", tamano: "", alimentoDieta: "", birthDate: "", color: "", observations: "",
};

interface Props {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  mascota?:      Mascota | null;
  onSaved:       (mascota: Mascota) => void;
  crear:         (input: MascotaInput) => Promise<Mascota>;
  editar:        (id: string, input: EditarMascotaInput) => Promise<Mascota>;
}

function calcEdad(birthDate: string): string {
  const birth = new Date(birthDate);
  const now   = new Date();
  const ms    = now.getTime() - birth.getTime();
  const years  = Math.floor(ms / (365.25 * 86_400_000));
  const months = Math.floor((ms % (365.25 * 86_400_000)) / (30.44 * 86_400_000));
  if (years > 0) {
    return months > 0
      ? `${years} año${years === 1 ? "" : "s"}, ${months} mes${months === 1 ? "" : "es"}`
      : `${years} año${years === 1 ? "" : "s"}`;
  }
  return months === 0 ? "< 1 mes" : `${months} mes${months === 1 ? "" : "es"}`;
}

export function MascotaFormDialog({ open, onOpenChange, mascota, onSaved, crear, editar }: Props) {
  const esEdicion = Boolean(mascota);
  const hoy = new Date().toISOString().slice(0, 10);

  const [especies,    setEspecies]    = useState<Especie[]>([]);
  const [razas,       setRazas]       = useState<Raza[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);

  const {
    control, handleSubmit, reset, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  const birthDateValue = watch("birthDate");

  useEffect(() => {
    if (!open) return;
    setLoadingCats(true);
    listarEspecies()
      .then(setEspecies)
      .catch(() => toast.error("No se pudieron cargar las especies"))
      .finally(() => setLoadingCats(false));
  }, [open]);

  const loadRazas = useCallback((especieId: string) => {
    if (!especieId) { setRazas([]); return; }
    listarRazas(especieId).then(setRazas).catch(() => setRazas([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mascota) {
      reset({
        name:          mascota.name,
        clientId:      mascota.clientId,
        especieId:     mascota.especieId,
        razaId:        mascota.razaId ?? RAZA_NONE,
        sex:           mascota.sex,
        tamano:        mascota.tamano,
        alimentoDieta: mascota.alimentoDieta ?? "",
        birthDate:     mascota.birthDate ?? "",
        color:         mascota.color ?? "",
        observations:  mascota.observations ?? "",
      });
      loadRazas(mascota.especieId);
    } else {
      reset(VACIO);
      setRazas([]);
    }
  }, [open, mascota, reset, loadRazas]);

  async function onSubmit(values: FormValues) {
    try {
      let guardada: Mascota;
      if (esEdicion) {
        const input: EditarMascotaInput = {
          name:          values.name.trim(),
          especieId:     values.especieId || undefined,
          razaId:        values.razaId === RAZA_NONE ? null : (values.razaId || null),
          sex:           values.sex as MascotaInput["sex"],
          tamano:        values.tamano as MascotaInput["tamano"],
          alimentoDieta: values.alimentoDieta.trim() || null,
          color:         values.color.trim() || null,
          observations:  values.observations.trim() || null,
        };
        guardada = await editar(mascota!.id, input);
      } else {
        const input: MascotaInput = {
          name:          values.name.trim(),
          clientId:      values.clientId,
          especieId:     values.especieId,
          razaId:        values.razaId === RAZA_NONE ? null : (values.razaId || null),
          sex:           values.sex as MascotaInput["sex"],
          tamano:        values.tamano as MascotaInput["tamano"],
          alimentoDieta: values.alimentoDieta.trim() || null,
          birthDate:     values.birthDate || null,
          color:         values.color.trim() || null,
          observations:  values.observations.trim() || null,
        };
        guardada = await crear(input);
      }
      toast.success(esEdicion ? "Mascota actualizada" : "Mascota registrada");
      onSaved(guardada);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar mascota" : "Nueva mascota"}</DialogTitle>
          <DialogDescription>Los campos marcados con * son obligatorios.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <TextField
            control={control} errors={errors} name="name" label="Nombre *"
            rules={{
              required:  "El nombre es requerido",
              maxLength: { value: 120, message: "Máximo 120 caracteres" },
            }}
          />

          {/* Cliente / Dueño */}
          <div className="grid gap-1.5">
            <Label htmlFor="clientId">Tutor *</Label>
            {esEdicion ? (
              <Input id="clientId" value={mascota?.ownerName ?? ""} disabled readOnly aria-label="Tutor" />
            ) : (
              <Controller
                control={control}
                name="clientId"
                rules={{ required: "El tutor es requerido" }}
                render={({ field }) => (
                  <ClienteCombobox
                    value={field.value}
                    onChange={field.onChange}
                    invalid={Boolean(errors.clientId)}
                  />
                )}
              />
            )}
            {errors.clientId ? (
              <p role="alert" className="text-sm text-destructive">{errors.clientId.message}</p>
            ) : null}
          </div>

          {/* Especie + Raza */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="especieId">Especie *</Label>
              <Controller
                control={control}
                name="especieId"
                rules={{ required: "La especie es requerida" }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    disabled={loadingCats || esEdicion}
                    onValueChange={(val) => {
                      field.onChange(val);
                      setValue("razaId", RAZA_NONE);
                      loadRazas(val);
                    }}
                  >
                    <SelectTrigger
                      id="especieId"
                      aria-invalid={Boolean(errors.especieId)}
                      aria-describedby={esEdicion ? "especieId-hint" : undefined}
                    >
                      <SelectValue placeholder={loadingCats ? "Cargando..." : "Seleccionar..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {especies.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {esEdicion ? (
                <p id="especieId-hint" className="text-xs text-muted-foreground">
                  La especie no se puede modificar una vez creada (RN-MA11): de ella dependen la raza y las
                  vacunas aplicables de la mascota.
                </p>
              ) : null}
              {errors.especieId ? (
                <p role="alert" className="text-sm text-destructive">{errors.especieId.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="razaId">Raza</Label>
              <Controller
                control={control}
                name="razaId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    disabled={razas.length === 0}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="razaId">
                      <SelectValue placeholder={razas.length === 0 ? "Primero elegir especie" : "Seleccionar..."} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={RAZA_NONE}>Sin raza especificada</SelectItem>
                      {razas.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* Sexo + Tamaño */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sex">Sexo *</Label>
              <Controller
                control={control}
                name="sex"
                rules={{ required: "El sexo es requerido" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="sex" aria-invalid={Boolean(errors.sex)}>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SEXO_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.sex ? (
                <p role="alert" className="text-sm text-destructive">{errors.sex.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tamano">Tamaño *</Label>
              <Controller
                control={control}
                name="tamano"
                rules={{ required: "El tamaño es requerido" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tamano" aria-invalid={Boolean(errors.tamano)}>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {TAMANO_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.tamano ? (
                <p role="alert" className="text-sm text-destructive">{errors.tamano.message}</p>
              ) : null}
            </div>
          </div>

          {/* Fecha de nacimiento + Edad derivada */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="birthDate">Fecha de nacimiento</Label>
              <Controller
                control={control}
                name="birthDate"
                render={({ field: { ref: _ref, ...field } }) => (
                  <Input
                    id="birthDate"
                    type="date"
                    max={hoy}
                    disabled={esEdicion}
                    aria-describedby={esEdicion ? "birthDate-hint" : undefined}
                    {...field}
                  />
                )}
              />
              {esEdicion ? (
                <p id="birthDate-hint" className="text-xs text-muted-foreground">
                  La fecha de nacimiento no se puede modificar (RN-MA4).
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>Edad</Label>
              <Input
                readOnly
                disabled
                value={birthDateValue ? calcEdad(birthDateValue) : "—"}
                aria-label="Edad calculada automáticamente"
              />
            </div>
          </div>

          <TextField
            control={control} errors={errors} name="color" label="Pelaje"
            rules={{ maxLength: { value: 60, message: "Máximo 60 caracteres" } }}
          />

          <TextField
            control={control} errors={errors} name="alimentoDieta" label="Alimento / Dieta" multiline
            rules={{ maxLength: { value: 500, message: "Máximo 500 caracteres" } }}
          />

          <TextField
            control={control} errors={errors} name="observations" label="Observaciones" multiline
            rules={{ maxLength: { value: 1000, message: "Máximo 1000 caracteres" } }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {esEdicion ? "Guardar cambios" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── ClienteCombobox ──────────────────────────────────────────────────────────

function ClienteCombobox({
  value,
  onChange,
  invalid,
}: {
  value:    string;
  onChange: (val: string) => void;
  invalid?: boolean;
}) {
  const [open,     setOpen]     = useState(false);
  const [query,    setQuery]    = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selected, setSelected] = useState<Cliente | null>(null);

  useEffect(() => {
    listarClientes({ search: query || undefined, limit: 15 })
      .then(({ items }) => setClientes(items))
      .catch(() => setClientes([]));
  }, [query]);

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
          {selected?.fullName ?? (value ? "Cargando..." : "Buscar tutor...")}
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
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => handleSelect(c)}
                >
                  <Check
                    className={cn("mr-2 size-4", value === c.id ? "opacity-100" : "opacity-0")}
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

// ─── TextField (reutilizado del patrón ClienteFormDialog) ─────────────────────

function TextField({
  control,
  errors,
  name,
  label,
  rules,
  type,
  multiline,
}: {
  control:   Control<FormValues>;
  errors:    FieldErrors<FormValues>;
  name:      keyof FormValues;
  label:     string;
  rules?:    Omit<RegisterOptions<FormValues, keyof FormValues>, "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled">;
  type?:     string;
  multiline?: boolean;
}) {
  const error       = errors[name]?.message;
  const describedBy = error ? `${name}-error` : undefined;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Controller
        control={control}
        name={name}
        rules={rules}
        render={({ field: { ref: _ref, ...field } }) =>
          multiline ? (
            <Textarea
              id={name}
              rows={3}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              {...field}
            />
          ) : (
            <Input
              id={name}
              type={type}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              {...field}
            />
          )
        }
      />
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
