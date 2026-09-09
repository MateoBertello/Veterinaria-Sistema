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
  SAME_OWNER:          "SAME_OWNER",
  SERVICE_NOT_FOUND:   "SERVICE_NOT_FOUND",
  SERVICE_IN_USE:      "SERVICE_IN_USE",
  CONFIG_NOT_FOUND:    "CONFIG_NOT_FOUND",
  TURNO_SOLAPADO:      "TURNO_SOLAPADO",
  TURNO_NOT_FOUND:        "TURNO_NOT_FOUND",
  APPOINTMENT_LOCKED:     "APPOINTMENT_LOCKED",
  INVALID_TRANSITION:     "INVALID_TRANSITION",
  PAST_DATE:              "PAST_DATE",
  DUPLICATE_APPOINTMENT:  "DUPLICATE_APPOINTMENT",
  STAY_OVERLAP:        "STAY_OVERLAP",
  STAY_LOCKED:         "STAY_LOCKED",
  STAY_NOT_FOUND:      "STAY_NOT_FOUND",
  CUPO_GUARDERIA_AGOTADO: "CUPO_GUARDERIA_AGOTADO",
  INVALID_RANGE:       "INVALID_RANGE",
  SCHEDULE_OVERLAP:    "SCHEDULE_OVERLAP",
  /** RN-HOR8: se intentó asignar trabajo nuevo a un profesional dado de baja. */
  DOCTOR_INACTIVE:     "DOCTOR_INACTIVE",
  EMPTY_HISTORY:                    "EMPTY_HISTORY",
  HISTORIAL_NOT_FOUND:              "HISTORIAL_NOT_FOUND",
  EUTHANASIA_CONFIRMATION_REQUIRED: "EUTHANASIA_CONFIRMATION_REQUIRED",
  INVALID_FILE_TYPE:                "INVALID_FILE_TYPE",
  FILE_TOO_LARGE:                   "FILE_TOO_LARGE",
  VACCINE_TYPE_NOT_FOUND:           "VACCINE_TYPE_NOT_FOUND",
  /** RN-PV11: la vacuna existe pero no aplica a la especie de la mascota. */
  VACCINE_NOT_APPLICABLE_TO_SPECIES: "VACCINE_NOT_APPLICABLE_TO_SPECIES",
  VACCINE_PLAN_ALREADY_APPLIED:     "VACCINE_PLAN_ALREADY_APPLIED",
  DUPLICATE_USER:                   "DUPLICATE_USER",
  LAST_ADMIN:                       "LAST_ADMIN",
  /** RN-SEC8: un usuario intentó cambiar su propio rol o su propio estado. */
  SELF_PRIVILEGE_CHANGE:            "SELF_PRIVILEGE_CHANGE",
  // Catálogos clínicos por clínica (especies, razas, tipos de vacuna).
  CATALOG_NOT_FOUND:                "CATALOG_NOT_FOUND",
  CATALOG_DUPLICATE:                "CATALOG_DUPLICATE",
  CATALOG_IN_USE:                   "CATALOG_IN_USE",
  TENANT_DUPLICATE_TAXID:           "TENANT_DUPLICATE_TAXID",
  MODULE_UNKNOWN:                   "MODULE_UNKNOWN",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── Clientes ───────────────────────────────────────────────────────────────

export interface Cliente {
  id:           string;
  fullName:     string;
  dniCuit:      string | null;
  phone:        string | null;
  address:      string | null;
  email:        string | null;
  observations: string | null;
  createdAt:    string;
  createdBy:    string | null;
  // RN-CL8: mascotas vivas (deleted=false AND estado='Activa'). Si > 0, no se
  // puede eliminar el cliente (botón deshabilitado + tooltip).
  livePetCount: number;
}

export interface ClienteInput {
  fullName:      string;
  dniCuit:       string;
  phone:         string;
  address:       string;
  email?:        string;
  observations?: string;
}

// ─── Mascotas ───────────────────────────────────────────────────────────────

export type EstadoMascota = "Activa" | "Fallecida";
export type SexoMascota   = "Macho" | "Hembra" | "Desconocido";
export type TamanoMascota = "Pequeño" | "Mediano" | "Grande";
export type EdadCat       = "cachorro" | "adulto" | "senior";

