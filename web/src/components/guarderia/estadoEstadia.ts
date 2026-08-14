// Estados del ciclo de vida de una estadía de guardería (ENUM `estado_estadia`).
// El backend no cierra el union, así que `status` viaja como string; acá lo
// tratamos con claves conocidas y un fallback neutral para cualquier valor futuro.
export type EstadoEstadia = "Reservada" | "EnCurso" | "Finalizada" | "Cancelada";

// Semántica de badges de GUIA_ESTILO.md: ámbar=pendiente/reservada, verde=en curso
// (activo), gris=terminal (finalizada/cancelada). Fuente única para la vista de
// ocupación (badge por fila).
export const ESTADO_BADGE_CLASS: Record<EstadoEstadia, string> = {
  Reservada:  "bg-amber-100 text-amber-800 hover:bg-amber-100",
  EnCurso:    "bg-green-100 text-green-800 hover:bg-green-100",
  Finalizada: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  Cancelada:  "bg-gray-100 text-gray-800 hover:bg-gray-100",
};

// Etiqueta legible del estado (el ENUM usa CamelCase sin espacio para EnCurso).
export const ESTADO_LABEL: Record<EstadoEstadia, string> = {
  Reservada:  "Reservada",
  EnCurso:    "En curso",
  Finalizada: "Finalizada",
  Cancelada:  "Cancelada",
};

/**
 * Acento sutil por estado para la fila de ocupación (borde izquierdo). Refuerza el
 * badge para leer de un vistazo qué está reservado vs. en curso vs. cerrado.
 */
export const ESTADO_ROW_ACCENT: Record<EstadoEstadia, string> = {
  Reservada:  "border-l-amber-400",
  EnCurso:    "border-l-green-500",
  Finalizada: "border-l-gray-300",
  Cancelada:  "border-l-gray-300",
};

/**
 * Transición de avance derivada de la cadena lineal del ciclo de vida
 * (Reservada → check-in → EnCurso → check-out → Finalizada). Los estados
 * terminales no avanzan.
 *
 * OJO: esto decide SOLO qué botón DIBUJAR. La autoridad de si la acción procede es
 * del backend (PATCH /estadias/:id/checkin|checkout → INVALID_TRANSITION). El front
 * nunca autoriza por su cuenta.
 */
export const TRANSICION_SIGUIENTE: Record<
  EstadoEstadia,
  { action: "checkin" | "checkout"; label: string } | null
> = {
  Reservada:  { action: "checkin",  label: "Check-in" },
  EnCurso:    { action: "checkout", label: "Check-out" },
  Finalizada: null,
  Cancelada:  null,
};

/** Estados terminales: la estadía ya no avanza (RN-CK4). */
export const ESTADOS_TERMINALES = new Set<EstadoEstadia>(["Finalizada", "Cancelada"]);

export function esTerminal(status: string): boolean {
  return ESTADOS_TERMINALES.has(status as EstadoEstadia);
}

/**
 * RN-ME1 (`STAY_LOCKED`): una estadía terminal (Finalizada/Cancelada) no admite
 * modificación ni cancelación. El backend es la autoridad final; esto solo decide
 * si se DIBUJAN los botones.
 */
export function puedeModificar(status: string): boolean {
  return !esTerminal(status);
}

export function puedeCancelar(status: string): boolean {
  return !esTerminal(status);
}

/** Transición siguiente para un status arbitrario (string abierto del backend). */
export function transicionSiguiente(status: string) {
  return TRANSICION_SIGUIENTE[status as EstadoEstadia] ?? null;
}

export type AccionPendiente = "checkin" | "checkout";

// Etiqueta de la señalización "pendiente de acción" (el sistema avisa, el humano actúa).
export const PENDIENTE_LABEL: Record<AccionPendiente, string> = {
  checkin:  "Sin check-in (vencida)",
  checkout: "Sin check-out (vencida)",
};

/**
 * Señalización pura (front dibuja): una estadía quedó "pendiente de acción" cuando su
 * fecha ya pasó y nadie hizo la transición. NO cambia qué acción se ofrece ni afirma
 * nada del mundo real; solo la resalta para que el recepcionista decida (check-out si
 * la mascota se fue, o extender la estadía si sigue). Ver análisis #3.
 *
 * - "checkin":  Reservada cuya fecha de ingreso ya pasó (debió ingresar, sin check-in).
 * - "checkout": EnCurso cuya fecha de egreso ya pasó (debió egresar, sin check-out).
 *
 * Compara solo fechas YYYY-MM-DD (orden lexicográfico = cronológico).
 */
export function pendienteDeAccion(
  e: { status: string; checkInDate: string; checkOutDate: string },
  hoy: string,
): AccionPendiente | null {
  if (e.status === "Reservada" && e.checkInDate < hoy) return "checkin";
  if (e.status === "EnCurso" && e.checkOutDate < hoy) return "checkout";
  return null;
}
