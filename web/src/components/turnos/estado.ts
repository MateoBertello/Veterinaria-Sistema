import type { EstadoTurno } from "../../types/index.ts";

// Paleta fijada en el Addendum v1.1 (pantalla 2, modal de detalle) para distinguir
// los 4 estados del ciclo de vida del turno. Fuente única: la reusan la agenda
// (badge por fila) y el modal de detalle.
export const ESTADO_BADGE_CLASS: Record<EstadoTurno, string> = {
  Programado: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  Confirmado: "bg-green-100 text-green-800 hover:bg-green-100",
  Completado: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  Cancelado: "bg-red-100 text-red-800 hover:bg-red-100",
};

/**
 * Transición de avance derivada de la cadena lineal del ciclo de vida
 * (Programado → Confirmado → Completado). Los estados terminales no avanzan.
 *
 * OJO: esto decide SOLO qué botón DIBUJAR. La autoridad de si la acción procede
 * es del backend (PATCH /turnos/:id/estado → INVALID_TRANSITION). El front nunca
 * autoriza por su cuenta. La cancelación NO es parte de esta cadena (va por
 * /cancelar y sale de `accionesDisponibles`).
 */
export const TRANSICION_SIGUIENTE: Record<
  EstadoTurno,
  { status: EstadoTurno; label: string } | null
> = {
  Programado: { status: "Confirmado", label: "Confirmar" },
  Confirmado: { status: "Completado", label: "Completar" },
  Completado: null,
  Cancelado: null,
};

/**
 * Estados terminales: el turno ya no avanza ni se modifica (RN-MC1). Fuente única
 * en el front. Coincide con `ESTADOS_TERMINALES` del backend y con la regla que
 * habilita `modificar` (no-terminal ⟹ modificable, independiente del rol).
 */
export const ESTADOS_TERMINALES = new Set<EstadoTurno>(["Completado", "Cancelado"]);

export function esTerminal(status: EstadoTurno): boolean {
  return ESTADOS_TERMINALES.has(status);
}

/**
 * Acento sutil por estado para la fila de la agenda (borde izquierdo). Refuerza el
 * badge para leer de un vistazo qué está confirmado vs. pendiente vs. cerrado.
 */
export const ESTADO_ROW_ACCENT: Record<EstadoTurno, string> = {
  Programado: "border-l-blue-400",
  Confirmado: "border-l-green-500",
  Completado: "border-l-gray-300",
  Cancelado: "border-l-red-400",
};
