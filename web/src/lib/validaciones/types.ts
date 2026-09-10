/**
 * Tipos base para el módulo desacoplado de validaciones del frontend.
 *
 * No depende de librerías externas (como Zod) en tiempo de ejecución en el cliente,
 * permitiendo compilar web/ de forma aislada y liviana, mientras expone metadatos
 * inspeccionables para el test de contrato contra los schemas del backend.
 */

export type TipoRegla =
  | "required"
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "pattern"
  | "email"
  | "uuid"
  | "date"
  | "enum"
  | "integer"
  | "decimal"
  | "custom";

export interface ReglaMeta {
  tipo: TipoRegla;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: readonly (string | number)[];
  maxDecimals?: number;
  [key: string]: unknown;
}

export interface ReglaCampo<T = unknown> {
  nombre: string;
  meta: ReglaMeta;
  validar: (valor: T, contexto?: Record<string, unknown>) => string | null;
}

export type EsquemaValidacion<T> = {
  [K in keyof T]?: ReglaCampo<T[K]>[];
};

export interface ResultadoValidacion<T> {
  valido: boolean;
  errores: Partial<Record<keyof T, string>>;
}
