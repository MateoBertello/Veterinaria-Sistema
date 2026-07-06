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
  EMPTY_HISTORY:                    "EMPTY_HISTORY",
  HISTORIAL_NOT_FOUND:              "HISTORIAL_NOT_FOUND",
  EUTHANASIA_CONFIRMATION_REQUIRED: "EUTHANASIA_CONFIRMATION_REQUIRED",
  INVALID_FILE_TYPE:                "INVALID_FILE_TYPE",
  FILE_TOO_LARGE:                   "FILE_TOO_LARGE",
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
}

export interface ServicioInput {
  nombre:              string;
  tipo:                TipoServicio;
  duracionMinutos:     number;
  requiereProfesional: boolean;
  descripcion?:        string | null;
}

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

// ─── Catálogos globales ─────────────────────────────────────────────────────

export interface Especie {
  id:   string;
  name: string;
}

export interface Raza {
  id:         string;
  name:       string;
  especie_id: string;
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
  user:  AuthUser;
}

export interface LoginInput {
  username: string;
  password: string;
}

// ─── Módulos vendibles ─────────────────────────────────────────────────────

export type ModuloVendible = "historial_clinico" | "turnos" | "guarderia";

export interface ModuloContratado {
  modulo:     ModuloVendible;
  habilitado: boolean;
  fechaAlta:  string | null;
}
