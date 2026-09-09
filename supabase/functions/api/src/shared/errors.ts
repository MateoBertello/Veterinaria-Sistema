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
  /**
   * RN-SEC8: un usuario intentó cambiar sus PROPIOS campos de privilegio —el
   * rol o el estado activo—. Es distinto de LAST_ADMIN, que protege al tenant
   * de quedarse sin ningún administrador: acá el tenant puede tener diez
   * admins y la operación sigue siendo irreversible *desde la posición de
   * quien la ejecuta*. Un admin que se quita `manage_users` no puede
   * devolvérselo: necesita que otro admin lo rescate.
   */
  SELF_PRIVILEGE_CHANGE = "SELF_PRIVILEGE_CHANGE",

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
  /**
   * RN-HOR8: se intentó dar trabajo NUEVO a un profesional dado de baja
   * (`doctores.available=false`). Cubre todos los caminos de asignación, no
   * sólo el de Horarios donde nació la regla: crear/reactivar una franja,
   * agendar un turno, reasignar el profesional de un turno existente, y firmar
   * un evento clínico, una eutanasia o una aplicación de vacuna.
   *
   * La baja NO es destructiva: lo ya asignado sigue en pie (un turno agendado
   * antes de la baja se puede reprogramar sin cambiar de profesional, y el
   * historial que ese profesional firmó es inmutable).
   */
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

  // ── Catálogo comercial ────────────────────────────────────────────
  PRODUCT_CODE_DUPLICATE   = "PRODUCT_CODE_DUPLICATE",
  PRODUCT_NAME_DUPLICATE   = "PRODUCT_NAME_DUPLICATE",
  PRODUCT_NOT_FOUND        = "PRODUCT_NOT_FOUND",
  PRODUCT_IN_USE           = "PRODUCT_IN_USE",
  PRODUCT_INACTIVE         = "PRODUCT_INACTIVE",
  PRODUCT_WITHOUT_PRICE    = "PRODUCT_WITHOUT_PRICE",
  PRODUCT_NOT_SELLABLE     = "PRODUCT_NOT_SELLABLE",
  BARCODE_DUPLICATE        = "BARCODE_DUPLICATE",
  INVALID_TAX_RATE         = "INVALID_TAX_RATE",
  UNIT_NO_DECIMALS         = "UNIT_NO_DECIMALS",
  UNIT_INVALID_SCALE       = "UNIT_INVALID_SCALE",
  UNIT_IMMUTABLE           = "UNIT_IMMUTABLE",
  FAMILY_WITHOUT_BASE_UNIT = "FAMILY_WITHOUT_BASE_UNIT",
  FAMILY_NOT_FOUND         = "FAMILY_NOT_FOUND",

  // ── Proveedores ───────────────────────────────────────────────────
  SUPPLIER_DUPLICATE = "SUPPLIER_DUPLICATE",
  SUPPLIER_INACTIVE  = "SUPPLIER_INACTIVE",
  SUPPLIER_IN_USE    = "SUPPLIER_IN_USE",
  SUPPLIER_NOT_FOUND = "SUPPLIER_NOT_FOUND",

  // ── Existencias y lotes ───────────────────────────────────────────
  INSUFFICIENT_STOCK           = "INSUFFICIENT_STOCK",
  BATCH_NOT_FOUND              = "BATCH_NOT_FOUND",
  BATCH_EXPIRED                = "BATCH_EXPIRED",
  BATCH_BLOCKED                = "BATCH_BLOCKED",
  EXPIRY_REQUIRED              = "EXPIRY_REQUIRED",
  FEFO_OVERRIDE_WITHOUT_REASON = "FEFO_OVERRIDE_WITHOUT_REASON",
  MOVEMENT_IMMUTABLE           = "MOVEMENT_IMMUTABLE",
  REASON_REQUIRED              = "REASON_REQUIRED",
  INVALID_QUANTITY             = "INVALID_QUANTITY",
  STOCK_DRIFT_DETECTED         = "STOCK_DRIFT_DETECTED",

  // ── Compras ───────────────────────────────────────────────────────
  PURCHASE_ALREADY_CONFIRMED = "PURCHASE_ALREADY_CONFIRMED",
  PURCHASE_WITHOUT_ITEMS     = "PURCHASE_WITHOUT_ITEMS",
  PURCHASE_HAS_EXITS         = "PURCHASE_HAS_EXITS",
  PURCHASE_NOT_FOUND         = "PURCHASE_NOT_FOUND",
  SUPPLIER_INVOICE_DUPLICATE = "SUPPLIER_INVOICE_DUPLICATE",

  // ── Ventas ────────────────────────────────────────────────────────
  SALE_WITHOUT_ITEMS         = "SALE_WITHOUT_ITEMS",
  SALE_ALREADY_VOIDED        = "SALE_ALREADY_VOIDED",
  SALE_NOT_FOUND             = "SALE_NOT_FOUND",
  INVALID_ITEM_TYPE          = "INVALID_ITEM_TYPE",
  PAYMENT_MISMATCH           = "PAYMENT_MISMATCH",
  PAYMENT_REFERENCE_REQUIRED = "PAYMENT_REFERENCE_REQUIRED",
  PAYMENT_METHOD_DISABLED    = "PAYMENT_METHOD_DISABLED",
  RETURN_EXCEEDS_SOLD        = "RETURN_EXCEEDS_SOLD",
  RETURN_WITHOUT_SALE        = "RETURN_WITHOUT_SALE",

  // ── Caja ──────────────────────────────────────────────────────────
  CASH_SESSION_REQUIRED     = "CASH_SESSION_REQUIRED",
  CASH_SESSION_ALREADY_OPEN = "CASH_SESSION_ALREADY_OPEN",
  CASH_SESSION_CLOSED       = "CASH_SESSION_CLOSED",
  CASH_SESSION_NOT_FOUND    = "CASH_SESSION_NOT_FOUND",
  INVALID_OPENING_BALANCE   = "INVALID_OPENING_BALANCE",

  // ── Fraccionamiento ───────────────────────────────────────────────
  CONVERSION_NOT_DEFINED         = "CONVERSION_NOT_DEFINED",
  CONVERSION_NOT_FOUND           = "CONVERSION_NOT_FOUND",
  CONVERSION_CYCLE               = "CONVERSION_CYCLE",
  CONVERSION_REVERSE_NOT_ALLOWED = "CONVERSION_REVERSE_NOT_ALLOWED",
  INVALID_YIELD                  = "INVALID_YIELD",
  EXPIRY_AFTER_PARENT            = "EXPIRY_AFTER_PARENT",

  // ── Recuento ──────────────────────────────────────────────────────
  COUNT_ALREADY_APPLIED = "COUNT_ALREADY_APPLIED",
  COUNT_STALE           = "COUNT_STALE",
  COUNT_WITHOUT_DETAIL  = "COUNT_WITHOUT_DETAIL",
  COUNT_NOT_FOUND       = "COUNT_NOT_FOUND",

  // ── Reservados (sin uso todavía) ──────────────────────────────────
  PRESCRIPTION_REQUIRED   = "PRESCRIPTION_REQUIRED",
  CREDIT_ACCOUNT_DISABLED = "CREDIT_ACCOUNT_DISABLED",
  CREDIT_LIMIT_EXCEEDED   = "CREDIT_LIMIT_EXCEEDED",
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
