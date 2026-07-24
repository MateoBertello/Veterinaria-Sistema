import { describe, it, expect } from "vitest";
import { buildNavItems, BASE_NAV } from "../../web/src/lib/navigation.ts";
import type { ModuloContratado, ModuloVendible } from "../../web/src/types/index.ts";

const mod = (modulo: ModuloVendible, habilitado: boolean): ModuloContratado => ({
  modulo,
  habilitado,
  fechaAlta: null,
});

describe("buildNavItems: sidebar dinámico (RN-G2)", () => {
  it("oculta los módulos no contratados", () => {
    const items = buildNavItems([
      mod("historial_clinico", true),
      mod("turnos", false),
      mod("guarderia", false),
    ]);
    const keys = items.map((i) => i.key);

    expect(keys).toContain("historial_clinico");
    expect(keys).not.toContain("turnos");
    expect(keys).not.toContain("guarderia");
  });

  it("muestra los módulos contratados", () => {
    const items = buildNavItems([
      mod("historial_clinico", true),
      mod("turnos", true),
      mod("guarderia", true),
    ]);
    const keys = items.map((i) => i.key);

    expect(keys).toEqual(
      expect.arrayContaining(["historial_clinico", "turnos", "guarderia"]),
    );
  });

  it("incluye los ítems base siempre, aun sin módulos habilitados", () => {
    const items = buildNavItems([
      mod("historial_clinico", false),
      mod("turnos", false),
      mod("guarderia", false),
    ]);

    expect(items).toHaveLength(BASE_NAV.length);
    expect(items.map((i) => i.key)).toEqual(BASE_NAV.map((i) => i.key));
  });

  it("mantiene un orden estable: base, luego HC, turnos, guardería", () => {
    const items = buildNavItems([
      mod("guarderia", true),
      mod("turnos", true),
      mod("historial_clinico", true),
    ]);

    expect(items.map((i) => i.key)).toEqual([
      ...BASE_NAV.map((i) => i.key),
      "historial_clinico",
      "turnos",
      "guarderia",
    ]);
  });
});
