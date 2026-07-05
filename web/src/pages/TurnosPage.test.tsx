import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../api/turnos.ts", () => ({
  listarTurnos: vi.fn(),
  listarTurnosActivosDelMes: vi.fn(),
  obtenerTurno: vi.fn(),
  cancelarTurno: vi.fn(),
  cambiarEstado: vi.fn(),
  eliminarTurno: vi.fn(),
}));

import { TurnosPage } from "./TurnosPage.tsx";
import { listarTurnos, listarTurnosActivosDelMes } from "../api/turnos.ts";

const mockListar = vi.mocked(listarTurnos);
const mockMes = vi.mocked(listarTurnosActivosDelMes);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/turnos"]}>
      <Routes>
        <Route path="/turnos" element={<TurnosPage />} />
        <Route path="/turnos/nuevo" element={<div>Agendar Turno</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListar.mockResolvedValue([]);
  mockMes.mockResolvedValue([]);
});

describe("TurnosPage (shell)", () => {
  it("arranca en la vista día (muestra la navegación de día)", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Día siguiente" })).toBeInTheDocument();
  });

  it("el toggle cambia a la vista mes (calendario)", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Día siguiente" });

    await userEvent.click(screen.getByRole("radio", { name: "Vista mes" }));

    // La grilla mensual muestra las cabeceras de días de la semana.
    expect(await screen.findByText("Lun")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Día siguiente" })).not.toBeInTheDocument();
  });

  it("Nuevo turno navega a /turnos/nuevo", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Día siguiente" });

    await userEvent.click(screen.getByRole("button", { name: /Nuevo turno/i }));

    expect(await screen.findByText("Agendar Turno")).toBeInTheDocument();
  });
});
