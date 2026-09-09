export function redondear2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function descomponerLinea(
  precioUnitario: number,
  alicuota: number,
  cantidad: number,
  descuentoPorcentaje: number = 0
) {
  const netoUnitario = redondear2(precioUnitario / (1 + alicuota / 100));
  const ivaUnitario = redondear2(precioUnitario - netoUnitario); // POR DIFERENCIA
  const precioConDescuento = precioUnitario * (1 - descuentoPorcentaje / 100);
  const importeTotal = redondear2(precioConDescuento * cantidad);
  return { netoUnitario, ivaUnitario, importeTotal };
}
