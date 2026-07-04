import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type EstadoTurno, type Turno } from "../types/index.ts";

vi.mock("../api/turnos.ts", () => ({
  listarTurnosPorFecha: vi.fn(),
}));

import { TurnosPage } from "./TurnosPage.tsx";
import { listarTurnosPorFecha } from "../api/turnos.ts";

const mockListar = vi.mocked(listarTurnosPorFecha);

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDias(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + delta);
  return fecha.toISOString().slice(0, 10);
}

function makeTurno(over: Partial<Turno> = {}): Turno {
  return {
    id: "t1",
    date: hoyISO(),
    startTime: "10:00",
    endTime: "10:30",
    status: "Confirmado",
    reason: "Control general",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: { id: "s1", nombre: "Consulta general", tipo: "clinica", duracionMinutos: 30 },
    doctor: { id: "d1", name: "Dra. Ana Gómez" },
    mascota: { id: "p1", name: "Max" },
    cliente: { id: "c1", fullName: "María García" },
    accionesDisponibles: [],
    ...over,
  };
}

function renderPage() {
  return render(<TurnosPage />);
}

beforeEach(() => vi.clearAllMocks());

describe("TurnosPage", () => {
  it("carga y muestra los turnos del día actual", async () => {
    mockListar.mockResolvedValue([makeTurno()]);

    renderPage();

    expect(await screen.findByText("Max")).toBeInTheDocument();
    expect(screen.getByText("María García")).toBeInTheDocument();
    expect(screen.getByText("10:00 – 10:30")).toBeInTheDocument();
    expect(screen.getByText("Consulta general")).toBeInTheDocument();
    expect(screen.getByText("Dra. Ana Gómez")).toBeInTheDocument();
    expect(screen.getByText("Confirmado")).toBeInTheDocument();
    expect(mockListar).toHaveBeenCalledWith(hoyISO());
  });

  it("muestra el estado vacío cuando no hay turnos", async () => {
    mockListar.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/No hay turnos para el/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue([makeTurno()]);
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Max")).toBeInTheDocument();
  });

  it("el botón Hoy está deshabilitado cuando ya se muestra el día actual", async () => {
    mockListar.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/No hay turnos para el/i);

    expect(screen.getByRole("button", { name: "Hoy" })).toBeDisabled();
  });

  it("navega al día siguiente y vuelve a Hoy", async () => {
    mockListar.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/No hay turnos para el/i);

    await userEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    await waitFor(() => expect(mockListar).toHaveBeenLastCalledWith(addDias(hoyISO(), 1)));

    const hoyBtn = screen.getByRole("button", { name: "Hoy" });
    expect(hoyBtn).toBeEnabled();
    await userEvent.click(hoyBtn);
    await waitFor(() => expect(mockListar).toHaveBeenLastCalledWith(hoyISO()));
  });

  it.each<EstadoTurno>(["Programado", "Confirmado", "Completado", "Cancelado"])(
    "muestra el badge del estado %s",
    async (status) => {
      mockListar.mockResolvedValue([makeTurno({ status })]);
      renderPage();
      expect(await screen.findByText(status)).toBeInTheDocument();
    },
  );
});
