// Utilidades de fecha compartidas por la agenda (día) y el calendario (mes).
// Todo en UTC para evitar corrimientos por zona horaria; las fechas son "YYYY-MM-DD".

export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDias(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + delta);
  return fecha.toISOString().slice(0, 10);
}

export function addMeses(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1 + delta, 1));
  return fecha.toISOString().slice(0, 10);
}

export function formatFechaLarga(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatMesLargo(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function diaDelMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

export interface CeldaCalendario {
  iso: string;
  enMes: boolean;
}

/**
 * Construye la grilla del mes que contiene `anchorISO`, en semanas de lunes a
 * domingo. Incluye los días de relleno del mes anterior/siguiente para completar
 * la primera y última semana (`enMes:false`).
 */
export function construirGrillaMes(anchorISO: string): CeldaCalendario[][] {
  const [y, m] = anchorISO.split("-").map(Number);
  const primero = new Date(Date.UTC(y, m - 1, 1));
  // getUTCDay: 0=domingo..6=sábado. Lunes-primero: cuántos días retroceder.
  const offsetLunes = (primero.getUTCDay() + 6) % 7;
  const inicio = new Date(primero);
  inicio.setUTCDate(inicio.getUTCDate() - offsetLunes);

  const semanas: CeldaCalendario[][] = [];
  const cursor = new Date(inicio);
  for (let semana = 0; semana < 6; semana++) {
    const fila: CeldaCalendario[] = [];
    for (let dia = 0; dia < 7; dia++) {
      const iso = cursor.toISOString().slice(0, 10);
      fila.push({ iso, enMes: cursor.getUTCMonth() === m - 1 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    semanas.push(fila);
    // Corta si ya pasamos el mes y completamos la semana (evita 6ª fila vacía).
    if (cursor.getUTCMonth() !== m - 1 && semana >= 3) break;
  }
  return semanas;
}
