import { describe, it, expect } from "vitest";
import {
  auditActionBadgeVariant,
  auditActionLabel,
  auditModuleLabel,
  diffValues,
  formatDiffValue,
} from "./auditoria.ts";

describe("auditModuleLabel / auditActionLabel", () => {
  it("traduce módulos y acciones conocidas", () => {
    expect(auditModuleLabel("medical_records")).toBe("Historial Clínico");
    expect(auditActionLabel("CREATE")).toBe("Creación");
  });

  it("valores desconocidos devuelven el crudo (defensivo ante nuevos ENUMs)", () => {
    expect(auditModuleLabel("otro_modulo")).toBe("otro_modulo");
    expect(auditActionLabel("RENAME")).toBe("RENAME");
  });
});

describe("auditActionBadgeVariant", () => {
  it("CREATE/LOGIN → default, UPDATE → secondary, DELETE/CANCEL/LOGOUT → destructive, resto → outline", () => {
    expect(auditActionBadgeVariant("CREATE")).toBe("default");
    expect(auditActionBadgeVariant("LOGIN")).toBe("default");
    expect(auditActionBadgeVariant("UPDATE")).toBe("secondary");
    expect(auditActionBadgeVariant("DELETE")).toBe("destructive");
    expect(auditActionBadgeVariant("CANCEL")).toBe("destructive");
    expect(auditActionBadgeVariant("LOGOUT")).toBe("destructive");
    expect(auditActionBadgeVariant("VIEW")).toBe("outline");
    expect(auditActionBadgeVariant("EXPORT")).toBe("outline");
  });
});

describe("diffValues", () => {
  it("una alta (oldValues=null) reporta todos los campos de newValues como 'after'", () => {
    const entries = diffValues(null, { fullName: "Ana", active: true });
    expect(entries).toEqual([
      { field: "active", before: undefined, after: true },
      { field: "fullName", before: undefined, after: "Ana" },
    ]);
  });

  it("una baja (newValues=null) reporta todos los campos de oldValues como 'before'", () => {
    const entries = diffValues({ fullName: "Ana" }, null);
    expect(entries).toEqual([{ field: "fullName", before: "Ana", after: undefined }]);
  });

  it("una actualización solo reporta los campos que cambiaron", () => {
    const entries = diffValues(
      { fullName: "Ana", phone: "111", active: true },
      { fullName: "Ana Pérez", phone: "111", active: true },
    );
    expect(entries).toEqual([{ field: "fullName", before: "Ana", after: "Ana Pérez" }]);
  });

  it("sin cambios (o ambos null) devuelve un arreglo vacío", () => {
    expect(diffValues({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffValues(null, null)).toEqual([]);
  });

  it("compara objetos anidados por valor, no por referencia", () => {
    const entries = diffValues({ meta: { x: 1 } }, { meta: { x: 1 } });
    expect(entries).toEqual([]);
  });
});

describe("formatDiffValue", () => {
  it("null/undefined → guion, booleanos → Sí/No, objetos → JSON, resto → String()", () => {
    expect(formatDiffValue(null)).toBe("—");
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue(true)).toBe("Sí");
    expect(formatDiffValue(false)).toBe("No");
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
    expect(formatDiffValue(42)).toBe("42");
    expect(formatDiffValue("texto")).toBe("texto");
  });
});
