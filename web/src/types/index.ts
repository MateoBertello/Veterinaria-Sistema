// ─── Respuesta del envelope estándar ──────────────────────────────────────

export interface ApiMeta {
  page:  number;
  limit: number;
  total: number;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data:    T;
  meta?:   ApiMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code:       string;
    message:    string;
    statusCode: number;
    details:    unknown[];
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ─── Error tipado del cliente ──────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly code:       string,
    public readonly statusCode: number,
    message:                    string,
    public readonly details:    unknown[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── ErrorCode (mirror del backend) ───────────────────────────────────────

export const ErrorCode = {
  VALIDATION_ERROR:    "VALIDATION_ERROR",
  INTERNAL_ERROR:      "INTERNAL_ERROR",
  UNAUTHORIZED:        "UNAUTHORIZED",
  FORBIDDEN:           "FORBIDDEN",
  MODULE_NOT_LICENSED: "MODULE_NOT_LICENSED",
  TENANT_NOT_FOUND:    "TENANT_NOT_FOUND",
  DUPLICATE_DNI:       "DUPLICATE_DNI",
  CLIENT_HAS_PETS:     "CLIENT_HAS_PETS",
  MASCOTA_NOT_FOUND:   "MASCOTA_NOT_FOUND",
  PET_DECEASED:        "PET_DECEASED",
  SERVICE_NOT_FOUND:   "SERVICE_NOT_FOUND",
  TURNO_SOLAPADO:      "TURNO_SOLAPADO",
  STAY_OVERLAP:        "STAY_OVERLAP",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── Módulos vendibles ─────────────────────────────────────────────────────

export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia";

export interface ModuloContratado {
  modulo:     ModuloVendible;
  habilitado: boolean;
  fecha_alta: string | null;
}
