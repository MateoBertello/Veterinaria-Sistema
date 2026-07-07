import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, ErrorCode, type DosisVacunacion } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/catalogos.ts", () => ({
  listarTiposVacuna: vi.fn(),
}));

vi.mock("../../api/vacunacion.ts", () => ({
  programarDosis: vi.fn(),
}));

import { ProgramarDosisDialog } from "./ProgramarDosisDialog.tsx";
import { listarTiposVacuna } from "../../api/catalogos.ts";
import { programarDosis } from "../../api/vacunacion.ts";

const mockTipos = vi.mocked(listarTiposVacuna);
const mockProgramar = vi.mocked(programarDosis);

function makeDosis(over: Partial<DosisVacunacion> = {}): DosisVacunacion {
  return {
    id: "d1", petId: "pet1", tipoVacunaId: "t1", tipoVacunaNombre: "Antirrábica",
    eventoOrigenId: null, eventoAplicacionId: null, fechaEstimada: "2026-08-01",
    estado: "Pendiente", estadoVisual: "Proxima", notas: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function setup() {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ProgramarDosisDialog open petId="pet1" onOpenChange={onOpenChange} onSaved={onSaved} />,
  );
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTipos.mockResolvedValue([
    { id: "t1", nombre: "Antirrábica", especie_aplicable: null, meses_refuerzo_sugerido: 12 },
    { id: "t2", nombre: "Quíntuple Canina", especie_aplicable: "Perro", meses_refuerzo_sugerido: 12 },
  ]);
});

async function elegirTipoVacuna(nombre: string) {
  await userEvent.click(screen.getByLabelText(/Tipo de vacuna \*/i));
  await userEvent.click(await screen.findByRole("option", { name: nombre }));
}

describe("ProgramarDosisDialog", () => {
  it("RN-PV3: tipo de vacuna vacío bloquea el envío", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("El tipo de vacuna es requerido")).toBeInTheDocument();
    expect(mockProgramar).not.toHaveBeenCalled();
  });

  it("RN-PV2: una fecha anterior a hoy bloquea el envío en el cliente", async () => {
    setup();
    await elegirTipoVacuna("Antirrábica");

    const fechaInput = screen.getByLabelText(/Fecha estimada \*/i);
    await userEvent.clear(fechaInput);
    await userEvent.type(fechaInput, "2020-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("La fecha estimada no puede ser anterior a hoy")).toBeInTheDocument();
    expect(mockProgramar).not.toHaveBeenCalled();
  });

  it("RN-PV2: refleja el PAST_DATE del server como error de campo en fechaEstimada", async () => {
    setup();
    await elegirTipoVacuna("Antirrábica");
    mockProgramar.mockRejectedValue(new ApiError(ErrorCode.PAST_DATE, 422, "La fecha estimada no puede ser anterior a hoy"));

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("La fecha estimada no puede ser anterior a hoy")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("programa la dosis con los campos mínimos y cierra el diálogo", async () => {
    const { onSaved, onOpenChange } = setup();
    await elegirTipoVacuna("Antirrábica");
    mockProgramar.mockResolvedValue(makeDosis());

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    await waitFor(() => expect(mockProgramar).toHaveBeenCalledTimes(1));
    expect(mockProgramar).toHaveBeenCalledWith(
      "pet1",
      expect.objectContaining({ tipoVacunaId: "t1" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Dosis programada");
    expect(onSaved).toHaveBeenCalledWith(makeDosis());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
