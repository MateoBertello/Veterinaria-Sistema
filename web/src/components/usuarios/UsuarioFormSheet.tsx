import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
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
import {
  ApiError,
  ErrorCode,
  type CrearUsuarioInput,
  type EditarUsuarioInput,
  type Rol,
  type Usuario,
} from "../../types/index.ts";

interface FormValues {
  username: string;
  password: string;
  fullName: string;
  email:    string;
  phone:    string;
  roleId:   string;
}

const VACIO: FormValues = {
  username: "",
  password: "",
  fullName: "",
  email:    "",
  phone:    "",
  roleId:   "",
};

// Espejo de CrearUsuarioSchema: pattern y mensajes idénticos al backend para que
// el front no permita enviar lo que el server rechazaría.
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Teléfono opcional: números y separadores comunes (+ - ( ) y espacios).
const PHONE_PATTERN = /^\+?[\d\s()-]{6,20}$/;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Usuario a editar; si es undefined/null, es alta. */
  usuario?: Usuario | null;
  /**
   * RN-SEC8: el usuario que se está editando es el propio usuario logueado. El
   * selector de rol queda deshabilitado con la explicación a la vista — el
   * backend lo rechaza con SELF_PRIVILEGE_CHANGE y un control que existe y
   * falla al usarlo es peor que uno que no está. El resto del formulario
   * (nombre, usuario, email, teléfono) sigue editable.
   */
  esUnoMismo?: boolean;
  roles: Rol[];
  onSaved: (usuario: Usuario) => void;
  crear: (input: CrearUsuarioInput) => Promise<Usuario>;
  editar: (id: string, input: EditarUsuarioInput) => Promise<Usuario>;
}

