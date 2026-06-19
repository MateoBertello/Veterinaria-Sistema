import type { ModuloContratado, ModuloVendible } from "../types/index.ts";

export interface NavItem {
  key:     string;
  label:   string;
  href:    string;
  modulo?: ModuloVendible;
}

// Ítems siempre visibles, independientes del licenciamiento de módulos vendibles.
export const BASE_NAV: NavItem[] = [
  { key: "inicio", label: "Inicio", href: "/" },
];

// Metadatos de navegación de cada módulo vendible.
const MODULE_NAV: Record<ModuloVendible, { label: string; href: string }> = {
  historial_clinico: { label: "Historial Clínico", href: "/historial" },
  turnos:            { label: "Turnos",            href: "/turnos" },
  guarderia:         { label: "Guardería",         href: "/guarderia" },
};

// Orden estable de los módulos vendibles en el sidebar.
const MODULE_ORDER: ModuloVendible[] = ["historial_clinico", "turnos", "guarderia"];

/**
 * Construye los ítems de navegación del tenant: ítems base siempre visibles más
 * los módulos vendibles habilitados (RN-G2: oculta los módulos no contratados).
 * Función pura, sin dependencias de React, para poder testear la lógica del
 * sidebar dinámico de forma aislada.
 */
export function buildNavItems(modulos: ModuloContratado[]): NavItem[] {
  const habilitados = new Set(
    modulos.filter((m) => m.habilitado).map((m) => m.modulo),
  );

  const moduleItems: NavItem[] = MODULE_ORDER
    .filter((modulo) => habilitados.has(modulo))
    .map((modulo) => ({ key: modulo, modulo, ...MODULE_NAV[modulo] }));

  return [...BASE_NAV, ...moduleItems];
}
