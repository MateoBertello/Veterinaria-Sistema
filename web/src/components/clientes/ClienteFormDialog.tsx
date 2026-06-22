import { useEffect } from "react";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type RegisterOptions,
} from "react-hook-form";
import { toast } from "sonner";
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
import { ApiError, ErrorCode, type Cliente, type ClienteInput } from "../../types/index.ts";

// Mismas validaciones que el schema Zod del backend (fuente de verdad, RN-CL6).
const DNI_CUIT_REGEX = /^[\d-]+$/;
const PHONE_REGEX = /^[\d+\-\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormValues = ClienteInput;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliente a editar; si es undefined, es alta. */
  cliente?: Cliente | null;
  onSaved: (cliente: Cliente) => void;
  /** Inyectable para tests; por defecto usa la capa de datos real. */
  crear: (input: ClienteInput) => Promise<Cliente>;
  editar: (id: string, input: ClienteInput) => Promise<Cliente>;
}

const VACIO: FormValues = {
  fullName: "",
  dniCuit: "",
  phone: "",
  address: "",
  email: "",
  observations: "",
};

export function ClienteFormDialog({ open, onOpenChange, cliente, onSaved, crear, editar }: Props) {
  const esEdicion = Boolean(cliente);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  // Sincroniza el formulario al abrir / cambiar de cliente.
  useEffect(() => {
    if (!open) return;
    reset(
      cliente
        ? {
            fullName: cliente.fullName ?? "",
            dniCuit: cliente.dniCuit ?? "",
            phone: cliente.phone ?? "",
            address: cliente.address ?? "",
            email: cliente.email ?? "",
            observations: cliente.observations ?? "",
          }
        : VACIO,
    );
  }, [open, cliente, reset]);

  async function onSubmit(values: FormValues) {
    // Los opcionales vacíos viajan como undefined (no como cadena vacía).
    const input: ClienteInput = {
      fullName: values.fullName.trim(),
      dniCuit: values.dniCuit.trim(),
      phone: values.phone.trim(),
      address: values.address.trim(),
      email: values.email?.trim() || undefined,
      observations: values.observations?.trim() || undefined,
    };

    try {
      const guardado = esEdicion
        ? await editar(cliente!.id, input)
        : await crear(input);
      toast.success(esEdicion ? "Cliente actualizado" : "Cliente registrado");
      onSaved(guardado);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.DUPLICATE_DNI) {
        // RN-CL3: el envelope marca el DNI/CUIT duplicado → error en el campo.
        setError("dniCuit", { type: "server", message: err.message });
        return;
      }
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esEdicion ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          <DialogDescription>
            Los campos marcados con * son obligatorios.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <TextField
            control={control}
            errors={errors}
            name="fullName"
            label="Nombre completo *"
            rules={{
              required: "El nombre completo es requerido",
              maxLength: { value: 150, message: "Máximo 150 caracteres" },
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={control}
              errors={errors}
              name="dniCuit"
              label="DNI/CUIT *"
              rules={{
                required: "El DNI/CUIT es requerido",
                maxLength: { value: 20, message: "Máximo 20 caracteres" },
                pattern: { value: DNI_CUIT_REGEX, message: "Solo dígitos y guiones" },
              }}
            />
            <TextField
              control={control}
              errors={errors}
              name="phone"
              label="Teléfono *"
              rules={{
                required: "El teléfono es requerido",
                maxLength: { value: 30, message: "Máximo 30 caracteres" },
                pattern: { value: PHONE_REGEX, message: "Solo números, +, - y espacios" },
              }}
            />
          </div>

          <TextField
            control={control}
            errors={errors}
            name="address"
            label="Dirección *"
            rules={{
              required: "La dirección es requerida",
              maxLength: { value: 200, message: "Máximo 200 caracteres" },
            }}
          />

          <TextField
            control={control}
            errors={errors}
            name="email"
            label="Email"
            type="email"
            rules={{
              maxLength: { value: 150, message: "Máximo 150 caracteres" },
              pattern: { value: EMAIL_REGEX, message: "Formato de email inválido" },
            }}
          />

          <TextField
            control={control}
            errors={errors}
            name="observations"
            label="Observaciones"
            multiline
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

/**
 * Campo controlado vía RHF Controller. El kit Input/Textarea no es forwardRef,
 * por eso no se usa `register` (su ref se perdería): el control es por value/onChange.
 */
function TextField({
  control,
  errors,
  name,
  label,
  rules,
  type,
  multiline,
}: {
  control: Control<FormValues>;
  errors: FieldErrors<FormValues>;
  name: keyof FormValues;
  label: string;
  rules?: Omit<
    RegisterOptions<FormValues, keyof FormValues>,
    "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
  >;
  type?: string;
  multiline?: boolean;
}) {
  const error = errors[name]?.message;
  const describedBy = error ? `${name}-error` : undefined;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Controller
        control={control}
        name={name}
        rules={rules}
        render={({ field: { ref: _ref, ...field } }) =>
          // El kit Input/Textarea no es forwardRef: se omite `ref` para no
          // disparar el warning "Function components cannot be given refs".
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
