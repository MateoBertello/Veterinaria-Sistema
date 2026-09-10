import type { EsquemaValidacion, ReglaCampo, ResultadoValidacion } from "./types.ts";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HORA_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ALICUOTAS_IVA_VALIDAS = [0, 10.5, 21, 27] as const;

export function requerido(mensaje = "Este campo es requerido"): ReglaCampo<unknown> {
  return {
    nombre: "required",
    meta: { tipo: "required", required: true, minLength: 1 },
    validar: (v) => {
      if (v === undefined || v === null) return mensaje;
      if (typeof v === "string" && v.trim() === "") return mensaje;
      if (Array.isArray(v) && v.length === 0) return mensaje;
      return null;
    },
  };
}

export function minLongitud(min: number, mensaje?: string): ReglaCampo<string | null | undefined> {
  const msg = mensaje ?? `Debe tener al menos ${min} caracteres`;
  return {
    nombre: "minLength",
    meta: { tipo: "minLength", minLength: min },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      return v.trim().length < min ? msg : null;
    },
  };
}

export function maxLongitud(max: number, mensaje?: string): ReglaCampo<string | null | undefined> {
  const msg = mensaje ?? `Máximo ${max} caracteres`;
  return {
    nombre: "maxLength",
    meta: { tipo: "maxLength", maxLength: max },
    validar: (v) => {
      if (v === undefined || v === null) return null;
      return v.length > max ? msg : null;
    },
  };
}

export function minValor(min: number, mensaje?: string): ReglaCampo<number | string | null | undefined> {
  const msg = mensaje ?? `El valor mínimo es ${min}`;
  return {
    nombre: "min",
    meta: { tipo: "min", min },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const num = typeof v === "number" ? v : Number(v);
      if (isNaN(num)) return "Debe ser un número válido";
      return num < min ? msg : null;
    },
  };
}

export function maxValor(max: number, mensaje?: string): ReglaCampo<number | string | null | undefined> {
  const msg = mensaje ?? `El valor máximo es ${max}`;
  return {
    nombre: "max",
    meta: { tipo: "max", max },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const num = typeof v === "number" ? v : Number(v);
      if (isNaN(num)) return "Debe ser un número válido";
      return num > max ? msg : null;
    },
  };
}

export function positivo(mensaje = "Debe ser mayor a 0"): ReglaCampo<number | string | null | undefined> {
  return {
    nombre: "positive",
    meta: { tipo: "min", min: 0.0001 },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const num = typeof v === "number" ? v : Number(v);
      if (isNaN(num)) return "Debe ser un número válido";
      return num <= 0 ? mensaje : null;
    },
  };
}

export function noNegativo(mensaje = "Debe ser mayor o igual a 0"): ReglaCampo<number | string | null | undefined> {
  return minValor(0, mensaje);
}

export function entero(mensaje = "Debe ser un número entero"): ReglaCampo<number | string | null | undefined> {
  return {
    nombre: "integer",
    meta: { tipo: "integer" },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const num = typeof v === "number" ? v : Number(v);
      if (isNaN(num)) return "Debe ser un número válido";
      return Number.isInteger(num) ? null : mensaje;
    },
  };
}

export function uuid(mensaje = "Debe ser un identificador válido"): ReglaCampo<string | null | undefined> {
  return {
    nombre: "uuid",
    meta: { tipo: "uuid" },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      return UUID_REGEX.test(v) ? null : mensaje;
    },
  };
}

export function fechaIso(mensaje = "Formato de fecha inválido (YYYY-MM-DD)"): ReglaCampo<string | null | undefined> {
  return {
    nombre: "date",
    meta: { tipo: "date", pattern: FECHA_ISO_REGEX },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      if (!FECHA_ISO_REGEX.test(v)) return mensaje;
      const d = new Date(`${v}T00:00:00`);
      return isNaN(d.getTime()) ? mensaje : null;
    },
  };
}

export function horaHHMM(mensaje = "Formato de hora inválido (HH:MM)"): ReglaCampo<string | null | undefined> {
  return {
    nombre: "time",
    meta: { tipo: "pattern", pattern: HORA_HHMM_REGEX },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      return HORA_HHMM_REGEX.test(v) ? null : mensaje;
    },
  };
}

export function email(mensaje = "Formato de email inválido"): ReglaCampo<string | null | undefined> {
  return {
    nombre: "email",
    meta: { tipo: "email", pattern: EMAIL_REGEX },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      return EMAIL_REGEX.test(v) ? null : mensaje;
    },
  };
}

export function alicuotaIva(mensaje = "La alícuota debe ser 0, 10.50, 21 o 27"): ReglaCampo<number | string | null | undefined> {
  return {
    nombre: "alicuotaIva",
    meta: { tipo: "enum", enum: ALICUOTAS_IVA_VALIDAS },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const num = typeof v === "number" ? v : Number(v);
      return ALICUOTAS_IVA_VALIDAS.includes(num as any) ? null : mensaje;
    },
  };
}

export function decimalesMaximos(maxDecs: number, mensaje?: string): ReglaCampo<number | string | null | undefined> {
  const msg = mensaje ?? `Admite hasta ${maxDecs} decimales`;
  return {
    nombre: "maxDecimals",
    meta: { tipo: "decimal", maxDecimals: maxDecs },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      const str = String(v).trim();
      const dotIndex = str.indexOf(".");
      if (dotIndex !== -1 && str.length - dotIndex - 1 > maxDecs) {
        return msg;
      }
      return null;
    },
  };
}

export function enValores<U extends string | number>(valores: readonly U[], mensaje?: string): ReglaCampo<U | null | undefined> {
  const msg = mensaje ?? `Valor no permitido. Opciones: ${valores.join(", ")}`;
  return {
    nombre: "enum",
    meta: { tipo: "enum", enum: valores },
    validar: (v) => {
      if (v === undefined || v === null || (typeof v === "string" && v === "")) return null;
      return valores.includes(v as U) ? null : msg;
    },
  };
}

export function regex(pattern: RegExp, mensaje: string, nombre = "pattern"): ReglaCampo<string | null | undefined> {
  return {
    nombre,
    meta: { tipo: "pattern", pattern },
    validar: (v) => {
      if (v === undefined || v === null || v === "") return null;
      return pattern.test(v) ? null : mensaje;
    },
  };
}

export function validarCampo<T, K extends keyof T>(
  valor: T[K],
  reglas?: ReglaCampo<T[K]>[],
  contexto?: Record<string, unknown>,
): string | null {
  if (!reglas || reglas.length === 0) return null;
  for (const regla of reglas) {
    const error = regla.validar(valor, contexto);
    if (error) return error;
  }
  return null;
}

export function validarFormulario<T extends Record<string, any>>(
  valores: T,
  esquema: EsquemaValidacion<T>,
): ResultadoValidacion<T> {
  const errores: Partial<Record<keyof T, string>> = {};
  let valido = true;

  for (const campo of Object.keys(esquema) as (keyof T)[]) {
    const reglas = esquema[campo];
    if (reglas && reglas.length > 0) {
      const error = validarCampo(valores[campo], reglas, valores);
      if (error) {
        errores[campo] = error;
        valido = false;
      }
    }
  }

  return { valido, errores };
}