export function UsuarioFormSheet({ open, onOpenChange, usuario, esUnoMismo = false, roles, onSaved, crear, editar }: Props) {
  const esEdicion = Boolean(usuario);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  useEffect(() => {
    if (!open) return;
    setShowPassword(false);
    reset(
      usuario
        ? {
            username: usuario.username,
            password: "",
            fullName: usuario.fullName,
            email:    usuario.email,
            phone:    usuario.phone ?? "",
            roleId:   usuario.rolId,
          }
        : VACIO,
    );
  }, [open, usuario, reset]);

  async function onSubmit(values: FormValues) {
    const phone = values.phone.trim();

    try {
      let guardado: Usuario;
      if (esEdicion) {
        // PUT parcial (sin password; el estado activo se maneja aparte).
        const input: EditarUsuarioInput = {
          username: values.username.trim(),
          fullName: values.fullName.trim(),
          email:    values.email.trim(),
          phone:    phone || undefined,
          roleId:   values.roleId,
        };
        guardado = await editar(usuario!.id, input);
      } else {
        const input: CrearUsuarioInput = {
          username: values.username.trim(),
          password: values.password,
          fullName: values.fullName.trim(),
          email:    values.email.trim(),
          phone:    phone || undefined,
          roleId:   values.roleId,
          active:   true,
        };
        guardado = await crear(input);
      }
      toast.success(esEdicion ? "Usuario actualizado" : "Usuario creado");
      onSaved(guardado);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.DUPLICATE_USER) {
        // RN-SEC4: el backend distingue username vs email por el mensaje.
        const campo = /email|correo/i.test(err.message) ? "email" : "username";
        setError(campo, { type: "server", message: err.message });
        return;
      }
      const message = err instanceof ApiError ? err.message : "Ocurrió un error inesperado";
      toast.error(message);
    }
  }

  const errUsername = errors.username?.message;
  const errPassword = errors.password?.message;
  const errFullName = errors.fullName?.message;
  const errEmail    = errors.email?.message;
  const errPhone    = errors.phone?.message;
  const errRole     = errors.roleId?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{esEdicion ? "Editar usuario" : "Nuevo usuario"}</SheetTitle>
          <SheetDescription>
            Los campos marcados con * son obligatorios.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 px-4" noValidate>
          {/* Nombre completo */}
          <div className="grid gap-1.5">
            <Label htmlFor="fullName">Nombre completo *</Label>
            <Controller
              control={control}
              name="fullName"
              rules={{
                required: "El nombre completo es requerido",
                maxLength: { value: 150, message: "Máximo 150 caracteres" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="fullName"
                  autoComplete="off"
                  aria-invalid={Boolean(errFullName)}
                  aria-describedby={errFullName ? "fullName-error" : undefined}
                  {...field}
                />
              )}
            />
            {errFullName ? (
              <p id="fullName-error" role="alert" className="text-sm text-destructive">{errFullName}</p>
            ) : null}
          </div>

          {/* Usuario */}
          <div className="grid gap-1.5">
            <Label htmlFor="username">Usuario *</Label>
            <Controller
              control={control}
              name="username"
              rules={{
                required: "El usuario es requerido",
                minLength: { value: 3, message: "El usuario debe tener al menos 3 caracteres" },
                maxLength: { value: 50, message: "Máximo 50 caracteres" },
                pattern: { value: USERNAME_PATTERN, message: "Solo letras, números, _, . y -" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="username"
                  autoComplete="off"
                  aria-invalid={Boolean(errUsername)}
                  aria-describedby={errUsername ? "username-error" : undefined}
                  {...field}
                />
              )}
            />
            {errUsername ? (
              <p id="username-error" role="alert" className="text-sm text-destructive">{errUsername}</p>
            ) : null}
          </div>

          {/* Email */}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email *</Label>
            <Controller
              control={control}
              name="email"
              rules={{
                required: "El email es requerido",
                pattern: { value: EMAIL_PATTERN, message: "Formato de email inválido" },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="email"
                  type="email"
                  autoComplete="off"
                  aria-invalid={Boolean(errEmail)}
                  aria-describedby={errEmail ? "email-error" : undefined}
                  {...field}
                />
              )}
            />
            {errEmail ? (
              <p id="email-error" role="alert" className="text-sm text-destructive">{errEmail}</p>
            ) : null}
          </div>

          {/* Contraseña — solo en el alta (el backend no la edita por este endpoint) */}
          {esEdicion ? null : (
            <div className="grid gap-1.5">
              <Label htmlFor="password">Contraseña *</Label>
              <Controller
                control={control}
                name="password"
                rules={{
                  required: "La contraseña es requerida",
                  minLength: { value: 8, message: "La contraseña debe tener al menos 8 caracteres" },
                }}
                render={({ field: { ref: _ref, ...field } }) => (
                  <div className="flex gap-2">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      aria-invalid={Boolean(errPassword)}
                      aria-describedby={errPassword ? "password-error" : undefined}
                      {...field}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </Button>
                  </div>
                )}
              />
              {errPassword ? (
                <p id="password-error" role="alert" className="text-sm text-destructive">{errPassword}</p>
              ) : null}
            </div>
          )}

          {/* Teléfono (opcional) */}
          <div className="grid gap-1.5">
            <Label htmlFor="phone">Teléfono</Label>
            <Controller
              control={control}
              name="phone"
              rules={{
                validate: (v: string) => {
                  const t = (v ?? "").trim();
                  return (
                    t === "" ||
                    PHONE_PATTERN.test(t) ||
                    "El teléfono solo admite números y los símbolos + - ( ) y espacios"
                  );
                },
              }}
              render={({ field: { ref: _ref, ...field } }) => (
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="off"
                  aria-invalid={Boolean(errPhone)}
                  aria-describedby={errPhone ? "phone-error" : undefined}
                  {...field}
                />
              )}
            />
            {errPhone ? (
              <p id="phone-error" role="alert" className="text-sm text-destructive">{errPhone}</p>
            ) : null}
          </div>

          {/* Rol */}
          <div className="grid gap-1.5">
            <Label htmlFor="roleId">Rol *</Label>
            <Controller
              control={control}
              name="roleId"
              rules={{ required: "El rol es requerido" }}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={esUnoMismo}>
                  <SelectTrigger
                    id="roleId"
                    disabled={esUnoMismo}
                    aria-invalid={Boolean(errRole)}
                    aria-describedby={errRole ? "roleId-error" : "roleId-hint"}
                  >
                    <SelectValue placeholder="Seleccionar rol…" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p id="roleId-hint" className="text-sm text-muted-foreground">
              {esUnoMismo
                ? "No podés cambiar tu propio rol: pedíselo a otro administrador."
                : "El rol determina los permisos de acceso al sistema."}
            </p>
            {errRole ? (
              <p id="roleId-error" role="alert" className="text-sm text-destructive">{errRole}</p>
            ) : null}
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {esEdicion ? "Guardar cambios" : "Crear usuario"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
