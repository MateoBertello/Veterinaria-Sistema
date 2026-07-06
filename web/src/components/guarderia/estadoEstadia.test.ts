import { describe, it, expect } from "vitest";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_LABEL,
  esTerminal,
  pendienteDeAccion,
  transicionSiguiente,
} from "./estadoEstadia.ts";

describe("estadoEstadia — mapa de transiciones (front dibuja, backend valida)", () => {
  it("Reservada avanza con check-in", () => {
    expect(transicionSiguiente("Reservada")).toEqual({ action: "checkin", label: "Check-in" });
  });

  it("EnCurso avanza con check-out", () => {
    expect(transicionSiguiente("EnCurso")).toEqual({ action: "checkout", label: "Check-out" });
  });

  it("los estados terminales no tienen transición siguiente", () => {
    expect(transicionSiguiente("Finalizada")).toBeNull();
    expect(transicionSiguiente("Cancelada")).toBeNull();
  });

  it("un status desconocido no rompe: sin transición y no terminal", () => {
    expect(transicionSiguiente("Otro")).toBeNull();
    expect(esTerminal("Otro")).toBe(false);
  });

  it("esTerminal distingue Finalizada/Cancelada de Reservada/EnCurso", () => {
    expect(esTerminal("Finalizada")).toBe(true);
    expect(esTerminal("Cancelada")).toBe(true);
    expect(esTerminal("Reservada")).toBe(false);
    expect(esTerminal("EnCurso")).toBe(false);
  });

  it("hay badge y label para cada estado del ENUM", () => {
    for (const s of ["Reservada", "EnCurso", "Finalizada", "Cancelada"] as const) {
      expect(ESTADO_BADGE_CLASS[s]).toBeTruthy();
      expect(ESTADO_LABEL[s]).toBeTruthy();
    }
    expect(ESTADO_LABEL.EnCurso).toBe("En curso");
  });
});

describe("pendienteDeAccion — señalización de estadías vencidas (el sistema avisa)", () => {
  const HOY = "2026-07-06";
  const base = { checkInDate: HOY, checkOutDate: HOY };

  it("Reservada con fecha de ingreso pasada → 'checkin' (debió ingresar)", () => {
    expect(pendienteDeAccion({ ...base, status: "Reservada", checkInDate: "2026-07-05" }, HOY)).toBe("checkin");
  });

  it("EnCurso con fecha de egreso pasada → 'checkout' (debió egresar)", () => {
    expect(pendienteDeAccion({ ...base, status: "EnCurso", checkOutDate: "2026-07-05" }, HOY)).toBe("checkout");
  });

  it("Reservada que ingresa hoy o en el futuro → null (no vencida)", () => {
    expect(pendienteDeAccion({ ...base, status: "Reservada", checkInDate: HOY }, HOY)).toBeNull();
    expect(pendienteDeAccion({ ...base, status: "Reservada", checkInDate: "2026-07-10" }, HOY)).toBeNull();
  });

  it("EnCurso cuyo egreso es hoy o futuro → null (todavía en curso)", () => {
    expect(pendienteDeAccion({ ...base, status: "EnCurso", checkOutDate: HOY }, HOY)).toBeNull();
    expect(pendienteDeAccion({ ...base, status: "EnCurso", checkOutDate: "2026-07-10" }, HOY)).toBeNull();
  });

  it("estados terminales nunca son pendientes, aunque la fecha haya pasado", () => {
    expect(pendienteDeAccion({ status: "Finalizada", checkInDate: "2026-01-01", checkOutDate: "2026-01-02" }, HOY)).toBeNull();
    expect(pendienteDeAccion({ status: "Cancelada", checkInDate: "2026-01-01", checkOutDate: "2026-01-02" }, HOY)).toBeNull();
  });
});
