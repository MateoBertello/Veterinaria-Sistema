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
  STAY_OVERLAP:        "STAY_OVERLAP",
  INVALID_RANGE:       "INVALID_RANGE",
  SCHEDULE_OVERLAP:    "SCHEDULE_OVERLAP",
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

// ─── Doctores ───────────────────────────────────────────────────────────────

export interface DoctorUsuario {
  username: string;
  fullName: string;
  active:   boolean;
}

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