export interface Mascota {
  id:             string;
  name:           string;
  clientId:       string;
  ownerName:      string | null;
  especieId:      string;
  especieName:    string | null;
  razaId:         string | null;
  razaName:       string | null;
  sex:            SexoMascota;
  tamano:         TamanoMascota;
  alimentoDieta:  string | null;
  birthDate:      string | null;
  color:          string | null;
  observations:   string | null;
  estado:         EstadoMascota;
  deceasedDate:   string | null;
  deceasedReason: string | null;
  ultimoPeso:     number | null;
  createdAt:      string;
}

export interface MascotaInput {
  name:           string;
  clientId:       string;
  especieId:      string;
  razaId?:        string | null;
  sex:            SexoMascota;
  tamano:         TamanoMascota;
  alimentoDieta?: string | null;
  birthDate?:     string | null;
  color?:         string | null;
  observations?:  string | null;
}

export interface EditarMascotaInput {
  name?:          string;
  especieId?:     string;
  razaId?:        string | null;
  sex?:           SexoMascota;
  tamano?:        TamanoMascota;
  alimentoDieta?: string | null;
  color?:         string | null;
  observations?:  string | null;
}

export interface CambiarDuenoInput {
  newClientId: string;
  reason?:     string | null;
  notes?:      string | null;
}

export interface MarcarFallecidaInput {
  deceasedReason: string;
  deceasedDate?:  string | null;
  deceasedNotes?: string | null;
}

// ─── Servicios ──────────────────────────────────────────────────────────────

export type TipoServicio = "clinica" | "peluqueria" | "guarderia" | "cirugia" | "otro";

export interface Servicio {
  id:                  string;
  nombre:              string;
  tipo:                TipoServicio;
  duracionMinutos:     number;
  requiereProfesional: boolean;
  descripcion:         string | null;
  activo:              boolean;
  createdAt:           string;
  precio?:             number | null;
  alicuotaIva?:        number;
}

export interface ServicioInput {
  nombre:              string;
  tipo:                TipoServicio;
  duracionMinutos:     number;
  requiereProfesional: boolean;
  descripcion?:        string | null;
  precio?:             number | null;
  alicuotaIva?:        number;
}

export type ActualizarServicioInput = Partial<ServicioInput>;

// ─── Turnos ─────────────────────────────────────────────────────────────────

export type EstadoTurno = "Programado" | "Confirmado" | "Completado" | "Cancelado";

export interface TurnoServicio {
  id:              string;
  nombre:          string;
  tipo:            TipoServicio;
  duracionMinutos: number;
}

export interface TurnoDoctor {
  id:   string;
  name: string;
  /**
   * RN-HOR8: `false` cuando el profesional fue dado de baja DESPUÉS de agendar
   * el turno. La asignación se conserva y se sigue mostrando; lo que cambia es
   * que el selector ya no lo ofrece para asignaciones nuevas.
   */
  available: boolean;
}

export interface TurnoMascota {
  id:   string;
  name: string;
}

export interface TurnoCliente {
  id:       string;
  fullName: string;
}

export interface Turno {
  id:                  string;
  date:                string;
  startTime:           string;
  endTime:             string;
  status:              EstadoTurno;
  reason:              string;
  notes:               string | null;
  cancellationReason:  string | null;
  cancelledAt:         string | null;
  servicio:            TurnoServicio | null;
  doctor:              TurnoDoctor | null;
  mascota:             TurnoMascota | null;
  cliente:             TurnoCliente | null;
  accionesDisponibles: string[];
  /** Turno vencido sin cerrar: fecha/hora ya pasada y estado todavía no terminal. */
  vencido:             boolean;
}

export interface SlotDisponible {
  startTime: string;
  endTime:   string;
}

/** Payload de POST /turnos — nombres iguales al CrearTurnoSchema del backend (clientId/petId). */
export interface CrearTurnoInput {
  servicioId: string;
  clientId:   string;
  petId:      string;
  doctorId?:  string;
  date:       string;
  startTime:  string;
  reason:     string;
  notes?:     string;
}

