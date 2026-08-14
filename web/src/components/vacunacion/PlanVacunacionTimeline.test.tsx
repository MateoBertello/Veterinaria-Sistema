import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("RN-PV1: 'Marcar aplicada' solo se ofrece para dosis con estado Pendiente (no estadoVisual)", () => {
    render(
      <PlanVacunacionTimeline
        dosis={[
          dosis({ id: "1", estado: "Pendiente", estadoVisual: "Vencida" }),
          dosis({ id: "2", estado: "Aplicada", estadoVisual: "Aplicada" }),
          dosis({ id: "3", estado: "Cancelada", estadoVisual: "Cancelada" }),
        ]}
        onMarcarAplicada={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Marcar aplicada" })).toHaveLength(1);
  });

  it("no muestra ningún botón de acción si no se pasa onMarcarAplicada", () => {
    render(<PlanVacunacionTimeline dosis={[dosis({ estado: "Pendiente" })]} />);

    expect(screen.queryByRole("button", { name: "Marcar aplicada" })).not.toBeInTheDocument();
  });

  it("RN-PV5: dispara onMarcarAplicada con la dosis clickeada", async () => {
    const user = userEvent.setup();
    const onMarcarAplicada = vi.fn();
    const pendiente = dosis({ id: "5", estado: "Pendiente" });

    render(<PlanVacunacionTimeline dosis={[pendiente]} onMarcarAplicada={onMarcarAplicada} />);

    await user.click(screen.getByRole("button", { name: "Marcar aplicada" }));
    expect(onMarcarAplicada).toHaveBeenCalledWith(pendiente);
  });
});
