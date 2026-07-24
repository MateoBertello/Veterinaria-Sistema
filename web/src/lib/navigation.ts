import type { ModuloContratado, ModuloVendible } from "../types/index.ts";

export interface NavItem {
  key:         string;
  label:       string;
  href:        string;
  modulo?:     ModuloVendible;
  /** Permiso requerido para ver el ítem (core transversal, no es módulo vendible). */
  permission?: string;
}

// Ítems siempre visibles, independientes del licenciamiento de módulos vendibles.
export const BASE_NAV: NavItem[] = [
  { key: "inicio",   label: "Inicio",   href: "/" },
  { key: "clientes", label: "Clientes", href: "/clientes" },
  { key: "mascotas", label: "Mascotas", href: "/mascotas" },
];

// Ítems core transversales gateados por permiso (no por módulo vendible/licencia).
export const PERMISSION_NAV: NavItem[] = [
  { key: "servicios",     label: "Servicios",     href: "/servicios",     permission: "manage_services" },
  { key: "doctores",      label: "Doctores",      href: "/doctores",      permission: "manage_users" },
  { key: "horarios",      label: "Horarios",      href: "/horarios",      permission: "manage_schedules" },
  { key: "configuracion", label: "Configuración", href: "/configuracion", permission: "manage_tenant_settings" },
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
 * los módulos vendibles habilitados (RN-G2: oculta los módulos no contratados)
 * más los ítems core transversales cuyo permiso tiene el usuario. Función pura,
 * sin dependencias de React, para poder testear la lógica del sidebar dinámico
 * de forma aislada.
 */
export function buildNavItems(modulos: ModuloContratado[], permissions: string[] = []): NavItem[] {
  const habilitados = new Set(
    modulos.filter((m) => m.habilitado).map((m) => m.modulo),
  );

  const moduleItems: NavItem[] = MODULE_ORDER
    .filter((modulo) => habilitados.has(modulo))
    .map((modulo) => ({ key: modulo, modulo, ...MODULE_NAV[modulo] }));

  const permissionItems = PERMISSION_NAV.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return [...BASE_NAV, ...moduleItems, ...permissionItems];
}
