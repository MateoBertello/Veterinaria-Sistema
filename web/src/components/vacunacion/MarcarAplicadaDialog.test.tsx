import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Doctor, type DosisVacunacion } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));

vi.mock("../../api/vacunacion.ts", () => ({
  marcarDosisAplicada: vi.fn(),
}));

import { MarcarAplicadaDialog } from "./MarcarAplicadaDialog.tsx";
import { listarDoctores } from "../../api/doctores.ts";
import { marcarDosisAplicada } from "../../api/vacunacion.ts";

const mockDoctores = vi.mocked(listarDoctores);
const mockMarcar = vi.mocked(marcarDosisAplicada);

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: "d1", userId: "u1", name: "Dra. García", specialty: null,
    licenseNumber: null, available: true, createdAt: "2026-01-01T00:00:00Z", usuario: null,
    ...over,
  };
}

function makeDosis(over: Partial<DosisVacunacion> = {}): DosisVacunacion {
  return {
    id: "d1", petId: "pet1", tipoVacunaId: "t1", tipoVacunaNombre: "Antirrábica",
    eventoOrigenId: null, eventoAplicacionId: null, fechaEstimada: "2026-08-01",
    estado: "Pendiente", estadoVisual: "Proxima", notas: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function setup(dosis: DosisVacunacion | null = makeDosis()) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MarcarAplicadaDialog open dosis={dosis} onOpenChange={onOpenChange} onSaved={onSaved} />,
  );
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDoctores.mockResolvedValue({ items: [makeDoctor()], meta: { page: 1, limit: 100, total: 1 } });
});

describe("MarcarAplicadaDialog", () => {
  it("pide al backend solo doctores seleccionables como profesional (professional=true)", async () => {
    setup();

    await waitFor(() => expect(mockDoctores).toHaveBeenCalledTimes(1));
    expect(mockDoctores).toHaveBeenCalledWith(
      expect.objectContaining({ available: true, professional: true }),
    );
  });

  it("profesional vacío bloquea el envío", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar aplicación" }));

    expect(await screen.findByText("El profesional es requerido")).toBeInTheDocument();
    expect(mockMarcar).not.toHaveBeenCalled();
  });

  it("RN-PV5: marca la dosis aplicada con el profesional elegido y cierra el diálogo", async () => {
    const { onSaved, onOpenChange } = setup();
    mockMarcar.mockResolvedValue(makeDosis({ estado: "Aplicada", estadoVisual: "Aplicada" }));

    await userEvent.click(screen.getByLabelText(/Profesional \*/i));
    await userEvent.click(await screen.findByRole("option", { name: "Dra. García" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar aplicación" }));

    await waitFor(() => expect(mockMarcar).toHaveBeenCalledTimes(1));
    expect(mockMarcar).toHaveBeenCalledWith("d1", expect.objectContaining({ professionalId: "u1" }));
    expect(toastSuccess).toHaveBeenCalledWith("Dosis aplicada — se registró el evento clínico");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ estado: "Aplicada" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("peso fuera de rango (0-200 kg) bloquea el envío", async () => {
    setup();
    await userEvent.click(screen.getByLabelText(/Profesional \*/i));
    await userEvent.click(await screen.findByRole("option", { name: "Dra. García" }));
    await userEvent.type(screen.getByLabelText(/Peso \(kg\)/i), "300");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar aplicación" }));

    expect(await screen.findByText("Debe estar entre 0 y 200 kg")).toBeInTheDocument();
    expect(mockMarcar).not.toHaveBeenCalled();
  });
});
