import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Controller, useForm, type Control, type FieldErrors } from "react-hook-form";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { usePlatformAuth } from "../../auth/PlatformAuthContext.tsx";
import { ApiError, type PlatformLoginInput } from "../../types/index.ts";

type FormValues = PlatformLoginInput;

const VACIO: FormValues = { email: "", password: "" };

/**
 * Mensaje del error del envelope.
 *
 * El backend responde el MISMO 401 para todo fracaso de credenciales —email
 * inexistente, contraseña equivocada, cuenta sin el claim de plataforma—, así
 * que acá tampoco se distingue: un único texto para los tres casos. Distinguir
 * "no sos Super Admin" de "contraseña incorrecta" le confirmaría al que prueba
 * que acertó la contraseña.
 */
function mensajeDeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      return "Demasiados intentos. Esperá unos minutos e intentá de nuevo.";
    }
    if (err.statusCode === 401 || err.statusCode === 403) {
      return "Credenciales inválidas.";
    }
    if (err.code === "NETWORK_ERROR") {
      return "No se pudo conectar con el servidor. Intentá de nuevo.";
    }
  }
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

/**
 * Login de la consola de plataforma.
 *
 * Pantalla propia y no una variante del login de la clínica: son identidades
 * distintas (email de Supabase Auth contra usuario de un tenant) y caminos
 * distintos en el backend. El fondo oscuro es el mismo del `AdminShell`, para
 * que se vea de entrada que esto no es una clínica sino el plano de control.
 */
export function PlatformLoginPage() {
  const { session, login } = usePlatformAuth();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: VACIO });

  // Ya hay sesión de plataforma: nada que hacer acá.
  if (session) {
    return <Navigate to="/admin/tenants" replace />;
  }

  async function onSubmit(values: FormValues) {
    setErrorMsg(null);
    try {
      await login({ email: values.email.trim(), password: values.password });
      // El éxito puebla la sesión; el <Navigate> de arriba entra a la consola
      // en el próximo render.
    } catch (err) {
      setErrorMsg(mensajeDeError(err));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 p-3 shadow-lg">
              <ShieldCheck className="size-9 text-white" aria-hidden />
            </div>
            <div>
              <div className="text-2xl font-semibold text-orange-800">Plataforma</div>
              <div className="text-sm text-muted-foreground">Consola Super Admin</div>
            </div>
          </div>
          <CardTitle className="text-lg font-semibold">Iniciar sesión</CardTitle>
          <CardDescription>Acceso restringido al equipo de plataforma.</CardDescription>
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
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
            />

            <Field
              control={control}
              errors={errors}
              name="password"
              label="Contraseña"
              type="password"
              autoComplete="current-password"
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
}: {
  control:      Control<FormValues>;
  errors:       FieldErrors<FormValues>;
  name:         keyof FormValues;
  label:        string;
  type?:        string;
  autoComplete?: string;
  autoFocus?:   boolean;
}) {
  const error = errors[name]?.message;
  const describedBy = error ? `${name}-error` : undefined;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Controller
        control={control}
        name={name}
        rules={{ required: `${label} es requerido` }}
        render={({ field: { ref: _ref, ...field } }) => (
          <Input
            id={name}
            type={type}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
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
