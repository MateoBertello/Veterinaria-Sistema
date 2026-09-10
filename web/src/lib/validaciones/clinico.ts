import {
  alicuotaIva,
  decimalesMaximos,
  email,
  enValores,
  entero,
  fechaIso,
  horaHHMM,
  maxLongitud,
  maxValor,
  minLongitud,
  minValor,
  noNegativo,
  regex,
  requerido,
  uuid,
} from "./reglas.ts";
import type { EsquemaValidacion } from "./types.ts";

// ─── Catálogos Clínicos ─────────────────────────────────────────────────────

export interface EspecieFormValues {
  name: string;
  description?: string | null;
}

// Discrepancia identificada en inventario: actualmente en frontend solo valida required (min 1)
export const especieEsquema: EsquemaValidacion<EspecieFormValues> = {
  name: [
    requerido("El nombre es requerido"),
    minLongitud(2, "El nombre requiere al menos 2 caracteres"),
    maxLongitud(60, "Máximo 60 caracteres"),
  ],
  description: [maxLongitud(200, "Máximo 200 caracteres")],
};

export interface RazaFormValues {
  especieId: string;
  name: string;
  description?: string | null;
}

export const razaEsquema: EsquemaValidacion<RazaFormValues> = {
  especieId: [requerido("La especie es requerida"), uuid()],
  name: [
    requerido("El nombre es requerido"),
    minLongitud(2, "El nombre requiere al menos 2 caracteres"),
    maxLongitud(60, "Máximo 60 caracteres"),
  ],
  description: [maxLongitud(200, "Máximo 200 caracteres")],
};

export interface TipoVacunaFormValues {
  nombre: string;
  especieIds: string[];
  mesesRefuerzoSugerido?: number | string | null;
}

export const tipoVacunaEsquema: EsquemaValidacion<TipoVacunaFormValues> = {
  nombre: [
    requerido("El nombre es requerido"),
    minLongitud(2, "El nombre requiere al menos 2 caracteres"),
    maxLongitud(80, "Máximo 80 caracteres"),
  ],
  especieIds: [requerido("Elegí al menos una especie")],
  mesesRefuerzoSugerido: [
    entero("Debe ser un número entero"),
    minValor(1, "El refuerzo mínimo es 1 mes"),
    maxValor(120, "El refuerzo máximo es 120 meses"),
  ],
};

// ─── Turnos ─────────────────────────────────────────────────────────────────

export interface TurnoFormValues {
  servicioId: string;
  clientId: string;
  petId: string;
  doctorId?: string | null;
  date: string;
  startTime: string;
  reason: string;
  notes?: string | null;
}

export const turnoEsquema: EsquemaValidacion<TurnoFormValues> = {
  servicioId: [requerido("Elegí un servicio"), uuid()],
  clientId: [requerido("Elegí un cliente"), uuid()],
  petId: [requerido("Elegí una mascota"), uuid()],
  date: [requerido("La fecha es requerida"), fechaIso()],
  startTime: [requerido("Elegí un horario de inicio"), horaHHMM()],
  reason: [
    requerido("El motivo es requerido"),
    minLongitud(1, "El motivo es requerido"),
    maxLongitud(200, "Máximo 200 caracteres"),
  ],
  notes: [maxLongitud(500, "Máximo 500 caracteres")],
};

export interface CancelarTurnoFormValues {
  cancellationReason: string;
}

export const cancelarTurnoEsquema: EsquemaValidacion<CancelarTurnoFormValues> = {
  cancellationReason: [
    requerido("El motivo es requerido"),
    minLongitud(1, "El motivo es requerido"),
    maxLongitud(500, "Máximo 500 caracteres"),
  ],
};

// ─── Clientes y Mascotas ────────────────────────────────────────────────────

export interface ClienteFormValues {
  fullName: string;
  dniCuit: string;
  phone: string;
  address: string;
  email?: string | null;
  observations?: string | null;
}