/**
 * Payload de PUT /turnos/:id — todos opcionales (≥1 requerido). El backend NUNCA
 * acepta endTime: lo recalcula con la duración vigente del servicio (RN-MC2).
 */
export interface ModificarTurnoInput {
  servicioId?: string;
  clientId?:   string;
  petId?:      string;
  doctorId?:   string | null;
  date?:       string;
  startTime?:  string;
  reason?:     string;
  notes?:      string | null;
}

// ─── Configuración de la Clínica ────────────────────────────────────────────

export interface ConfiguracionTenant {
  cupoMaximoDiario: number;
  diasAvisoVacuna:  number;
  parametrosExtra:  Record<string, unknown>;
  updatedAt:        string;
}

export interface ConfiguracionInput {
  cupoMaximoDiario: number;
  diasAvisoVacuna:  number;
}

// ─── Guardería / Estadías ───────────────────────────────────────────────────

/**
 * Espejo de `EstadiaPublica` del backend. `status` no se tipa como union cerrado
 * porque el backend tampoco lo hace (queda abierto a Reservada/EnCurso/Finalizada/
 * Cancelada sin narrow); las tarjetas `petTamano`/`petDieta`/`petName`/`clientName`
 * vienen ya embebidas (snapshot) al crear (Addendum v1.1 pantalla 3).
 */
export interface Estadia {
  id:            string;
  clientId:      string;
  petId:         string;
  checkInDate:   string;
  checkOutDate:  string;
  status:        string;
  reason:        string;
  notes:         string | null;
  createdAt:     string;
  checkedInAt:   string | null;
  checkedOutAt:  string | null;
  petName:       string;
  petTamano:     string;
  petDieta:      string | null;
  clientName:    string;
}

/** Body de `POST /estadias` (espejo de `CrearEstadiaSchema`). Nunca se envía `status`. */
export interface CrearEstadiaInput {
  clientId:     string;
  petId:        string;
  checkInDate:  string;
  checkOutDate: string;
  reason:       string;
  notes?:       string;
}

/** Body de `PUT /estadias/:id` (espejo de `ModificarEstadiaSchema`). Cliente y
 *  mascota no se pueden cambiar; el backend pre-rellena lo que no se envíe. */
export interface ModificarEstadiaInput {
  checkInDate?:  string;
  checkOutDate?: string;
  reason?:       string;
  notes?:        string | null;
}

/** Item de `GET /estadias/cupo` (RN-GU4): ocupación vs cupo configurado, por día. */
export interface CupoDia {
  date:       string;
  ocupados:   number;
  cupo:       number;
  disponible: number;
}

// ─── Doctores ───────────────────────────────────────────────────────────────

export interface DoctorUsuario {
  username: string;
  fullName: string;
  active:   boolean;
}

/**
 * Contrato del "profesional" (DT-2) — dos claves, cada consumidor usa la suya:
 * - `id`: PK de `doctores` → es el `doctorId` de Turnos y Horarios.
 * - `userId`: `usuarios.id` del usuario vinculado (nullable) → es el
 *   `professionalId` que esperan Historial Clínico y Vacunación.
 * Los selects de historial listan con `professional: true` y envían `userId`.
 */
export interface Doctor {
  id:            string;
  userId:        string | null;
  name:          string;
  specialty:     string | null;
  licenseNumber: string | null;
  available:     boolean;
  createdAt:     string;
  usuario:       DoctorUsuario | null;
}

export interface DoctorInput {
  specialty?:     string | null;
  licenseNumber?: string | null;
  available?:     boolean;
}

// ─── Gestión de Usuarios ─────────────────────────────────────────────────────

/**
 * Espejo camelCase de `UsuarioPublico` del backend (GET /usuarios). `rolName` es
 * el `display_name` del rol (etiqueta); el color del badge se deriva del `name`
 * del rol resolviendo `rolId` contra el catálogo (ver lib/roles.ts). Nunca trae
 * password (RN-S1).
 */
