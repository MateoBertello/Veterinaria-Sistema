import { describe, it, expect } from "vitest";
import type { TipoVacuna } from "../api/catalogos.ts";
import { calcularRefuerzoSugerido } from "./vacunacion.ts";

function makeTipo(over: Partial<TipoVacuna> = {}): TipoVacuna {
  return {
    id: "t1",
    nombre: "Antirrábica",
    especie_aplicable: null,
    meses_refuerzo_sugerido: 12,
    ...over,
  };
}

describe("calcularRefuerzoSugerido (RN-PV10)", () => {
  it("RN-PV10: propone el refuerzo a fechaAplicada + meses del catálogo", () => {
    const sugerido = calcularRefuerzoSugerido(makeTipo(), "2026-07-25", "2026-07-25");

    expect(sugerido).not.toBeNull();
    expect(sugerido?.tipoVacunaId).toBe("t1");
    expect(sugerido?.fechaEstimada).toBe("2027-07-25");
    expect(sugerido?.fechaCalculada).toBe("2027-07-25");
    expect(sugerido?.mensaje).toContain("cada 12 meses");
    expect(sugerido?.mensaje).toContain("Antirrábica");
  });

  it("RN-PV10: sin meses_refuerzo_sugerido no hay sugerencia", () => {
    expect(calcularRefuerzoSugerido(makeTipo({ meses_refuerzo_sugerido: null }), "2026-07-25")).toBeNull();
  });

  it("RN-PV10: un tipo de vacuna fuera del catálogo cargado no sugiere nada", () => {
    expect(calcularRefuerzoSugerido(undefined, "2026-07-25")).toBeNull();
  });

  it("RN-PV2/RN-PV10: si el refuerzo cae en el pasado, propone hoy y lo explica", () => {
    const sugerido = calcularRefuerzoSugerido(makeTipo({ meses_refuerzo_sugerido: 6 }), "2025-01-10", "2026-07-25");

    expect(sugerido?.fechaCalculada).toBe("2025-07-10");
    expect(sugerido?.fechaEstimada).toBe("2026-07-25");
    expect(sugerido?.mensaje).toMatch(/ya pasada/i);
    expect(sugerido?.mensaje).toMatch(/se propone hoy/i);
  });

  it("un refuerzo que cae justo hoy se propone tal cual (no es pasado)", () => {
    const sugerido = calcularRefuerzoSugerido(makeTipo({ meses_refuerzo_sugerido: 12 }), "2025-07-25", "2026-07-25");

    expect(sugerido?.fechaEstimada).toBe("2026-07-25");
    expect(sugerido?.mensaje).not.toMatch(/ya pasada/i);
  });

  it("singulariza el mensaje con un refuerzo mensual", () => {
    const sugerido = calcularRefuerzoSugerido(makeTipo({ meses_refuerzo_sugerido: 1 }), "2026-01-31", "2026-01-31");

    expect(sugerido?.mensaje).toContain("cada mes");
    expect(sugerido?.fechaEstimada).toBe("2026-02-28");
  });

  it("una fechaAplicada inválida no rompe el flujo: no sugiere nada", () => {
    expect(calcularRefuerzoSugerido(makeTipo(), "")).toBeNull();
    expect(calcularRefuerzoSugerido(makeTipo(), "25/07/2026")).toBeNull();
  });
});
