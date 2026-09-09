import type { ModuloContratado, ModuloVendible } from "../types/index.ts";

/**
 * Grupos del sidebar. El orden del array ES el orden de las secciones, y la
 * división responde a CÓMO se usa el sistema, no a cómo está implementado:
 *
 * - `principal`      punto de entrada (sin encabezado: no hace falta titular un solo ítem).
 * - `clinica`        el core Cliente-Mascota (RN-G1): el registro que todo lo demás referencia.
 * - `modulos`        los TRES módulos vendibles, y solo esos: licenciados por tenant (RN-G2).
 * - `operacion`      core transversal de uso frecuente que alimenta a los módulos.
 * - `administracion` core transversal de uso esporádico (config, altas de usuario, trazabilidad).
 *
 * La separación `modulos` / `operacion` es deliberada: lo que se paga aparte no
 * puede quedar indistinguible de lo que viene con la suscripción.
 */
export type NavGroupKey =
  | "principal"
  | "clinica"
  | "modulos"
  | "operacion"
  | "administracion";

export interface NavItem {
  key:         string;
  label:       string;
  href:        string;
  /** Sección del sidebar donde se agrupa el ítem. */
  group:       NavGroupKey;
  modulo?:     ModuloVendible;
  /** Permiso requerido para ver el ítem (core transversal, no es módulo vendible). */
  permission?: string;
}

/** Una sección del sidebar, con sus ítems ya filtrados. */
export interface NavGroup {
  key:      NavGroupKey;
  /** Encabezado de sección; `null` en el grupo principal, que no lleva título. */
  label:    string | null;
  /** `true` si la sección agrupa módulos vendibles (licenciados por tenant). */
  vendible: boolean;
  items:    NavItem[];
}

// Metadatos de cada sección, en orden de aparición.
const NAV_GROUPS: Omit<NavGroup, "items">[] = [
  { key: "principal",      label: null,                  vendible: false },
  { key: "clinica",        label: "Clínica",             vendible: false },
  { key: "modulos",        label: "Módulos contratados", vendible: true  },
  { key: "operacion",      label: "Operación",           vendible: false },
  { key: "administracion", label: "Administración",      vendible: false },
];

// Ítems siempre visibles, independientes del licenciamiento de módulos vendibles.
export const BASE_NAV: NavItem[] = [
  { key: "inicio",   label: "Inicio",   href: "/",          group: "principal" },
  { key: "clientes", label: "Clientes", href: "/clientes",  group: "clinica" },
  { key: "mascotas", label: "Mascotas", href: "/mascotas",  group: "clinica" },
];

// Ítems core transversales gateados por permiso (no por módulo vendible/licencia).
export const PERMISSION_NAV: NavItem[] = [
  { key: "servicios",     label: "Servicios",     href: "/servicios",     group: "operacion",      permission: "manage_services" },
  { key: "doctores",      label: "Doctores",      href: "/doctores",      group: "operacion",      permission: "manage_users" },
  { key: "horarios",      label: "Horarios",      href: "/horarios",      group: "operacion",      permission: "manage_schedules" },
  // Catálogos va en "Operación" y no en "Administración": cargar una raza o un
  // tipo de vacuna es trabajo diario de recepción y del veterinario, no
  // configuración esporádica de la clínica.
  { key: "catalogos",     label: "Catálogos",     href: "/catalogos",     group: "operacion",      permission: "manage_catalogs" },
  { key: "configuracion", label: "Configuración", href: "/configuracion", group: "administracion", permission: "manage_tenant_settings" },
  { key: "usuarios",      label: "Usuarios",      href: "/usuarios",      group: "administracion", permission: "manage_users" },
  { key: "auditoria",     label: "Auditoría",     href: "/auditoria",     group: "administracion", permission: "view_audit" },
];

// Metadatos de navegación de cada módulo vendible.
const MODULE_NAV: Record<ModuloVendible, { label: string; href: string }> = {
  historial_clinico: { label: "Historial Clínico", href: "/historial" },
  turnos:            { label: "Turnos",            href: "/turnos" },
  guarderia:         { label: "Guardería",         href: "/guarderia" },
  stock:             { label: "Stock",             href: "/stock" },
  ventas:            { label: "Ventas",            href: "/ventas" },
};

// Orden estable de los módulos vendibles en el sidebar.
const MODULE_ORDER: ModuloVendible[] = ["historial_clinico", "turnos", "guarderia", "stock", "ventas"];

/**
 * Construye los ítems de navegación del tenant: ítems base siempre visibles más
 * los módulos vendibles habilitados (RN-G2: oculta los módulos no contratados)
 * más los ítems core transversales cuyo permiso tiene el usuario. Función pura,
 * sin dependencias de React, para poder testear la lógica del sidebar dinámico
 * de forma aislada.
 *
 * Sobre mostrar los módulos NO contratados con candado: no se hace, y no es una
 * decisión de diseño abierta. El Documento Maestro es explícito — "la UI oculta
 * (no sólo deshabilita) los módulos no contratados" (RN-G2) — así que un módulo
 * sin licencia no produce ítem. Quien quiera insinuar el upsell tiene que
 * cambiar la regla en la documentación primero, no acá.
 */
export function buildNavItems(modulos: ModuloContratado[], permissions: string[] = []): NavItem[] {
  const habilitados = new Set(
    modulos.filter((m) => m.habilitado).map((m) => m.modulo),
  );

  const moduleItems: NavItem[] = MODULE_ORDER
    .filter((modulo) => habilitados.has(modulo))
    .map((modulo) => ({ key: modulo, modulo, group: "modulos" as const, ...MODULE_NAV[modulo] }));

  const permissionItems = PERMISSION_NAV.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return [...BASE_NAV, ...moduleItems, ...permissionItems];
}

/**
 * Agrupa en secciones el resultado de `buildNavItems`. NO vuelve a filtrar por
 * módulo habilitado ni por permiso: recibe la lista ya resuelta y solo la
 * reordena por `group`, así que la única fuente de "qué se muestra" sigue siendo
 * `buildNavItems`. Las secciones que quedan vacías (módulos no contratados, rol
 * sin permisos de administración) se descartan para no dejar encabezados huérfanos.
 */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  return NAV_GROUPS
    .map((grupo) => ({ ...grupo, items: items.filter((item) => item.group === grupo.key) }))
    .filter((grupo) => grupo.items.length > 0);
}
