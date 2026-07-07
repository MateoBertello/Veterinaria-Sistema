import { describe, it, expect } from "vitest";
import {
  sanitizeLikeTerm,
  neutralizeFormula,
} from "../../supabase/functions/api/src/shared/sanitize.ts";

describe("sanitizeLikeTerm — anti inyección de filtro PostgREST", () => {
  it("RN-SEC: reemplaza la coma (separador de condiciones .or) por espacio", () => {
    // Un término con coma podría inyectar condiciones extra en .or(...)
    expect(sanitizeLikeTerm("x,activo.eq.true")).toBe("x activo.eq.true");
    expect(sanitizeLikeTerm("x,activo.eq.true")).not.toContain(",");
  });

  it("RN-SEC: elimina el wildcard % para que el usuario no controle el patrón", () => {
    expect(sanitizeLikeTerm("%admin%")).toBe(" admin ");
    expect(sanitizeLikeTerm("50%,foo")).not.toMatch(/[%,]/);
  });

  it("deja intactos los términos normales", () => {
    expect(sanitizeLikeTerm("Juan Pérez")).toBe("Juan Pérez");
  });
});

describe("neutralizeFormula — anti formula/CSV injection (CWE-1236)", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rfoo"])(
    "RN-SEC: prefija comilla simple cuando empieza con carácter peligroso (%s)",
    (payload) => {
      const out = neutralizeFormula(payload) as string;
      expect(out).toBe(`'${payload}`);
      expect(out.startsWith("'")).toBe(true);
    },
  );

  it("no toca strings normales", () => {
    expect(neutralizeFormula("Juan Pérez")).toBe("Juan Pérez");
    expect(neutralizeFormula("total = 5")).toBe("total = 5"); // el = no está al inicio
  });

  it("respeta strings vacíos y valores no-string", () => {
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula(null)).toBe(null);
    expect(neutralizeFormula(42)).toBe(42);
    expect(neutralizeFormula(undefined)).toBe(undefined);
  });
});
