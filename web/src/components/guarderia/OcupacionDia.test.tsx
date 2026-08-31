import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type CupoDia, type Estadia } from "../../types/index.ts";

vi.mock("../../api/estadias.ts", () => ({
  listarEstadias: vi.fn(),
  obtenerCupo: vi.fn(),
  checkinEstadia: vi.fn(),
  checkoutEstadia: vi.fn(),
  cancelarEstadia: vi.fn(),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { OcupacionDia } from "./OcupacionDia.tsx";
import {
  listarEstadias,
  obtenerCupo,
  checkinEstadia,
  checkoutEstadia,
  cancelarEstadia,
} from "../../api/estadias.ts";

const mockListar = vi.mocked(listarEstadias);
const mockCupo = vi.mocked(obtenerCupo);
const mockCheckin = vi.mocked(checkinEstadia);
const mockCheckout = vi.mocked(checkoutEstadia);
const mockCancelar = vi.mocked(cancelarEstadia);

const HOY = new Date().toISOString().slice(0, 10);
const AYER = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function makeEstadia(over: Partial<Estadia> = {}): Estadia {
  return {
    id: "e1",
    clientId: "c1",
    petId: "p1",
    checkInDate: HOY,
    checkOutDate: HOY,
    status: "Reservada",
    reason: "Vacaciones",
    notes: null,
    createdAt: "2027-01-01T10:00:00Z",
    checkedInAt: null,
    checkedOutAt: null,
    petName: "Firulais",
    petTamano: "Mediano",
    petDieta: "Sin granos",
    clientName: "Juan Pérez",
    ...over,
  };
}

function makeCupo(over: Partial<CupoDia> = {}): CupoDia {
  return { date: HOY, ocupados: 1, cupo: 5, disponible: 4, ...over };
}

function renderOcupacion() {
  return render(<OcupacionDia fecha={HOY} onFecha={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListar.mockResolvedValue([]);
  mockCupo.mockResolvedValue([makeCupo()]);
});

describe("OcupacionDia", () => {
  it("carga la lista del día y el indicador de cupo", async () => {
    mockListar.mockResolvedValue([makeEstadia()]);
    mockCupo.mockResolvedValue([makeCupo({ ocupados: 2, cupo: 5, disponible: 3 })]);
    renderOcupacion();

    expect(await screen.findByText("Firulais")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("2 de 5 lugares ocupados")).toBeInTheDocument();
    expect(mockListar).toHaveBeenCalledWith({ date: HOY });
    expect(mockCupo).toHaveBeenCalledWith({ dateFrom: HOY, dateTo: HOY });
  });

  it("estado vacío cuando no hay mascotas ese día", async () => {
    renderOcupacion();
    expect(await screen.findByText(/No hay huéspedes en la guardería/)).toBeInTheDocument();
  });

  it("muestra Check-in solo en Reservada", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    renderOcupacion();

    expect(await screen.findByRole("button", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check-out" })).not.toBeInTheDocument();
  });

  it("muestra Check-out solo en EnCurso", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "EnCurso" })]);
    renderOcupacion();

    expect(await screen.findByRole("button", { name: "Check-out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check-in" })).not.toBeInTheDocument();
  });

  it("no ofrece acciones en estados terminales (Finalizada)", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Finalizada" })]);
    renderOcupacion();

    expect(await screen.findByText("Finalizada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check-in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check-out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modificar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("muestra Modificar y Cancelar en Reservada y en EnCurso", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    renderOcupacion();
    expect(await screen.findByRole("button", { name: "Modificar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("oculta Modificar/Cancelar en Cancelada", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Cancelada" })]);
    renderOcupacion();

    expect(await screen.findByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modificar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("Modificar navega a la ruta de edición pasando la estadía por router state", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Modificar" }));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/guarderia/e1/editar",
      { state: expect.objectContaining({ id: "e1" }) },
    );
  });

  it("RN-ME4: Cancelar exige motivo, llama a la API con el motivo y refetea lista+cupo", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    mockCancelar.mockResolvedValue(makeEstadia({ status: "Cancelada" }));
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Cancelar estadía")).toBeInTheDocument();

    // Sin motivo: no se llama a la API.
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByText("El motivo es requerido")).toBeInTheDocument();
    expect(mockCancelar).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Motivo *"), "El dueño canceló el viaje");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    await waitFor(() => expect(mockCancelar).toHaveBeenCalledWith("e1", "El dueño canceló el viaje"));
    expect(toastSuccess).toHaveBeenCalledWith("Estadía cancelada");
    // refetch: carga inicial + refetch tras cancelar.
    await waitFor(() => expect(mockListar).toHaveBeenCalledTimes(2));
  });

  it("STAY_LOCKED al cancelar → toast de error con el mensaje del backend", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    mockCancelar.mockRejectedValue(new ApiError("STAY_LOCKED", 422, "La estadía ya no admite cambios", []));
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await userEvent.type(screen.getByLabelText("Motivo *"), "Motivo cualquiera");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("La estadía ya no admite cambios"));
  });

  it("check-in exitoso: llama la API, toast de éxito y refetch", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    mockCheckin.mockResolvedValue(makeEstadia({ status: "EnCurso" }));
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Check-in" }));

    await waitFor(() => expect(mockCheckin).toHaveBeenCalledWith("e1"));
    expect(toastSuccess).toHaveBeenCalledWith("Check-in de Firulais registrado");
    // refetch: la lista se vuelve a pedir tras la acción (carga inicial + 1).
    await waitFor(() => expect(mockListar).toHaveBeenCalledTimes(2));
  });

  it("check-out exitoso: llama la API y toast de éxito", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "EnCurso" })]);
    mockCheckout.mockResolvedValue(makeEstadia({ status: "Finalizada" }));
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Check-out" }));

    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("e1"));
    expect(toastSuccess).toHaveBeenCalledWith("Check-out de Firulais registrado");
  });

  it("INVALID_TRANSITION del backend → toast de error con su mensaje (backend es autoridad)", async () => {
    mockListar.mockResolvedValue([makeEstadia({ status: "Reservada" })]);
    mockCheckin.mockRejectedValue(
      new ApiError("INVALID_TRANSITION", 422, "La transición de estado no es válida", []),
    );
    renderOcupacion();

    await userEvent.click(await screen.findByRole("button", { name: "Check-in" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("La transición de estado no es válida"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("dieta vacía cae al fallback 'Sin indicaciones de dieta'", async () => {
    mockListar.mockResolvedValue([makeEstadia({ petDieta: null })]);
    renderOcupacion();

    const fila = (await screen.findByText("Firulais")).closest("tr")!;
    expect(within(fila).getByText("Sin indicaciones de dieta")).toBeInTheDocument();
  });

  it("Reservada vencida (fecha de ingreso pasada) se resalta como pendiente de acción", async () => {
    mockListar.mockResolvedValue([
      makeEstadia({ status: "Reservada", checkInDate: AYER, checkOutDate: HOY }),
    ]);
    renderOcupacion();

    expect(await screen.findByText("Sin check-in (vencida)")).toBeInTheDocument();
    // Aviso-resumen que hace saltar el pendiente sin escanear la tabla.
    expect(screen.getByText(/1 estadía pendiente de acción/)).toBeInTheDocument();
  });

  it("EnCurso vencida (fecha de egreso pasada) → badge Sin check-out (vencida)", async () => {
    mockListar.mockResolvedValue([
      makeEstadia({ status: "EnCurso", checkInDate: AYER, checkOutDate: AYER }),
    ]);
    renderOcupacion();

    expect(await screen.findByText("Sin check-out (vencida)")).toBeInTheDocument();
  });

  it("estadía vigente (no vencida) no muestra señal de pendiente", async () => {
    mockListar.mockResolvedValue([
      makeEstadia({ status: "Reservada", checkInDate: HOY, checkOutDate: HOY }),
    ]);
    renderOcupacion();

    expect(await screen.findByText("Firulais")).toBeInTheDocument();
    expect(screen.queryByText(/vencida/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pendiente de acción/)).not.toBeInTheDocument();
  });

  it("error de carga muestra el mensaje y permite reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "No se pudo cargar la ocupación", []));
    renderOcupacion();

    expect(await screen.findByText("No se pudo cargar la ocupación")).toBeInTheDocument();

    mockListar.mockResolvedValue([makeEstadia()]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Firulais")).toBeInTheDocument();
  });
});
