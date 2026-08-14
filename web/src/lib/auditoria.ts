/**
 * auditoria.ts — metadatos de presentación (labels/badges) para los valores de
 * módulo/acción que devuelve el backend (identificadores de máquina en inglés,
 * ver AUDIT_MODULES/AUDIT_ACTIONS del backend) y el diff legible de un asiento.
 */

export const AUDIT_MODULE_LABELS: Record<string, string> = {
  clients:         "Clientes",
  pets:            "Mascotas",
  medical_records: "Historial Clínico",
  appointments:    "Turnos",
  daycare:         "Guardería",
  users:           "Usuarios",
  security:        "Seguridad",
  services:        "Servicios",
  system:          "Sistema",
  platform:        "Plataforma",
};

/** Etiqueta en español de un módulo; si es desconocido, muestra el valor crudo. */
export function auditModuleLabel(module: string): string {
  return AUDIT_MODULE_LABELS[module] ?? module;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "Creación",
  UPDATE: "Actualización",
  DELETE: "Eliminación",
  CANCEL: "Cancelación",
  LOGIN:  "Inicio de sesión",
  LOGOUT: "Cierre de sesión",
  VIEW:   "Consulta",
  EXPORT: "Exportación",
};

/** Etiqueta en español de una acción; si es desconocida, muestra el valor crudo. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export type AuditBadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Color del badge de acción: altas/ingresos en verde(default), cambios en gris,
 *  bajas/salidas en rojo, y consultas/exportaciones neutras. */
export function auditActionBadgeVariant(action: string): AuditBadgeVariant {
  switch (action) {
    case "CREATE":
    case "LOGIN":
      return "default";
    case "UPDATE":
      return "secondary";
    case "DELETE":
    case "CANCEL":
    case "LOGOUT":
      return "destructive";
    default:
      return "outline";
  }
}

export interface DiffEntry {
  field:  string;
  before: unknown;
  after:  unknown;
}

/**
 * Compara oldValues/newValues y devuelve solo los campos que cambiaron (diff
 * simple), para pintar un detalle legible sin volcar el JSON crudo. Un alta
 * (oldValues=null) deja `before` en undefined para cada campo; una baja
 * (newValues=null) deja `after` en undefined.
 */
export function diffValues(
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
): DiffEntry[] {
  const keys = new Set([
    ...Object.keys(oldValues ?? {}),
    ...Object.keys(newValues ?? {}),
  ]);

  const entries: DiffEntry[] = [];
  for (const field of keys) {
    const before = oldValues?.[field];
    const after = newValues?.[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    entries.push({ field, before, after });
  }

  return entries.sort((a, b) => a.field.localeCompare(b.field));
}

/** Formatea un valor individual del diff para mostrarlo como texto plano. */
export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
