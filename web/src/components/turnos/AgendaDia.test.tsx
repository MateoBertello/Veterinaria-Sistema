import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type EstadoTurno, type Turno } from "../../types/index.ts";

vi.mock("../../api/turnos.ts", () => ({
  listarTurnos: vi.fn(),
  obtenerTurno: vi.fn(),
  cancelarTurno: vi.fn(),
  cambiarEstado: vi.fn(),
  eliminarTurno: vi.fn(),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { AgendaDia } from "./AgendaDia.tsx";
import { listarTurnos, cambiarEstado } from "../../api/turnos.ts";

const mockListar = vi.mocked(listarTurnos);
const mockCambiar = vi.mocked(cambiarEstado);

const HOY = new Date().toISOString().slice(0, 10);

function makeTurno(over: Partial<Turno> = {}): Turno {
  return {
    id: "t1",
    date: HOY,
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
    vencido: false,
    ...over,
  };
}

function renderDia() {
  return render(
    <MemoryRouter initialEntries={["/turnos"]}>
      <Routes>
        <Route path="/turnos" element={<AgendaDia fecha={HOY} onFecha={() => {}} />} />
        <Route path="/turnos/:id/editar" element={<div>Editar turno</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListar.mockResolvedValue([]);
});

describe("AgendaDia", () => {
  it("carga y muestra los turnos del día (filtro Activos por defecto, sin status)", async () => {
    mockListar.mockResolvedValue([makeTurno()]);
    renderDia();

    expect(await screen.findByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Consulta general")).toBeInTheDocument();
    expect(mockListar).toHaveBeenCalledWith({ date: HOY, status: undefined });
  });

  it("marca visualmente un turno vencido sin cerrar con el badge 'Vencido'", async () => {
    mockListar.mockResolvedValue([makeTurno({ vencido: true })]);
    renderDia();
    expect(await screen.findByText("Vencido")).toBeInTheDocument();
  });

  it("no muestra el badge 'Vencido' en un turno al día", async () => {
    mockListar.mockResolvedValue([makeTurno({ vencido: false })]);
    renderDia();
    await screen.findByText("Max");
    expect(screen.queryByText("Vencido")).not.toBeInTheDocument();
  });

  it("el resumen desglosa programados vs confirmados en Activos", async () => {
    mockListar.mockResolvedValue([
      makeTurno({ id: "a", status: "Programado" }),
      makeTurno({ id: "b", status: "Programado" }),
      makeTurno({ id: "c", status: "Confirmado" }),
    ]);
    renderDia();
    expect(await screen.findByText(/2 programados · 1 confirmado · 3 en total/)).toBeInTheDocument();
  });

  it("el chip Completados refetchea con status=Completado", async () => {
    mockListar.mockResolvedValue([makeTurno()]);
    renderDia();
    await screen.findByText("Max");

    await userEvent.click(screen.getByRole("button", { name: "Completados" }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({ date: HOY, status: "Completado" }),
    );
  });

  it("muestra el botón Editar en turnos no terminales y navega a edición", async () => {
    mockListar.mockResolvedValue([makeTurno({ status: "Confirmado" })]);
    renderDia();
    await screen.findByText("Max");

    await userEvent.click(screen.getByRole("button", { name: /Editar turno de Max/ }));

    expect(await screen.findByText("Editar turno")).toBeInTheDocument();
  });

  it("NO muestra Editar ni transición en turnos terminales", async () => {
    mockListar.mockResolvedValue([makeTurno({ status: "Completado" })]);
    renderDia();
    await screen.findByText("Max");

    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar|Completar/ })).not.toBeInTheDocument();
  });

  it("la transición inline llama cambiarEstado con el estado siguiente y refresca", async () => {
    mockListar.mockResolvedValueOnce([makeTurno({ status: "Programado" })]);
    mockCambiar.mockResolvedValue(makeTurno({ status: "Confirmado" }));
    mockListar.mockResolvedValueOnce([makeTurno({ status: "Confirmado" })]);
    renderDia();

    const confirmar = await screen.findByRole("button", { name: "Confirmar" });
    await userEvent.click(confirmar);

    await waitFor(() => expect(mockCambiar).toHaveBeenCalledWith("t1", "Confirmado"));
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(mockListar).toHaveBeenCalledTimes(2)); // refresca
  });

  it("un rechazo del backend en la transición muestra toast de error y refresca", async () => {
    mockListar.mockResolvedValue([makeTurno({ status: "Confirmado" })]);
    mockCambiar.mockRejectedValue(new ApiError("INVALID_TRANSITION", 422, "Transición inválida"));
    renderDia();

    await userEvent.click(await screen.findByRole("button", { name: "Completar" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Transición inválida"));
    await waitFor(() => expect(mockListar).toHaveBeenCalledTimes(2));
  });

  it("click en la fila abre el modal de detalle (sin disparar acciones)", async () => {
    const { obtenerTurno } = await import("../../api/turnos.ts");
    vi.mocked(obtenerTurno).mockResolvedValue(makeTurno({ accionesDisponibles: ["modificar"] }));
    mockListar.mockResolvedValue([makeTurno()]);
    renderDia();

    await userEvent.click(await screen.findByText("Max"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Detalle del turno/)).toBeInTheDocument();
  });

  it("estado vacío por filtro", async () => {
    mockListar.mockResolvedValue([]);
    renderDia();
    expect(await screen.findByText(/No hay turnos para el/)).toBeInTheDocument();
  });

  it("estado de error con reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));
    renderDia();
    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue([makeTurno()]);
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Max")).toBeInTheDocument();
  });

  it.each<EstadoTurno>(["Programado", "Confirmado", "Completado", "Cancelado"])(
    "muestra el badge del estado %s",
    async (status) => {
      mockListar.mockResolvedValue([makeTurno({ status })]);
      renderDia();
      expect(await screen.findByText(status)).toBeInTheDocument();
    },
  );
});