export interface Usuario {
  id:        string;
  username:  string;
  email:     string;
  fullName:  string;
  phone:     string | null;
  active:    boolean;
  rolId:     string;
  rolName:   string;
  createdAt: string;
}

/** Catálogo de roles del tenant (GET /usuarios/roles). `name` es el identificador
 *  de máquina (admin | veterinario | …); `displayName` es la etiqueta en español. */
export interface Rol {
  id:          string;
  name:        string;
  displayName: string;
  description: string | null;
}

/**
 * Body de `POST /usuarios` (espejo de `CrearUsuarioSchema`). `roleId` es el UUID
 * del rol. Al asignar el rol veterinario el backend crea/sincroniza el perfil en
 * `doctores` (DT-1); el front solo refleja el resultado, no duplica esa lógica.
 */
export interface CrearUsuarioInput {
  username: string;
  password: string;
  fullName: string;
  email:    string;
  phone?:   string;
  roleId:   string;
  active?:  boolean;
}

/** Body de `PUT /usuarios/:id` (espejo de `EditarUsuarioSchema`): todos opcionales
 *  y sin password (no se edita la contraseña por este endpoint). */
export interface EditarUsuarioInput {
  username?: string;
  fullName?: string;
  email?:    string;
  phone?:    string;
  roleId?:   string;
  active?:   boolean;
}

// ─── Horarios (franjas de un doctor) ───────────────────────────────────────

export interface Franja {
  id:        string;
  doctorId:  string;
  dayOfWeek: number; // 0=Domingo ... 6=Sábado
  startTime: string; // "HH:MM"
  endTime:   string; // "HH:MM"
  active:    boolean;
}

export interface FranjaInput {
  dayOfWeek: number;
  startTime: string;
  endTime:   string;
  active?:   boolean;
}

// ─── Historial Clínico ──────────────────────────────────────────────────────

// RN-EC1: enum de eventos clínicos (espejo del ENUM de DB). "Eutanasia" no se
// ofrece en el dropdown de "Registrar evento" (ver TIPOS_EVENTO en
// EventoClinicoFormDialog) — se registra por el flujo dedicado de eutanasia —
// pero sí puede volver en el timeline una vez registrada.
export type TipoEventoClinico =
  | "Consulta"
  | "Vacunación"
  | "Cirugía"
  | "Análisis"
  | "Radiografía"
  | "Ecografía"
  | "Desparasitación"
  | "Control"
  | "Emergencia"
  | "Internación"
  | "Eutanasia"
  | "Otro";

/** Item del timeline (RN-HC1..HC3): orden desc, dueño histórico, sin detalle. */
export interface HistorialItem {
  id:               string;
  date:             string;
  eventType:        TipoEventoClinico;
  professionalName: string | null;
  weightKg:         number | null;
  temperatureC:     number | null;
  diagnosis:        string | null;
  clientNameAtTime: string;
  isPreviousOwner:  boolean;
  hasAttachments:   boolean;
}

