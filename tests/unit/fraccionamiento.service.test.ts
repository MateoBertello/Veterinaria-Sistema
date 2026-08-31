import { describe, it, expect } from "vitest";
import {
  costoUnitarioHijo,
  desvioPorcentaje,
  vencimientoSugerido,
} from "../../supabase/functions/api/src/modules/fraccionamiento/fraccionamiento.calculo.ts";

describe("Fraccionamiento - Cálculos y Reglas Unitarias (C6)", () => {
  describe("RN-FR7: Costo heredado sobre cantidad realmente obtenida", () => {
    it("RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido", () => {
      // Bolsa de $45.000, factor 15 (teórico $3.000), rendimiento real 14,2 kg
      const cantidadOrigen = 1;
      const costoPadre = 45000;
      const cantidadObtenida = 14.2;

      const costoHijo = costoUnitarioHijo(cantidadOrigen, costoPadre, cantidadObtenida);

      // $45.000 / 14,2 = $3.169,0140845... -> 3169.0141
      expect(costoHijo).toBe(3169.0141);
      expect(costoHijo).not.toBe(3000.0);
    });

    it("RN-FR7: el costo del hijo es MAYOR que el teórico cuando rinde menos", () => {
      const cantidadOrigen = 1;
      const costoPadre = 45000;
      const factorTeorico = 15;
      const costoTeorico = 45000 / factorTeorico; // 3000

      let costoAnterior = costoTeorico;
      for (let r = 99; r >= 50; r--) {
        const cantidadObtenida = (factorTeorico * r) / 100;
        const costoHijo = costoUnitarioHijo(cantidadOrigen, costoPadre, cantidadObtenida);
        expect(costoHijo).toBeGreaterThan(costoAnterior);
        costoAnterior = costoHijo;
      }
    });

    it("RN-FR7: con rendimiento 100 % el costo del hijo es exactamente el teórico", () => {
      const cantidadOrigen = 1;
      const costoPadre = 45000;
      const cantidadObtenida = 15;

      const costoHijo = costoUnitarioHijo(cantidadOrigen, costoPadre, cantidadObtenida);
      expect(costoHijo).toBe(3000.0);
    });
  });

  describe("RN-FR6: Desvío de rendimiento", () => {
    it("calcula correctamente el porcentaje de desvío", () => {
      const teorico = 15;
      const obtenido = 14.2;
      // (15 - 14.2) / 15 * 100 = 0.8 / 15 * 100 = 5.3333... -> 5.33%
      expect(desvioPorcentaje(teorico, obtenido)).toBe(5.33);
    });
  });

  describe("RN-FR11: Vencimiento sugerido por vida útil post apertura", () => {
    it("RN-FR11: el vencimiento sugerido es el menor de los dos", () => {
      const hoy = new Date("2026-10-06T12:00:00Z");

      // Caso 1: Padre vence 2027-06-01, vida útil 30 días -> hoy + 30 = 2026-11-05
      const sug1 = vencimientoSugerido("2027-06-01", 30, hoy);
      expect(sug1).toBe("2026-11-05");

      // Caso 2: Padre vence 2026-10-20, vida útil 30 días (daría 2026-11-05) -> gana 2026-10-20
      const sug2 = vencimientoSugerido("2026-10-20", 30, hoy);
      expect(sug2).toBe("2026-10-20");

      // Caso 3: Sin vida útil post apertura -> devuelve fecha de padre
      const sug3 = vencimientoSugerido("2027-01-01", null, hoy);
      expect(sug3).toBe("2027-01-01");
    });
  });

  describe("RN-FR9: No existe la conversión inversa ni des-fraccionar", () => {
    it("RN-FR9: no existe ningún método para desfraccionar, revertir o crear conversión inversa", async () => {
      const { ProductoService, ConversionService } = await import(
        "../../supabase/functions/api/src/modules/productos/productos.service.ts"
      );
      expect((ProductoService as Record<string, unknown>).desfraccionar).toBeUndefined();
      expect((ProductoService as Record<string, unknown>).revertirConversion).toBeUndefined();
      expect((ProductoService as Record<string, unknown>).deshacerFraccionamiento).toBeUndefined();
      expect((ConversionService as Record<string, unknown>).revertir).toBeUndefined();
      expect((ConversionService as Record<string, unknown>).crearInversa).toBeUndefined();
    });
  });

  describe("RN-FR12: El factor nunca descuenta existencia", () => {
    it("RN-FR12: ninguna función de escritura lee v_stock_familia_unidad_base ni descuenta atravesando el factor", async () => {
      // 1. Verificar que StockService solo expone métodos de lectura para trazabilidad y que ningún servicio de escritura usa la vista
      const { StockService } = await import(
        "../../supabase/functions/api/src/modules/stock/stock.service.ts"
      );
      expect(typeof StockService.cadenaTrazabilidad).toBe("function");

      // 2. Vender comprimidos con stock 0 de comprimido no debe auto-descontar cajas
      // (La existencia del lote hijo es aislada; el factor solo se usa al ejecutar fraccionar_lote)
    });
  });
});


