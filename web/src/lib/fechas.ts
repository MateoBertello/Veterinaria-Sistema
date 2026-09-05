// Utilidades para fechas "de calendario" en ISO corto (YYYY-MM-DD), que es el
// formato en el que viajan por la API (fechaEstimada, date, …) y el que usan los
// <input type="date">. Todo el cálculo se hace en UTC para que el resultado no
// dependa del huso horario del navegador.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en ISO (YYYY-MM-DD), con la misma convención que el resto del front. */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * true si el string es una fecha ISO corta válida. No alcanza con la forma: se
 * comprueba que la fecha exista (`Date.parse` acepta "2026-02-31" corriéndola al
 * 3 de marzo), así que se valida el ida y vuelta.
 */
export function esFechaISO(valor: string): boolean {
  if (!ISO_DATE.test(valor)) return false;
  const [anio, mes, dia] = valor.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Suma meses de calendario a una fecha ISO y devuelve otra fecha ISO.
 * Si el día no existe en el mes destino se recorta al último día de ese mes
 * (31-ene + 1 mes → 28-feb), igual que `addMonths` de date-fns.
 */
export function sumarMeses(fechaISO: string, meses: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number) as [number, number, number];
  const mesDestino = mes - 1 + meses;
  // Día 0 del mes siguiente = último día del mes destino (Date.UTC normaliza el
  // desborde de mes y ajusta el año solo).
  const ultimoDiaDestino = new Date(Date.UTC(anio, mesDestino + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mesDestino, Math.min(dia, ultimoDiaDestino)))
    .toISOString()
    .slice(0, 10);
}

/** Fecha ISO en formato legible es-AR ("1 mar 2026"). */
export function formatFechaISO(fechaISO: string): string {
  return new Date(`${fechaISO}T00:00:00`).toLocaleDateString("es-AR", {
    year:  "numeric",
    month: "short",
    day:   "numeric",
  });
}

/**
 * Suma días a una fecha ISO y devuelve otra fecha ISO.
 * Cálculo en UTC para evitar desfases horarios.
 */
export function sumarDias(fechaISO: string, dias: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Calcula la diferencia en días calendario entre dos fechas ISO (fecha2 - fecha1).
 * Si fecha2 es anterior a fecha1, el resultado es negativo.
 */
export function diferenciaDias(fechaISO1: string, fechaISO2: string): number {
  const [a1, m1, d1] = fechaISO1.split("-").map(Number) as [number, number, number];
  const [a2, m2, d2] = fechaISO2.split("-").map(Number) as [number, number, number];
  const utc1 = Date.UTC(a1, m1 - 1, d1);
  const utc2 = Date.UTC(a2, m2 - 1, d2);
  const MS_POR_DIA = 1000 * 60 * 60 * 24;
  return Math.round((utc2 - utc1) / MS_POR_DIA);
}
