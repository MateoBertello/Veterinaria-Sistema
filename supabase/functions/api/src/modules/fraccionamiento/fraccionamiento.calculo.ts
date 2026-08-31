export function redondear2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function redondear4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

export function costoUnitarioHijo(cantidadOrigen: number, costoPadre: number, cantidadObtenida: number): number {
  if (cantidadObtenida <= 0) return 0;
  return redondear4((cantidadOrigen * costoPadre) / cantidadObtenida);
}

export function desvioPorcentaje(teorico: number, obtenido: number): number {
  if (teorico <= 0) return 0;
  return redondear2(((teorico - obtenido) / teorico) * 100);
}

export function vencimientoSugerido(
  vencimientoPadre: string | null,
  vidaUtilPostAperturaDias: number | null,
  hoy: Date = new Date()
): string | null {
  if (!vencimientoPadre && !vidaUtilPostAperturaDias) return null;

  let fechaVidaUtil: Date | null = null;
  if (vidaUtilPostAperturaDias) {
    fechaVidaUtil = new Date(hoy);
    fechaVidaUtil.setDate(fechaVidaUtil.getDate() + vidaUtilPostAperturaDias);
  }

  if (vencimientoPadre && fechaVidaUtil) {
    const fechaPadre = new Date(`${vencimientoPadre}T00:00:00`);
    const menor = fechaPadre < fechaVidaUtil ? fechaPadre : fechaVidaUtil;
    return menor.toISOString().split("T")[0];
  }

  if (vencimientoPadre) return vencimientoPadre;
  if (fechaVidaUtil) return fechaVidaUtil.toISOString().split("T")[0];
  return null;
}
