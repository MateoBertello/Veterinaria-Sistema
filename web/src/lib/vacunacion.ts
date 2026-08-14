import type { TipoVacuna } from "../api/catalogos.ts";
import { esFechaISO, formatFechaISO, hoyISO, sumarMeses } from "./fechas.ts";

/**
 * Propuesta de refuerzo que el front pre-carga en el diálogo de programar dosis
 * (RN-PV10). Es solo una sugerencia: nada se crea hasta que el veterinario
 * confirma el diálogo.
 */
export interface RefuerzoSugerido {
  tipoVacunaId:   string;
  /** `meses_refuerzo_sugerido` del catálogo global. */
  meses:          number;
  /** Fecha teórica del refuerzo: fechaAplicada + meses. */
  fechaCalculada: string;
  /** Fecha que se pre-carga en el formulario: nunca anterior a hoy (RN-PV2). */
  fechaEstimada:  string;
  mensaje:        string;
}

/**
 * RN-PV10: al aplicar una dosis, el sistema propone el refuerzo siguiente según
 * el `meses_refuerzo_sugerido` del catálogo. Devuelve `null` cuando no hay nada
 * que sugerir (tipo de vacuna sin refuerzo definido o fuera del catálogo), y en
 * ese caso el flujo termina como siempre, sin diálogo extra.
 *
 * Si la fecha calculada quedó en el pasado (la aplicación se registró con fecha
 * vieja), se pre-carga **hoy** en vez de una fecha que el formulario rechazaría
 * por RN-PV2, y el mensaje aclara cuándo correspondía el refuerzo.
 */
export function calcularRefuerzoSugerido(
  tipo:          TipoVacuna | undefined,
  fechaAplicada: string,
  hoy:           string = hoyISO(),
): RefuerzoSugerido | null {
  const meses = tipo?.meses_refuerzo_sugerido ?? null;
  if (!tipo || meses === null || meses <= 0) return null;
  if (!esFechaISO(fechaAplicada)) return null;

  const fechaCalculada = sumarMeses(fechaAplicada, meses);
  const cada = meses === 1 ? "cada mes" : `cada ${meses} meses`;
  const esPasada = fechaCalculada < hoy;

  return {
    tipoVacunaId:  tipo.id,
    meses,
    fechaCalculada,
    fechaEstimada: esPasada ? hoy : fechaCalculada,
    mensaje: esPasada
      ? `Refuerzo de ${tipo.nombre} sugerido según el catálogo (${cada}): correspondía el ${formatFechaISO(fechaCalculada)}, una fecha ya pasada, así que se propone hoy. Podés ajustar la fecha antes de confirmar.`
      : `Refuerzo de ${tipo.nombre} sugerido según el catálogo (${cada}). Podés ajustar la fecha antes de confirmar.`,
  };
}
