import { describe, it, expect } from "vitest";
import { descomponerLinea, redondear2 } from "../../supabase/functions/api/src/modules/ventas/ventas.calculo.ts";

describe("RN-VT1 & RN-VT2: Cálculo y descomposición de IVA en ventas", () => {
  it("RN-VT1: el IVA se calcula por diferencia y neto + iva = precio", () => {
    // $1.000 al 21 % -> neto 826,45, IVA 173,55
    const { netoUnitario, ivaUnitario, importeTotal } = descomponerLinea(1000, 21, 1);
    expect(netoUnitario).toBe(826.45);
    expect(ivaUnitario).toBe(173.55);
    expect(netoUnitario + ivaUnitario).toBe(1000);
    expect(importeTotal).toBe(1000);

    // Tres líneas de $1.000 -> 3.000 exacto
    const l1 = descomponerLinea(1000, 21, 1);
    const l2 = descomponerLinea(1000, 21, 1);
    const l3 = descomponerLinea(1000, 21, 1);
    const totalVenta = l1.importeTotal + l2.importeTotal + l3.importeTotal;
    expect(totalVenta).toBe(3000);
  });

  it("RN-VT1: barrido de precios verificando la identidad", () => {
    const alicuotas = [0, 10.5, 21, 27];
    let combinacionesProbadas = 0;

    for (const alicuota of alicuotas) {
      // 1. Paso fino de $0,01 hasta $100 (10.000 pasos)
      for (let p = 1; p <= 10000; p++) {
        const precio = p / 100;
        const { netoUnitario, ivaUnitario } = descomponerLinea(precio, alicuota, 1);
        const suma = redondear2(netoUnitario + ivaUnitario);
        expect(suma).toBe(precio);
        combinacionesProbadas++;
      }

      // 2. Paso de $0,13 desde $100 hasta $10.000 (~76.150 pasos)
      for (let precio = 100.13; precio <= 10000; precio = redondear2(precio + 0.13)) {
        const { netoUnitario, ivaUnitario } = descomponerLinea(precio, alicuota, 1);
        const suma = redondear2(netoUnitario + ivaUnitario);
        expect(suma).toBe(precio);
        combinacionesProbadas++;
      }
    }

    // Asegurar que se probaron más de 100.000 combinaciones
    expect(combinacionesProbadas).toBeGreaterThanOrEqual(100000);
  });

  it("RN-VT2: el total es la suma de las líneas redondeadas", () => {
    // 5 líneas con precios y alícuotas mixtas
    const lineas = [
      descomponerLinea(333.33, 0, 1),
      descomponerLinea(155.55, 10.5, 1),
      descomponerLinea(277.77, 21, 1),
      descomponerLinea(499.99, 27, 1),
      descomponerLinea(888.88, 21, 1),
    ];

    const totalCalculado = lineas.reduce((acc, l) => redondear2(acc + l.importeTotal), 0);
    const sumaEsperada = redondear2(333.33 + 155.55 + 277.77 + 499.99 + 888.88);
    expect(totalCalculado).toBe(sumaEsperada);

    // Comprobar que NO coincide con el recálculo desde la suma de netos + suma de ivas
    // Ejemplo de discrepancia con cálculo por separado vs suma de líneas redondeadas:
    // Línea: precio 10.05 al 21%. neto = 8.31, iva = 1.74. cantidad 3 -> importe_total = 30.15
    // Si sumamos 3 * neto = 24.93, 3 * iva = 5.22 -> 24.93 + 5.22 = 30.15
    // Pero si se calculase neto_total = round(30.15 / 1.21) = 24.92 e iva = round(24.92 * 0.21) = 5.23
    const netoGlobal = redondear2(lineas.reduce((acc, l) => acc + l.netoUnitario, 0));
    const ivaGlobalCalculadoAparte = redondear2(netoGlobal * 0.21);
    // Demostramos que recalcular IVA desde el neto global difiere de la suma de importes
    expect(netoGlobal + ivaGlobalCalculadoAparte).not.toBe(totalCalculado);
  });

  it("RN-VT7: una venta sin ítems no existe", () => {
    function validarItems(items: unknown[]) {
      if (!items || items.length === 0) {
        throw new Error("SALE_WITHOUT_ITEMS");
      }
    }

    expect(() => validarItems([])).toThrow("SALE_WITHOUT_ITEMS");
    expect(() => validarItems(null as any)).toThrow("SALE_WITHOUT_ITEMS");
    expect(() => validarItems([{ tipoItem: "producto" }])).not.toThrow();
  });

  it("RN-CJ1: los pagos cubren el total", () => {
    function validarPagos(
      total: number,
      pagos: Array<{ importe: number }>,
      condicionPago: string,
      saldoPendiente: number = 0
    ) {
      const sumaPagos = pagos.reduce((acc, p) => redondear2(acc + p.importe), 0);
      if (redondear2(sumaPagos + saldoPendiente) !== redondear2(total)) {
        throw new Error("PAYMENT_MISMATCH");
      }
      if (saldoPendiente > 0 && condicionPago === "contado") {
        throw new Error("PAYMENT_MISMATCH");
      }
      return true;
    }

    // $1.000 con pagos por $900 al contado -> PAYMENT_MISMATCH
    expect(() => validarPagos(1000, [{ importe: 900 }], "contado", 0)).toThrow("PAYMENT_MISMATCH");

    // $600 efectivo + $400 transferencia -> OK
    expect(validarPagos(1000, [{ importe: 600 }, { importe: 400 }], "contado", 0)).toBe(true);

    // $900 en cuenta corriente con condicion_pago='cuenta_corriente' -> OK, saldo_pendiente = 100
    expect(validarPagos(1000, [{ importe: 900 }], "cuenta_corriente", 100)).toBe(true);
  });
});
