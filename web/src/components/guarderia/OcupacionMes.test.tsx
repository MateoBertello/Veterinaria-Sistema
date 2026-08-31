import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Estadia } from "../../types/index.ts";

vi.mock("../../api/estadias.ts", () => ({
  listarEstadiasRango: vi.fn(),
}));

import { OcupacionMes } from "./OcupacionMes.tsx";
import { listarEstadiasRango } from "../../api/estadias.ts";

const mockRango = vi.mocked(listarEstadiasRango);

// Mes fijo (no depende del reloj) para aserciones estables sobre la grilla.
const ANCHOR = "2027-11-15";

function makeEstadia(over: Partial<Estadia> = {}): Estadia {
  return {
    id: "e1",
    clientId: "c1",
    petId: "p1",
    checkInDate: "2027-11-10",
    checkOutDate: "2027-11-12",
    status: "Reservada",
    reason: "Vacaciones",
    notes: null,
    createdAt: "2027-01-01T10:00:00Z",
    checkedInAt: null,
    checkedOutAt: null,
    petName: "Firulais",
    petTamano: "Mediano",
    petDieta: null,
    clientName: "Juan Pérez",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRango.mockResolvedValue([]);
});

describe("OcupacionMes", () => {
  it("hace UNA sola consulta por el rango del mes visible (sin N+1)", async () => {
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={() => {}} />);

    await waitFor(() => expect(mockRango).toHaveBeenCalledTimes(1));
    const arg = mockRango.mock.calls[0][0];
    // La grilla arranca un lunes ≤ 1/11 y termina un domingo ≥ 30/11.
    expect(arg.dateFrom <= "2027-11-01").toBe(true);
    expect(arg.dateTo >= "2027-11-30").toBe(true);
  });

  it("pinta el conteo de estadías en los días que la estadía solapa", async () => {
    // Estadía 10→12 nov: cuenta en 3 días.
    mockRango.mockResolvedValue([makeEstadia({ checkInDate: "2027-11-10", checkOutDate: "2027-11-12" })]);
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={() => {}} />);

    // Aparecen chips "1 estadía" (uno por cada día solapado).
    const chips = await screen.findAllByText("1 estadía");
    expect(chips.length).toBe(3);
  });

  it("marca los días con estadías pendientes de acción (vencidas)", async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // Estadía Reservada con ingreso vencido → pendiente.
    mockRango.mockResolvedValue([
      makeEstadia({ status: "Reservada", checkInDate: ayer, checkOutDate: hoy }),
    ]);
    // Anclar al mes actual para que la grilla contenga ayer/hoy.
    render(<OcupacionMes fechaInicial={hoy} onSelectDay={() => {}} />);

    expect((await screen.findAllByText(/pendiente/)).length).toBeGreaterThanOrEqual(1);
  });

  it("click en un día llama onSelectDay con ese ISO", async () => {
    const onSelect = vi.fn();
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={onSelect} />);

    // Día 15 de noviembre (dentro del mes).
    const btn = await screen.findByRole("button", { name: /Ver el detalle del.*15 de noviembre de 2027/ });
    await userEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("2027-11-15");
  });

  it("WCAG 2.1.1: las celdas-día son botones enfocables y se activan con teclado (Enter)", async () => {
    const onSelect = vi.fn();
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={onSelect} />);

    const btn = await screen.findByRole("button", { name: /Ver el detalle del.*15 de noviembre de 2027/ });
    btn.focus();
    expect(btn).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("2027-11-15");
  });

  it("error de carga muestra mensaje y permite reintentar", async () => {
    mockRango.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "No se pudo cargar el calendario", []));
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={() => {}} />);

    expect(await screen.findByText("No se pudo cargar el calendario")).toBeInTheDocument();
    mockRango.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(mockRango).toHaveBeenCalledTimes(2));
  });

  it("el popover de vista previa lista las mascotas alojadas ese día sin salir del mes", async () => {
    mockRango.mockResolvedValue([
      makeEstadia({ checkInDate: "2027-11-10", checkOutDate: "2027-11-12", petName: "Firulais", clientName: "Juan Pérez" }),
    ]);
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={() => {}} />);
    await screen.findAllByText("1 estadía");

    const preview = screen.getByRole("button", { name: /Vista previa del.*10 de noviembre de 2027: 1 estadía/ });
    await userEvent.click(preview);

    expect(await screen.findByText("Firulais")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    // El mes sigue visible: el popover complementa el drill-down, no lo reemplaza.
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeInTheDocument();
  });

  it("el popover se abre por teclado (Enter) sin disparar el drill-down del día", async () => {
    const onSelect = vi.fn();
    mockRango.mockResolvedValue([
      makeEstadia({ checkInDate: "2027-11-10", checkOutDate: "2027-11-10", petName: "Firulais" }),
    ]);
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={onSelect} />);
    await screen.findAllByText("1 estadía");

    const preview = screen.getByRole("button", { name: /Vista previa del.*10 de noviembre de 2027/ });
    preview.focus();
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByText("Firulais")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("no ofrece vista previa en días sin estadías", async () => {
    mockRango.mockResolvedValue([
      makeEstadia({ checkInDate: "2027-11-10", checkOutDate: "2027-11-10" }),
    ]);
    render(<OcupacionMes fechaInicial={ANCHOR} onSelectDay={() => {}} />);
    await screen.findAllByText("1 estadía");

    expect(screen.queryByRole("button", { name: /Vista previa del.*11 de noviembre de 2027/ })).not.toBeInTheDocument();
  });
});
