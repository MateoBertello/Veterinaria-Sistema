import type { ModuloVendible, PlanTenant } from "../types/index.ts";

/**
 * planes.ts — metadatos visuales de la consola de plataforma: planes de tenant y
 * módulos vendibles. Presentación pura (etiqueta + clases del Badge); el valor
 * de máquina lo manda el backend (ENUMs `plan_tenant` y `modulo_vendible`).
 */

export interface PlanMeta {
  label:      string;
  /** Clases del Badge (color estable en hover, como el resto del kit). */
  badgeClass: string;
}

// Colores de la pantalla 7 del Addendum: basico gris, profesional azul, premium naranja.
export const PLAN_META: Record<PlanTenant, PlanMeta> = {
  basico: {
    label:      "Básico",
    badgeClass: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  },
  profesional: {
    label:      "Profesional",
    badgeClass: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  },
  premium: {
    label:      "Premium",
    badgeClass: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  },
};

const PLAN_POR_DEFECTO: PlanMeta = {
  label:      "—",
  badgeClass: "bg-gray-100 text-gray-800 hover:bg-gray-100",
};

/** Metadatos visuales de un plan (con fallback neutro si llega uno desconocido). */
export function getPlanMeta(plan: string | undefined | null): PlanMeta {
  return (plan && PLAN_META[plan as PlanTenant]) || PLAN_POR_DEFECTO;
}

export interface ModuloMeta {
  /** Etiqueta corta del switch (HC / TU / GU, pantalla 7 del Addendum). */
  sigla:       string;
  label:       string;
  description: string;
}

export const MODULO_META: Record<ModuloVendible, ModuloMeta> = {
  historial_clinico: {
    sigla:       "HC",
    label:       "Historial Clínico",
    description: "Fichas clínicas, adjuntos y plan de vacunación.",
  },
  turnos: {
    sigla:       "TU",
    label:       "Turnos",
    description: "Agenda de turnos por servicio y profesional.",
  },
  guarderia: {
    sigla:       "GU",
    label:       "Guardería",
    description: "Estadías, cupo diario y check-in/check-out.",
  },
};

/** Orden estable de los módulos vendibles en la consola. */
export const MODULOS_ORDEN: ModuloVendible[] = ["historial_clinico", "turnos", "guarderia"];

/** Etiqueta legible de un módulo (fallback: el valor crudo del backend). */
export function getModuloLabel(modulo: string): string {
  return MODULO_META[modulo as ModuloVendible]?.label ?? modulo;
}
