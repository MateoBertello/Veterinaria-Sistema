import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { PLAN_META } from "../../lib/planes.ts";
import {
  ApiError,
  ErrorCode,
  PLANES_TENANT,
  type CrearTenantInput,
  type EditarTenantInput,
  type PlanTenant,
  type Tenant,
} from "../../types/index.ts";

interface FormValues {
  nombre:        string;
  cuitRut:       string;
  emailContacto: string;
  plan:          PlanTenant;
}

const VACIO: FormValues = {
  nombre:        "",
  cuitRut:       "",
  emailContacto: "",
  plan:          "basico",
};

// Espejo de CrearTenantSchema/EditarTenantSchema: los mismos límites que valida
// el backend, para no dejar enviar lo que el server rechazaría con 422.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tenant a editar; si es null/undefined, es alta. */
  tenant?: Tenant | null;
  onSaved: (tenant: Tenant) => void;
  crear:  (input: CrearTenantInput) => Promise<Tenant>;
  editar: (id: string, input: EditarTenantInput) => Promise<Tenant>;
}

/**
 * Alta y edición de tenant en un único formulario (Addendum: "mínimos clics").
 * En edición el CUIT/RUT queda de solo lectura: es la clave fiscal única de la
 * plataforma (RN-SA1) y `EditarTenantSchema` ni siquiera la acepta.
 */
export function TenantFormSheet({ open, onOpenChange, tenant, onSaved, crear, editar }: Props) {
  const esEdicion = Boolean(tenant);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (!open) return;
    reset(
      tenant
        ? {
            nombre:        tenant.nombre,
            cuitRut:       tenant.cuitRut,
            emailContacto: tenant.emailContacto,
            plan:          tenant.plan,
          }
        : VACIO,
    );
  }, [open, tenant, reset]);

  async function onSubmit(values: FormValues) {
    try {
      let guardado: Tenant;
      if (esEdicion) {
        guardado = await editar(tenant!.id, {
          nombre:        values.nombre.trim(),
          emailContacto: values.emailContacto.trim(),
          plan:          values.plan,
        });
      } else {
        guardado = await crear({
          nombre:        values.nombre.trim(),
          cuitRut:       values.cuitRut.trim(),
          emailContacto: values.emailContacto.trim(),
          plan:          values.plan,
        });
      }
      toast.success(esEdicion ? "Clínica actualizada" : "Clínica creada");
      onSaved(guardado);
      onOpenChange(false);
    } catch (err) {
      // RN-SA1: el CUIT/RUT es único en la plataforma → error inline en el campo.
      if (err instanceof ApiError && err.code === ErrorCode.TENANT_DUPLICATE_TAXID) {
        setError("cuitRut", { type: "server", message: err.message });
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Ocurrió un error inesperado");
    }
  }

  const errNombre  = errors.nombre?.message;
  const errCuit    = errors.cuitRut?.message;
  const errEmail   = errors.emailContacto?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar clínica" : "Nuevo tenant"}</SheetTitle>
          <SheetDescription>
            Los campos marcados con * son obligatorios.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 px-4" noValidate>
          {/* Nombre */}
          <div className="grid gap-1.5">
            <Label htmlFor="nombre">Nombre de la clínica *</Label>
            <Controller
              control={control}
              name="nombre"
              rules={{
                required: "El nombre es requerido",
                minLength: { value: 3, message: "El nombre debe tener al menos 3 caracteres" },
                maxLength: { value: 120, message: "Máximo 120 caracteres" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="nombre"
                  autoComplete="off"
                  aria-invalid={Boolean(errNombre)}
                  aria-describedby={errNombre ? "nombre-error" : undefined}
                  {...field}
                />
              )}
            />
            {errNombre ? (
              <p id="nombre-error" role="alert" className="text-sm text-destructive">{errNombre}</p>
            ) : null}
          </div>

          {/* CUIT/RUT — inmutable en edición (RN-SA1) */}
          <div className="grid gap-1.5">
            <Label htmlFor="cuitRut">CUIT / RUT *</Label>
            <Controller
              control={control}
              name="cuitRut"
              rules={
                esEdicion
                  ? {}
                  : {
                      required: "El CUIT/RUT es requerido",
                      maxLength: { value: 20, message: "Máximo 20 caracteres" },
                    }
              }
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="cuitRut"
                  autoComplete="off"
                  readOnly={esEdicion}
                  disabled={esEdicion}
                  aria-invalid={Boolean(errCuit)}
                  aria-describedby={errCuit ? "cuitRut-error" : "cuitRut-help"}
                  {...field}
                />
              )}
            />
            <p id="cuitRut-help" className="text-sm text-muted-foreground">
              {esEdicion
                ? "El CUIT/RUT identifica a la clínica en la plataforma y no se puede modificar."
                : "Debe ser único en toda la plataforma."}
            </p>
            {errCuit ? (
              <p id="cuitRut-error" role="alert" className="text-sm text-destructive">{errCuit}</p>
            ) : null}
          </div>

          {/* Email de contacto */}
          <div className="grid gap-1.5">
            <Label htmlFor="emailContacto">Email de contacto *</Label>
            <Controller
              control={control}
              name="emailContacto"
              rules={{
                required: "El email de contacto es requerido",
                pattern: { value: EMAIL_PATTERN, message: "Formato de email inválido" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="emailContacto"
                  type="email"
                  autoComplete="off"
                  aria-invalid={Boolean(errEmail)}
                  aria-describedby={errEmail ? "emailContacto-error" : "emailContacto-help"}
                  {...field}
                />
              )}
            />
            <p id="emailContacto-help" className="text-sm text-muted-foreground">
              A esta casilla se envía la invitación del administrador de la clínica.
            </p>
            {errEmail ? (
              <p id="emailContacto-error" role="alert" className="text-sm text-destructive">{errEmail}</p>
            ) : null}
          </div>

          {/* Plan */}
          <div className="grid gap-1.5">
            <Label htmlFor="plan">Plan *</Label>
            <Controller
              control={control}
              name="plan"
              rules={{ required: "El plan es requerido" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="plan">
                    <SelectValue placeholder="Seleccionar plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PLANES_TENANT.map((p) => (
                      <SelectItem key={p} value={p}>{PLAN_META[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-sm text-muted-foreground">
              El plan define qué módulos quedan habilitados al crear la clínica.
            </p>
          </div>

          {esEdicion ? null : (
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Se crearán automáticamente los roles base, la configuración inicial y los módulos del
              plan, y se invitará por email al administrador de la clínica.
            </p>
          )}

          <SheetFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {esEdicion ? "Guardar cambios" : "Crear tenant"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
