/**
 * TurnosHoyCard — lista corta de la agenda del día + gráfico por estado.
 * Verifica que ambas vistas salgan de UNA sola consulta y los tres estados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type Turno } from "../../types/index.ts";

vi.mock("../../api/turnos.ts", () => ({ listarTurnos: vi.fn() }));

import { TurnosHoyCard } from "./TurnosHoyCard.tsx";
import { listarTurnos } from "../../api/turnos.ts";

const mockListar = vi.mocked(listarTurnos);

function turno(over: Partial<Turno> = {}): Turno {
  return {
    id: "t1",
    date: "2026-07-25",
    startTime: "09:00",
    endTime: "09:30",
    status: "Confirmado",
    reason: "Control anual",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: { id: "s1", nombre: "Consulta", duracionMinutos: 30 },
    doctor: null,
    mascota: { id: "m1", name: "Luna" },
    cliente: { id: "c1", fullName: "Ana Pérez" },
    accionesDisponibles: [],
    ...over,
  } as Turno;
}

function renderCard(fecha = "2026-07-25") {
  return render(
    <MemoryRouter>
      <TurnosHoyCard fecha={fecha} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TurnosHoyCard", () => {
  it("pide la agenda del día con UNA sola consulta y lista los turnos", async () => {
    mockListar.mockResolvedValue([turno()]);

    renderCard();

    expect(await screen.findByText("Luna")).toBeInTheDocument();
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("Confirmado")).toBeInTheDocument();
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(mockListar).toHaveBeenCalledWith({ date: "2026-07-25" });
  });

  it("muestra el estado vacío cuando no hay turnos", async () => {
    mockListar.mockResolvedValue([]);

    renderCard();

    expect(await screen.findByText(/No hay turnos agendados para hoy/i)).toBeInTheDocument();
  });

  it("muestra el error del backend sin romper la tarjeta", async () => {
    mockListar.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500, "Falló la agenda"));

    renderCard();

    expect(await screen.findByText("Falló la agenda")).toBeInTheDocument();
    // El acceso a la agenda completa sigue disponible.
    expect(screen.getByRole("link", { name: "Ver todos los turnos" })).toHaveAttribute("href", "/turnos");
  });

  it("corta la lista en 5 filas y avisa cuántas quedan sin mostrar", async () => {
    mockListar.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) =>
        turno({ id: `t${i}`, startTime: `0${i + 8}:00`, mascota: { id: `m${i}`, name: `Mascota${i}` } as Turno["mascota"] }),
      ),
    );

    renderCard();

    expect(await screen.findByText("Mascota0")).toBeInTheDocument();
    expect(screen.getByText("Mascota4")).toBeInTheDocument();
    expect(screen.queryByText("Mascota5")).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando 5 de 7 turnos/i)).toBeInTheDocument();
  });

  it("el gráfico expone su contenido como texto (el SVG no es accesible por sí solo)", async () => {
    mockListar.mockResolvedValue([
      turno({ id: "t1", status: "Confirmado" }),
      turno({ id: "t2", status: "Confirmado", startTime: "10:00" }),
      turno({ id: "t3", status: "Programado", startTime: "11:00" }),
    ]);

    renderCard();

    const grafico = await screen.findByRole("img", { name: /Turnos de hoy por estado/i });
    expect(grafico).toHaveAccessibleName(/Programado: 1/);
    expect(grafico).toHaveAccessibleName(/Confirmado: 2/);
  });

  it("recarga cuando cambia la fecha", async () => {
    mockListar.mockResolvedValue([]);

    const { rerender } = renderCard("2026-07-25");
    await waitFor(() => expect(mockListar).toHaveBeenCalledWith({ date: "2026-07-25" }));

    rerender(
      <MemoryRouter>
        <TurnosHoyCard fecha="2026-07-26" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockListar).toHaveBeenCalledWith({ date: "2026-07-26" }));
    expect(mockListar).toHaveBeenCalledTimes(2);
  });
});
