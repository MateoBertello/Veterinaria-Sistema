/**
 * dashboard.ts — lógica pura del panel de inicio (sin React ni JSX), para poder
 * testear qué se muestra sin montar la pantalla.
 *
 * Dos reglas de visibilidad conviven, y son la misma regla vista desde dos lados:
 *
 * - **Tarjetas de métrica:** manda el backend. `GET /dashboard/resumen` ya aplicó
 *   el permiso y el módulo licenciado de cada métrica; lo que no se puede ver
 *   vuelve `null` y la tarjeta no se dibuja (`metricasVisibles`).
 * - **Accesos rápidos:** son navegación, no datos, así que se resuelven en el
 *   cliente con los permisos de la sesión + los módulos habilitados, el mismo
 *   criterio que `buildNavItems` usa para el sidebar (RN-G2).
 */

import type {
  EstadoTurno,
  ModuloContratado,
  ModuloVendible,
  ResumenDashboard,
  Turno,
} from "../types/index.ts";

// ─── Métricas ────────────────────────────────────────────────────────────────

/** Claves numéricas del resumen (todas menos `fecha`). */
export type MetricaKey = Exclude<keyof ResumenDashboard, "fecha">;

export interface MetricaMeta {
  key:   MetricaKey;
  label: string;
  /** Pantalla real del repo a la que navega la tarjeta. */
  href:  string;
  /** Aclara qué cuenta exactamente (el número solo es ambiguo). */
  hint:  string;
}

/** Orden y metadatos de las tarjetas. El valor lo pone el resumen del backend. */
export const METRICAS_DASHBOARD: MetricaMeta[] = [
  { key: "clientes",           label: "Clientes",          href: "/clientes",  hint: "Clientes activos de la clínica" },
  { key: "mascotasActivas",    label: "Mascotas activas",  href: "/mascotas",  hint: "Pacientes vivos registrados" },
  { key: "turnosHoy",          label: "Turnos de hoy",     href: "/turnos",    hint: "Agendados para hoy, sin los cancelados" },
  { key: "estadiasHoy",        label: "Guardería hoy",     href: "/guarderia", hint: "Estadías que ocupan el día de hoy" },
  { key: "vacunasProximas30d", label: "Vacunas próximas",  href: "/historial", hint: "Dosis pendientes en los próximos 30 días" },
];

export interface MetricaVisible extends MetricaMeta {
  valor: number;
}

/**
 * Tarjetas a dibujar: las métricas que el backend devolvió con un número.
 * `null` = sin permiso o módulo no licenciado → no se dibuja. `0` sí se dibuja.
 */
export function metricasVisibles(resumen: ResumenDashboard | null): MetricaVisible[] {
  if (!resumen) return [];
  return METRICAS_DASHBOARD.flatMap((meta) => {
    const valor = resumen[meta.key];
    return typeof valor === "number" ? [{ ...meta, valor }] : [];
  });
}

// ─── Accesos rápidos ─────────────────────────────────────────────────────────

export interface AccesoRapido {
  key:         string;
  label:       string;
  href:        string;
  /** Permiso del endpoint dueño de la pantalla destino (RN-S2). */
  permission?: string;
  /** Módulo vendible que debe estar habilitado (regla de licenciamiento). */
  modulo?:     ModuloVendible;
}

/** Catálogo completo; `buildAccesosRapidos` filtra por sesión y licencias. */
export const ACCESOS_RAPIDOS: AccesoRapido[] = [
  { key: "clientes",  label: "Clientes",          href: "/clientes",        permission: "manage_clients" },
  { key: "mascotas",  label: "Mascotas",          href: "/mascotas",        permission: "manage_pets" },
  { key: "turno",     label: "Agendar turno",     href: "/turnos/nuevo",    permission: "manage_appointments", modulo: "turnos" },
  { key: "estadia",   label: "Nueva estadía",     href: "/guarderia/nuevo", permission: "manage_daycare",      modulo: "guarderia" },
  { key: "historial", label: "Historial clínico", href: "/historial",       permission: "view_medical_history", modulo: "historial_clinico" },
  { key: "usuarios",  label: "Usuarios",          href: "/usuarios",        permission: "manage_users" },
  { key: "auditoria", label: "Auditoría",         href: "/auditoria",       permission: "view_audit" },
];

/** Acceso a la consola de plataforma: solo con el claim super_admin del JWT. */
export const ACCESO_SUPER_ADMIN: AccesoRapido = {
  key:   "admin",
  label: "Consola de plataforma",
  href:  "/admin",
};

/**
 * Accesos rápidos de la sesión: los que el rol puede usar y cuyo módulo está
 * habilitado (RN-G2). Es una función pura, gemela de `buildNavItems`: es UX, no
 * autorización — el backend revalida permiso y licencia en cada request.
 */
export function buildAccesosRapidos(
  permissions: string[],
  modulos: ModuloContratado[],
  opts: { superAdmin?: boolean } = {},
): AccesoRapido[] {
  const habilitados = new Set(
    modulos.filter((m) => m.habilitado).map((m) => m.modulo),
  );

  const items = ACCESOS_RAPIDOS.filter((accion) => {
    if (accion.permission && !permissions.includes(accion.permission)) return false;
    if (accion.modulo && !habilitados.has(accion.modulo)) return false;
    return true;
  });

  return opts.superAdmin ? [...items, ACCESO_SUPER_ADMIN] : items;
}

// ─── Datos de los gráficos ───────────────────────────────────────────────────

/** Orden del ciclo de vida del turno; también fija el orden del gráfico. */
const ORDEN_ESTADOS: EstadoTurno[] = ["Programado", "Confirmado", "Completado", "Cancelado"];

export interface TurnosPorEstado {
  estado:   EstadoTurno;
  cantidad: number;
}

/**
 * Distribución por estado de los turnos del día, calculada sobre la MISMA lista
 * que alimenta el panel de "Turnos de hoy": el gráfico no dispara otro request.
 * Los estados sin turnos se omiten (no aportan barra).
 */
export function turnosPorEstado(turnos: Turno[]): TurnosPorEstado[] {
  const conteo = new Map<EstadoTurno, number>();
  for (const turno of turnos) {
    conteo.set(turno.status, (conteo.get(turno.status) ?? 0) + 1);
  }
  return ORDEN_ESTADOS
    .filter((estado) => (conteo.get(estado) ?? 0) > 0)
    .map((estado) => ({ estado, cantidad: conteo.get(estado) ?? 0 }));
}

/** Etiqueta corta de un día ISO para el eje X ("lun 28"). */
export function etiquetaDiaCorto(iso: string): string {
  return new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString("es-AR", { weekday: "short", day: "numeric", timeZone: "UTC" })
    .replace(".", "");
}

/** Texto alternativo del gráfico de ocupación (accesibilidad: el SVG no se lee). */
export function resumenOcupacionTexto(
  dias: { date: string; ocupados: number; cupo: number }[],
): string {
  if (dias.length === 0) return "Sin datos de ocupación.";
  return dias
    .map((d) => `${etiquetaDiaCorto(d.date)}: ${d.ocupados} de ${d.cupo}`)
    .join("; ");
}
