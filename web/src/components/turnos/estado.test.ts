import { describe, it, expect } from "vitest";
import type { EstadoTurno } from "../../types/index.ts";
import {
  ESTADO_BADGE_CLASS,
  ESTADO_ROW_ACCENT,
  ESTADOS_TERMINALES,
  TRANSICION_SIGUIENTE,
  esTerminal,
} from "./estado.ts";

const TODOS: EstadoTurno[] = ["Programado", "Confirmado", "Completado", "Cancelado"];

describe("estado (fuente única de turnos)", () => {
  it("ESTADOS_TERMINALES son exactamente Completado y Cancelado", () => {
    expect([...ESTADOS_TERMINALES].sort()).toEqual(["Cancelado", "Completado"]);
  });

  it("esTerminal coincide con la pertenencia al set", () => {
    expect(esTerminal("Completado")).toBe(true);
    expect(esTerminal("Cancelado")).toBe(true);
    expect(esTerminal("Programado")).toBe(false);
    expect(esTerminal("Confirmado")).toBe(false);
  });

  it("la transición existe si y solo si el estado NO es terminal", () => {
    for (const s of TODOS) {
      expect(TRANSICION_SIGUIENTE[s] !== null).toBe(!esTerminal(s));
    }
  });

  it("la cadena de transición es lineal Programado→Confirmado→Completado", () => {
    expect(TRANSICION_SIGUIENTE.Programado).toEqual({ status: "Confirmado", label: "Confirmar" });
    expect(TRANSICION_SIGUIENTE.Confirmado).toEqual({ status: "Completado", label: "Completar" });
  });

  it("hay clase de badge y de acento para cada estado", () => {
    for (const s of TODOS) {
      expect(ESTADO_BADGE_CLASS[s]).toBeTruthy();
      expect(ESTADO_ROW_ACCENT[s]).toBeTruthy();
    }
  });
});
