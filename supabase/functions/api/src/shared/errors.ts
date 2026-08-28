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
  /** Rate limit del login agotado (RN-AUT5). Antes viajaba como UNAUTHORIZED con status 429. */
  RATE_LIMITED = "RATE_LIMITED",
  /**
   * El identificador de login existe en más de un tenant y no alcanza para
   * elegir cuál. El username es único POR TENANT, así que dos clínicas pueden
   * tener su propio `admin`; en ese caso hay que entrar con el email.
   */
  AMBIGUOUS_IDENTIFIER = "AMBIGUOUS_IDENTIFIER",

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
  /**
   * RN-MA11: la especie de una mascota es inmutable una vez creada. De ella
   * cuelgan `razaId` (una raza pertenece a UNA especie) y el catálogo de
   * vacunas aplicables (`especie_tipo_vacuna`, RN-PV11); cambiarla dejaría esas
   * relaciones — y el historial clínico ya registrado — interpretadas bajo una
   * especie distinta de la que tenían. Se rechaza cualquier intento de cambio,
   * en vez de ignorarlo en silencio.
   */
  SPECIES_IMMUTABLE = "SPECIES_IMMUTABLE",

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
  STAY_NOT_FOUND         = "STAY_NOT_FOUND",
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
  VACCINE_PLAN_NOT_FOUND       = "VACCINE_PLAN_NOT_FOUND",
  VACCINE_PLAN_ALREADY_APPLIED = "VACCINE_PLAN_ALREADY_APPLIED",
  /**
   * RN-PV11: el tipo de vacuna existe y está activo en el catálogo de la
   * clínica, pero no está asociado a la especie de la mascota
   * (`especie_tipo_vacuna`). Distinto de VACCINE_TYPE_NOT_FOUND, que es "no
   * está en el catálogo": acá el problema es la combinación, no la vacuna.
   */
  VACCINE_NOT_APPLICABLE_TO_SPECIES = "VACCINE_NOT_APPLICABLE_TO_SPECIES",

  // ── Horarios ──────────────────────────────────────────────────────
  INVALID_RANGE    = "INVALID_RANGE",
  SCHEDULE_OVERLAP = "SCHEDULE_OVERLAP",
  /** RN-HOR8: crear o reactivar una franja de un profesional dado de baja (`doctores.available=false`). */
  DOCTOR_INACTIVE  = "DOCTOR_INACTIVE",

  // ── Notificaciones ────────────────────────────────────────────────
  NOTIFICATION_PROVIDER_NOT_CONFIGURED = "NOTIFICATION_PROVIDER_NOT_CONFIGURED",

  // ── Catálogos clínicos (especies, razas, tipos de vacuna) ─────────
  /** El ítem no existe en el catálogo DE ESTE tenant (RN-CAT1). */
  CATALOG_NOT_FOUND = "CATALOG_NOT_FOUND",
  /** Ya hay un ítem con ese nombre en el catálogo del tenant (RN-CAT2). */
  CATALOG_DUPLICATE = "CATALOG_DUPLICATE",
  /**
   * El ítem está referenciado por datos de negocio del tenant y no se puede
   * dar de baja (RN-CAT5). También cubre reactivar una raza cuya especie está
   * inactiva (RN-CAT7): en los dos casos el estado pedido choca con una
   * relación existente.
   */
  CATALOG_IN_USE = "CATALOG_IN_USE",
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
