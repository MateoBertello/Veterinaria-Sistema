import { useState } from "react";
import { Navigate, useLocation, type Location } from "react-router-dom";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type RegisterOptions,
} from "react-hook-form";
import { Dog, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { useAuth } from "../auth/AuthContext.tsx";
import { getPlatformSession } from "../lib/platform.ts";
import { ApiError, type LoginInput } from "../types/index.ts";

type FormValues = LoginInput;

const VACIO: FormValues = { username: "", password: "" };

/** Traduce el error del envelope a un mensaje genérico (RN-AUT1: nunca revela si falló el usuario o la contraseña). */
function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      return "Demasiados intentos. Esperá unos minutos e intentá de nuevo.";
    }
    if (err.statusCode === 401) {
      return "Usuario o contraseña incorrectos.";
    }
    if (err.code === "NETWORK_ERROR") {
      return "No se pudo conectar con el servidor. Intentá de nuevo.";
    }
  }
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  // Sesión de PLATAFORMA activa (claim super_admin): su lugar es la consola, no
  // el shell del tenant. "Cerrar sesión" en la consola limpia el token y devuelve
  // a este formulario.
  if (getPlatformSession()) {
    return <Navigate to="/admin/tenants" replace />;
  }

  // Ya autenticado: nada que hacer en /login → al destino previo o al panel de inicio.
  if (status === "authenticated") {
    const from = (location.state as { from?: Location } | null)?.from?.pathname;
    return <Navigate to={from ?? "/"} replace />;
  }

  async function onSubmit(values: FormValues) {
    setErrorMsg(null);
    try {
      await login({
        username: values.username.trim(),
        password: values.password,
      });
      // El éxito cambia el status a "authenticated"; el <Navigate> de arriba
      // redirige al destino preservado en el próximo render.
    } catch (err) {
      setErrorMsg(mensajeDeError(err));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 p-3 shadow-lg">
              <Dog className="size-9 text-white" aria-hidden />
            </div>
            <div>
              <div className="text-2xl font-semibold text-orange-800">Veterinaria Leo</div>
              <div className="text-sm text-muted-foreground">Sistema de Gestión Profesional</div>
            </div>
          </div>
          <CardTitle className="text-lg font-semibold">Iniciar sesión</CardTitle>
          <CardDescription>Ingresá tus credenciales para continuar.</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            {errorMsg ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {errorMsg}
              </p>
            ) : null}

            <Field
              control={control}
              errors={errors}
              name="username"
              label="Usuario"
              autoComplete="username"
              autoFocus
              rules={{ required: "El usuario es requerido" }}
            />

            <Field
              control={control}
              errors={errors}
              name="password"
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              rules={{ required: "La contraseña es requerida" }}
            />

            <Button type="submit" disabled={isSubmitting} className="mt-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Ingresando…
                </>
              ) : (
                "Iniciar sesión"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Campo controlado vía RHF Controller. El kit Input no es forwardRef, por eso no
 * se usa `register` (su ref se perdería): el control es por value/onChange.
 */
function Field({
  control,
  errors,
  name,
  label,
  type,
  autoComplete,
  autoFocus,
  rules,
}: {
  control: Control<FormValues>;
  errors: FieldErrors<FormValues>;
  name: keyof FormValues;
  label: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  rules?: Omit<
    RegisterOptions<FormValues, keyof FormValues>,
    "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled"
  >;
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
        render={({ field: { ref: _ref, ...field } }) => (
          <Input
            id={name}
            type={type}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            {...field}
          />
        )}
      />
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