export const clienteEsquema: EsquemaValidacion<ClienteFormValues> = {
  fullName: [
    requerido("El nombre completo es requerido"),
    minLongitud(1, "El nombre completo es requerido"),
    maxLongitud(150, "Máximo 150 caracteres"),
  ],
  dniCuit: [
    requerido("El DNI/CUIT es requerido"),
    minLongitud(1, "El DNI/CUIT es requerido"),
    maxLongitud(20, "Máximo 20 caracteres"),
    regex(/^[\d-]+$/, "El DNI/CUIT solo admite dígitos y guiones"),
  ],
  phone: [
    requerido("El teléfono es requerido"),
    minLongitud(1, "El teléfono es requerido"),
    maxLongitud(30, "Máximo 30 caracteres"),
    regex(/^[\d+\-\s]+$/, "El teléfono solo admite números, +, - y espacios"),
  ],
  address: [
    requerido("La dirección es requerida"),
    minLongitud(1, "La dirección es requerida"),
    maxLongitud(200, "Máximo 200 caracteres"),
  ],
  email: [
    email("Formato de email inválido"),
    maxLongitud(150, "Máximo 150 caracteres"),
  ],
  observations: [maxLongitud(1000, "Máximo 1000 caracteres")],
};

export interface MascotaFormValues {
  name: string;
  clientId: string;
  especieId: string;
  razaId?: string | null;
  sex: "Macho" | "Hembra" | "Desconocido";
  tamano: "Pequeño" | "Mediano" | "Grande";
  color?: string | null;
  alimentoDieta?: string | null;
  birthDate?: string | null;
  observations?: string | null;
}

export const mascotaEsquema: EsquemaValidacion<MascotaFormValues> = {
  name: [
    requerido("El nombre es requerido"),
    minLongitud(1, "El nombre es requerido"),
    maxLongitud(120, "Máximo 120 caracteres"),
  ],
  clientId: [requerido("El cliente es requerido"), uuid()],
  especieId: [requerido("La especie es requerida"), uuid()],
  sex: [requerido("El sexo es requerido"), enValores(["Macho", "Hembra", "Desconocido"])],
  tamano: [requerido("El tamaño es requerido"), enValores(["Pequeño", "Mediano", "Grande"])],
  color: [maxLongitud(60, "Máximo 60 caracteres")],
  alimentoDieta: [maxLongitud(500, "Máximo 500 caracteres")],
  birthDate: [fechaIso()],
  observations: [maxLongitud(1000, "Máximo 1000 caracteres")],
};

// ─── Servicios ──────────────────────────────────────────────────────────────

export interface ServicioFormValues {
  nombre: string;
  tipo: "clinica" | "peluqueria" | "guarderia" | "cirugia" | "otro";
  duracionMinutos: number | string;
  requiereProfesional: boolean;
  descripcion?: string | null;
  precio?: number | string | null;
  alicuotaIva?: number | string | null;
}

export const servicioEsquema: EsquemaValidacion<ServicioFormValues> = {
  nombre: [
    requerido("El nombre es requerido"),
    minLongitud(3, "Mínimo 3 caracteres"),
    maxLongitud(80, "Máximo 80 caracteres"),
  ],
  tipo: [requerido("El tipo es requerido"), enValores(["clinica", "peluqueria", "guarderia", "cirugia", "otro"])],
  duracionMinutos: [
    requerido("La duración es requerida"),
    entero("Debe ser un número entero"),
    minValor(5, "La duración mínima es 5 minutos"),
    maxValor(480, "La duración máxima es 480 minutos"),
  ],
  descripcion: [maxLongitud(300, "Máximo 300 caracteres")],
  precio: [noNegativo("El precio no puede ser negativo")],
  alicuotaIva: [alicuotaIva()],
};

// ─── Eutanasia ──────────────────────────────────────────────────────────────

export interface EutanasiaFormValues {
  motivo: string;
}

export const eutanasiaEsquema: EsquemaValidacion<EutanasiaFormValues> = {
  motivo: [
    requerido("El motivo clínico de la eutanasia es requerido"),
    minLongitud(10, "El motivo debe tener al menos 10 caracteres"),
  ],
};
