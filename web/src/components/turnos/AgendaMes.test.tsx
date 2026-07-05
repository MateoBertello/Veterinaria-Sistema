import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Turno } from "../../types/index.ts";

vi.mock("../../api/turnos.ts", () => ({
  listarTurnosActivosDelMes: vi.fn(),
}));

import { AgendaMes } from "./AgendaMes.tsx";
import { listarTurnosActivosDelMes } from "../../api/turnos.ts";

const mockMes = vi.mocked(listarTurnosActivosDelMes);

// Mes fijo para asertar sobre días concretos, sin depender de la fecha real.
const MES = "2026-07-15";

function makeTurno(over: Partial<Turno> = {}): Turno {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-07-10",
    startTime: "10:00",
    endTime: "10:30",
    status: "Confirmado",
    reason: "Control",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: { id: "s1", nombre: "Consulta", tipo: "clinica", duracionMinutos: 30 },
    doctor: null,
    mascota: { id: "p1", name: "Max" },
    cliente: { id: "c1", fullName: "Ana" },
    accionesDisponibles: [],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("AgendaMes", () => {
  it("agrupa por día e indica la cantidad, con UNA sola consulta", async () => {
    mockMes.mockResolvedValue([
      makeTurno({ date: "2026-07-10" }),
      makeTurno({ date: "2026-07-10" }),
      makeTurno({ date: "2026-07-22" }),
    ]);

    render(<AgendaMes fechaInicial={MES} onSelectDay={() => {}} />);

    expect(await screen.findByText("2 turnos")).toBeInTheDocument();
    expect(screen.getByText("1 turno")).toBeInTheDocument();
    expect(mockMes).toHaveBeenCalledTimes(1);
  });

  it("click en un día invoca onSelectDay con esa fecha", async () => {
    const onSelectDay = vi.fn();
    mockMes.mockResolvedValue([makeTurno({ date: "2026-07-10" })]);

    render(<AgendaMes fechaInicial={MES} onSelectDay={onSelectDay} />);
    await screen.findByText("1 turno");

    await userEvent.click(screen.getByRole("button", { name: /10 de julio de 2026, 1 turno/ }));

    expect(onSelectDay).toHaveBeenCalledWith("2026-07-10");
  });

  it("navega al mes siguiente", async () => {
    mockMes.mockResolvedValue([]);
    render(<AgendaMes fechaInicial={MES} onSelectDay={() => {}} />);
    await waitFor(() => expect(screen.getByText(/julio de 2026/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));

    expect(await screen.findByText(/agosto de 2026/i)).toBeInTheDocument();
  });

  it("estado de error con reintentar", async () => {
    mockMes.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Boom mensual"));
    render(<AgendaMes fechaInicial={MES} onSelectDay={() => {}} />);
    expect(await screen.findByText("Boom mensual")).toBeInTheDocument();

    mockMes.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(mockMes).toHaveBeenCalledTimes(2));
  });
});
