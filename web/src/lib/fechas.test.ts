import { describe, it, expect } from "vitest";
import { esFechaISO, formatFechaISO, sumarMeses } from "./fechas.ts";

describe("sumarMeses", () => {
  it("suma meses dentro del mismo año", () => {
    expect(sumarMeses("2026-03-15", 3)).toBe("2026-06-15");
  });

  it("cruza el fin de año", () => {
    expect(sumarMeses("2026-11-10", 3)).toBe("2027-02-10");
  });

  it("suma 12 meses (el refuerzo anual típico)", () => {
    expect(sumarMeses("2026-07-25", 12)).toBe("2027-07-25");
  });

  it("recorta al último día cuando el día no existe en el mes destino", () => {
    expect(sumarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumarMeses("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("respeta los años bisiestos al recortar", () => {
    expect(sumarMeses("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("no se corre de día por huso horario", () => {
    expect(sumarMeses("2026-01-01", 1)).toBe("2026-02-01");
    expect(sumarMeses("2026-12-31", 12)).toBe("2027-12-31");
  });
});

describe("esFechaISO", () => {
  it("acepta una fecha ISO corta válida", () => {
    expect(esFechaISO("2026-07-25")).toBe(true);
  });

  it("rechaza formatos que no son ISO corto o fechas inexistentes", () => {
    expect(esFechaISO("")).toBe(false);
    expect(esFechaISO("25/07/2026")).toBe(false);
    expect(esFechaISO("2026-07-25T10:00:00Z")).toBe(false);
    expect(esFechaISO("2026-02-31")).toBe(false);
  });
});

describe("formatFechaISO", () => {
  it("formatea en es-AR sin correrse de día", () => {
    expect(formatFechaISO("2026-03-01")).toMatch(/1.*mar.*2026/);
  });
});