export interface AdjuntoMeta {
  id:       string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/** Detalle completo de un evento (`GET /historial/:id`), incluye adjuntos. */
export interface HistorialDetalle {
  id:               string;
  petId:            string;
  date:             string;
  eventType:        TipoEventoClinico;
  professionalName: string | null;
  weightKg:         number | null;
  temperatureC:     number | null;
  description:      string;
  diagnosis:        string | null;
  treatment:        string | null;
  medication:       string | null;
  notes:            string | null;
  clientNameAtTime: string;
  createdAt:        string;
  adjuntos:         AdjuntoMeta[];
}

/** Signed URL de un adjunto (`GET /adjuntos/:adjuntoId`), TTL 5 min. */
export interface AdjuntoFirmado {
  url:      string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * Signed URL de un adjunto identificado (`GET /historial/:id/adjuntos-firmados`),
 * TTL 5 min. Se pide una sola vez por evento abierto (no una por adjunto).
 */
export interface AdjuntoFirmadoLote extends AdjuntoFirmado {
  id: string;
}

/** Cabecera de ficha clínica (`GET /mascotas/:petId/resumen-clinico`). */
export interface ResumenClinico {
  id:          string;
  name:        string;
  estado:      EstadoMascota;
  ownerName:   string | null;
  especieName: string | null;
  razaName:    string | null;
  // RN-HC2: último peso derivado del evento más reciente con peso, no un campo aparte.
  ultimoPeso:  number | null;
}

/** Respuesta al registrar un evento clínico. */
export interface EventoCreado {
  id:               string;
  petId:            string;
  date:             string;
  eventType:        TipoEventoClinico;
  clientNameAtTime: string;
  attachmentsCount: number;
  emailSent:        boolean;
  /** RN-EC13: id de la dosis programada en el Plan de Vacunación si se pidió `proximaDosis`. */
  planVacunacionId: string | null;
}

/** Body de `POST /mascotas/:petId/historial` (espejo de `CrearEventoClinicoSchema`). */
export interface CrearEventoClinicoInput {
  date:               string;
  eventType:          TipoEventoClinico;
  professionalId:     string;
  description:        string;
  weightKg?:          number | null;
  temperatureC?:      number | null;
  diagnosis?:         string | null;
  treatment?:         string | null;
  medication?:        string | null;
  notes?:             string | null;
  sendEmailToClient?: boolean;
  /** RN-EC13: opcional, solo válido si eventType='Vacunación'. */
  proximaDosis?:      { tipoVacunaId: string; fechaEstimada: string } | null;
}

/** Body de `POST /mascotas/:petId/eutanasia` (espejo de `RegistrarEutanasiaSchema`, RN-EC10). */
export interface RegistrarEutanasiaInput {
  date:                 string;
  professionalId:       string;
  description:          string;
  weightKg?:            number | null;
  temperatureC?:        number | null;
  diagnosis?:           string | null;
  notes?:               string | null;
  euthanasiaConfirmed:  boolean;
}

/** Respuesta de `POST /mascotas/:petId/eutanasia` (RN-EC11): evento + mascota + dosis canceladas. */
export interface EutanasiaResultado {
  evento: {
    id:               string;
    petId:            string;
    date:             string;
    eventType:        TipoEventoClinico;
    professionalName: string | null;
    clientNameAtTime: string;
  };
  mascota: {
    id:             string;
    name:           string;
    estado:         EstadoMascota;
    deceasedDate:   string;
    deceasedReason: string;
  };
  cancelledDoses: number;
}

// ─── Plan de Vacunación ─────────────────────────────────────────────────────

// RN-PV1: estado persistido (server); "Aplicada"/"Cancelada" son terminales.
export type EstadoDosisVacunacion = "Pendiente" | "Aplicada" | "Cancelada";

// RN-PV1: estadoVisual se deriva 100% en el backend comparando fechaEstimada
// con "hoy" — el frontend NO debe recalcularlo, solo pintarlo.
export type EstadoVisualDosis = "Proxima" | "Vencida" | "Aplicada" | "Cancelada";

/** Item del timeline de vacunación (`GET /mascotas/:petId/plan-vacunacion`), orden asc por fechaEstimada. */
export interface DosisVacunacion {
  id:                 string;
  petId:              string;
  tipoVacunaId:       string;
  tipoVacunaNombre:   string | null;
  eventoOrigenId:     string | null;
  eventoAplicacionId: string | null;
  fechaEstimada:      string;
  estado:             EstadoDosisVacunacion;
  estadoVisual:       EstadoVisualDosis;
  notas:              string | null;
  createdAt:          string;
}

/** Body de `POST /mascotas/:petId/plan-vacunacion` (espejo de `ProgramarDosisSchema`, RN-PV2/PV3). */
export interface ProgramarDosisInput {
  tipoVacunaId:  string;
  fechaEstimada: string;
  notas?:        string;
}

/** Body de `PATCH /plan-vacunacion/:id/aplicar` (espejo de `MarcarAplicadaSchema`, RN-PV5). */
export interface MarcarAplicadaInput {
  professionalId: string;
  date?:          string;
  weightKg?:      number;
  temperatureC?:  number;
  notes?:         string;
}

// ─── Catálogos clínicos (por tenant) ────────────────────────────────────────

export interface Especie {
  id:   string;
  name: string;
}

export interface Raza {
  id:         string;
  name:       string;
  especie_id: string;
}

// ─── Gestión del catálogo (envelope de /api/v1, camelCase) ──────────────────
//
// Los tipos de arriba son la forma CRUDA de PostgREST, que es como el frontend
// LEE el catálogo para poblar los combos. Los de abajo son los del envelope de
// la API, que es por donde pasa toda ESCRITURA: traen `active` porque la
// pantalla de gestión necesita ver y alternar el estado (RN-CAT4, RN-CAT9).

export interface EspecieCatalogo {
  id:          string;
  name:        string;
  description: string | null;
  active:      boolean;
}

export interface RazaCatalogo {
  id:          string;
  especieId:   string;
  /** Nombre de la especie, embebido por el backend en la misma consulta. */
  especieName: string | null;
  name:        string;
  description: string | null;
  active:      boolean;
}

/** Especie tal como la muestra el catálogo de vacunas: id + nombre. */
export interface EspecieAsociada {
  id:   string;
  name: string;
}

export interface TipoVacunaCatalogo {
  id:                    string;
  nombre:                string;
  /**
   * Especies a las que aplica (RN-CAT10). Reemplaza al `especieAplicable` de
   * texto libre: la relación es N:M contra el catálogo de especies y la resuelve
   * el backend embebida en el mismo listado.
   */
  especies:              EspecieAsociada[];
  mesesRefuerzoSugerido: number | null;
  active:                boolean;
}

/**
 * Un tipo de vacuna que le corresponde a UNA mascota
 * (`GET /mascotas/:petId/tipos-vacuna-aplicables`, RN-PV11).
 *
 * Distinto de `TipoVacunaCatalogo`: acá no hay `active` ni especies porque la
 * lista ya viene filtrada por el backend. Qué vacuna aplica es regla de negocio,
 * no algo que el frontend deba recalcular.
 */
export interface TipoVacunaAplicable {
  id:                    string;
  nombre:                string;
  mesesRefuerzoSugerido: number | null;
}

export interface EspecieInput {
  name:         string;
  description?: string | null;
}

export interface RazaInput {
  especieId:    string;
  name:         string;
  description?: string | null;
}

export interface TipoVacunaInput {
  nombre:                 string;
  /**
   * Conjunto COMPLETO de especies a las que aplica (RN-CAT10): lo que no está
   * acá deja de estar asociado. Obligatorio al crear; opcional al editar, donde
   * omitirlo significa "no toques las especies".
   */
  especieIds?:            string[];
  mesesRefuerzoSugerido?: number | null;
}

// ─── Autenticación / sesión ────────────────────────────────────────────────

/** Usuario autenticado (espejo camelCase de `GET /auth/me` y de `login.user`). */
export interface AuthUser {
  id:          string;
  username:    string;
  fullName:    string;
  roleName:    string;
  permissions: string[];
}

/** Respuesta de `POST /auth/login`: token JWT + datos del usuario. */
export interface LoginResult {
  token: string;
  /** Refresh token de GoTrue: permite renovar la sesión sin volver a loguearse. */
  refreshToken: string;
  user:  AuthUser;
}

/** Respuesta de `POST /auth/refresh`: par de tokens renovado (GoTrue los rota). */
export interface RefreshResult {
  token:        string;
  refreshToken: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

// ─── Autenticación de plataforma (Super Admin) ──────────────────────────────

/**
 * Credenciales del Super Admin. Es EMAIL y no username a propósito: el Super
 * Admin no tiene fila en `usuarios` (esa tabla exige tenant), así que no tiene
 * nombre de usuario — existe solo en Supabase Auth, identificado por su email.
 */
export interface PlatformLoginInput {
  email:    string;
  password: string;
}

/** Respuesta de `POST /admin/auth/login`: par de tokens + identidad de plataforma. */
export interface PlatformLoginResult {
  token:        string;
  refreshToken: string;
  superAdmin: {
    id:    string;
    email: string | null;
  };
}

// ─── Auditoría ──────────────────────────────────────────────────────────────

// Espejo de AUDIT_MODULES/AUDIT_ACTIONS del backend (auditoria.schemas.ts). Deben
// mantenerse sincronizados: son los únicos valores que el backend acepta como filtro.
export const AUDIT_MODULES = [
  "clients", "pets", "medical_records", "appointments", "daycare",
  "users",   "security", "services", "system", "platform",
] as const;
export type AuditModuleValue = (typeof AUDIT_MODULES)[number];

export const AUDIT_ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "CANCEL",
  "LOGIN",  "LOGOUT", "VIEW",   "EXPORT",
] as const;
export type AuditActionValue = (typeof AUDIT_ACTIONS)[number];

/** Espejo camelCase de `RegistroAuditoriaPublico` del backend (GET /auditoria). */
export interface RegistroAuditoria {
  id:        string;
  timestamp: string;
  module:    string;
  action:    string;
  userId:    string | null;
  userName:  string | null;
  userRole:  string | null;
  entityId:  string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  details:   string | null;
  ipAddress: string | null;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

/**
 * Resumen agregado de `GET /dashboard/resumen` (espejo de `ResumenDashboard`
 * del backend).
 *
 * OJO con `null`: NO es cero. Significa "esta métrica no es visible para vos"
 * porque falta el permiso del endpoint dueño del dato o el módulo vendible no
 * está licenciado para el tenant. El backend decide, el front oculta la tarjeta.
 * Un `0` sí es un dato: "no hay nada hoy".
 */
export interface ResumenDashboard {
  fecha:              string;
  clientes:           number | null;
  mascotasActivas:    number | null;
  turnosHoy:          number | null;
  estadiasHoy:        number | null;
  vacunasProximas30d: number | null;
}

// ─── Módulos vendibles ─────────────────────────────────────────────────────

export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia" | "stock" | "ventas";

export interface ModuloContratado {
  modulo:     ModuloVendible;
  habilitado: boolean;
  fechaAlta:  string | null;
}

// ─── Plataforma / Super Admin ───────────────────────────────────────────────

/** Valores EXACTOS del ENUM `plan_tenant` (espejo de `PlanTenantEnum` del backend). */
export type PlanTenant = "basico" | "profesional" | "premium";

export const PLANES_TENANT: PlanTenant[] = ["basico", "profesional", "premium"];

/**
 * Espejo camelCase de `TenantPublico` del backend (`/admin/tenants`). RN-SA4: son
 * metadatos comerciales, NUNCA datos de negocio internos del tenant.
 * `adminInvitado` dice si la clínica YA TIENE administrador. El nombre viene del
 * flujo de invitación por mail, que se sacó del alta; la columna de la base
 * (`tenants.admin_invitado`) conserva el nombre viejo porque su migración ya está
 * aplicada, pero hoy la pone en true el alta del administrador
 * (`POST /admin/tenants/:id/admin`), no ningún envío de mail.
 */
export interface Tenant {
  id:            string;
  nombre:        string;
  cuitRut:       string;
  emailContacto: string;
  plan:          PlanTenant;
  activo:        boolean;
  adminInvitado: boolean;
  createdAt:     string;
}

/** Body de `POST /admin/tenants` (espejo de `CrearTenantSchema`). `emailContacto`
 *  es la casilla comercial de la clínica; NO crea ninguna cuenta ni recibe mail.
 *  El administrador se da de alta aparte, con `POST /admin/tenants/:id/admin`. */
export interface CrearTenantInput {
  nombre:        string;
  cuitRut:       string;
  emailContacto: string;
  plan:          PlanTenant;
}

/** Body de `PUT /admin/tenants/:id` (espejo de `EditarTenantSchema`): datos
 *  comerciales, todos opcionales. `cuitRut` NO se edita (unicidad fiscal, RN-SA1)
 *  y `activo` va por `PATCH /estado`. */
export interface EditarTenantInput {
  nombre?:        string;
  emailContacto?: string;
  plan?:          PlanTenant;
}

/** Filtro de estado del listado de tenants (espejo de `ListarTenantsQuerySchema`). */
export type EstadoTenantFiltro = "activo" | "suspendido";

// ─── Re-export de tipos del Módulo Comercial (F1·T1) ─────────────────────────
export * from "./comercial.ts";
