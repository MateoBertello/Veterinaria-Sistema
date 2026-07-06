import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanVacunacionTimeline } from "./PlanVacunacionTimeline.tsx";
import type { DosisVacunacion } from "../../types/index.ts";

function dosis(overrides: Partial<DosisVacunacion>): DosisVacunacion {
  return {
    id:                 "d1",
    petId:              "p1",
    tipoVacunaId:       "t1",
    tipoVacunaNombre:   "Antirrábica",
    eventoOrigenId:     null,
    eventoAplicacionId: null,
    fechaEstimada:      "2026-01-15",
    estado:             "Pendiente",
    estadoVisual:       "Proxima",
    notas:              null,
    createdAt:          "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PlanVacunacionTimeline", () => {
  it("muestra el label correcto para cada estadoVisual", () => {
    render(
      <PlanVacunacionTimeline
        dosis={[
          dosis({ id: "1", estadoVisual: "Vencida" }),
          dosis({ id: "2", estadoVisual: "Proxima" }),
          dosis({ id: "3", estadoVisual: "Aplicada" }),
          dosis({ id: "4", estadoVisual: "Cancelada" }),
        ]}
      />,
    );

    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.getByText("Próxima")).toBeInTheDocument();
    expect(screen.getByText("Aplicada")).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });

  it("muestra tipoVacunaNombre y notas cuando existen, y no rompe si notas es null", () => {
    render(
      <PlanVacunacionTimeline
        dosis={[dosis({ tipoVacunaNombre: "Triple Felina", notas: "Refuerzo anual" })]}
      />,
    );

    expect(screen.getByText("Triple Felina")).toBeInTheDocument();
    expect(screen.getByText("Refuerzo anual")).toBeInTheDocument();
  });

  it("respeta el orden recibido por props sin reordenar", () => {
    render(
      <PlanVacunacionTimeline
        dosis={[
          dosis({ id: "1", tipoVacunaNombre: "Primera" }),
          dosis({ id: "2", tipoVacunaNombre: "Segunda" }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Primera");
    expect(items[1]).toHaveTextContent("Segunda");
  });
});
