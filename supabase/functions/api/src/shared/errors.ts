export enum ErrorCode {
  // ── Validaciones globales ─────────────────────────────────────────
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR   = "INTERNAL_ERROR",

  // ── Super Admin / Plataforma ──────────────────────────────────────
  TENANT_NOT_FOUND       = "TENANT_NOT_FOUND",
  TENANT_DUPLICATE_TAXID = "TENANT_DUPLICATE_TAXID",
  TENANT_SUSPENDED       = "TENANT_SUSPENDED",
  MODULE_UNKNOWN         = "MODULE_UNKNOWN",
  MODULE_NOT_LICENSED    = "MODULE_NOT_LICENSED",

  // ── Autenticación / Autorización ──────────────────────────────────
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN    = "FORBIDDEN",

  // ── Usuarios ──────────────────────────────────────────────────────
  DUPLICATE_USER = "DUPLICATE_USER",
  LAST_ADMIN     = "LAST_ADMIN",

  // ── Clientes ──────────────────────────────────────────────────────
  DUPLICATE_DNI  = "DUPLICATE_DNI",
  CLIENT_HAS_PETS = "CLIENT_HAS_PETS",

  // ── Mascotas ──────────────────────────────────────────────────────
  MASCOTA_NOT_FOUND = "MASCOTA_NOT_FOUND",
  PET_DECEASED      = "PET_DECEASED",
  SAME_OWNER        = "SAME_OWNER",

  // ── Servicios ─────────────────────────────────────────────────────
  SERVICE_NOT_FOUND = "SERVICE_NOT_FOUND",
  SERVICE_IN_USE    = "SERVICE_IN_USE",

  // ── Configuración ─────────────────────────────────────────────────
  CONFIG_NOT_FOUND = "CONFIG_NOT_FOUND",

  // ── Turnos ────────────────────────────────────────────────────────
  PAST_DATE             = "PAST_DATE",
  TURNO_NOT_FOUND       = "TURNO_NOT_FOUND",
  TURNO_SOLAPADO        = "TURNO_SOLAPADO",
  DUPLICATE_APPOINTMENT = "DUPLICATE_APPOINTMENT",
  APPOINTMENT_LOCKED    = "APPOINTMENT_LOCKED",
  INVALID_TRANSITION    = "INVALID_TRANSITION",

  // ── Guardería ─────────────────────────────────────────────────────
  ESTADIA_NOT_FOUND      = "ESTADIA_NOT_FOUND",
  STAY_OVERLAP           = "STAY_OVERLAP",
  STAY_LOCKED            = "STAY_LOCKED",
  CUPO_GUARDERIA_AGOTADO = "CUPO_GUARDERIA_AGOTADO",

  // ── Historial Clínico ─────────────────────────────────────────────
  EMPTY_HISTORY                    = "EMPTY_HISTORY",
  HISTORIAL_NOT_FOUND              = "HISTORIAL_NOT_FOUND",
  EUTHANASIA_CONFIRMATION_REQUIRED = "EUTHANASIA_CONFIRMATION_REQUIRED",
  INVALID_FILE_TYPE                = "INVALID_FILE_TYPE",
  FILE_TOO_LARGE                   = "FILE_TOO_LARGE",

  // ── Plan de Vacunación ────────────────────────────────────────────
  VACCINE_TYPE_NOT_FOUND       = "VACCINE_TYPE_NOT_FOUND",
  VACCINE_PLAN_ALREADY_APPLIED = "VACCINE_PLAN_ALREADY_APPLIED",

  // ── Horarios ──────────────────────────────────────────────────────
  INVALID_RANGE    = "INVALID_RANGE",
  SCHEDULE_OVERLAP = "SCHEDULE_OVERLAP",

  // ── Notificaciones ────────────────────────────────────────────────
  NOTIFICATION_PROVIDER_NOT_CONFIGURED = "NOTIFICATION_PROVIDER_NOT_CONFIGURED",
}

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}
