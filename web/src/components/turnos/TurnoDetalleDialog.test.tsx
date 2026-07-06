import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, ErrorCode, type Turno } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { TurnoDetalleDialog, type TurnoDetalleApi } from "./TurnoDetalleDialog.tsx";

beforeEach(() => vi.clearAllMocks());

function makeTurno(over: Partial<Turno> = {}): Turno {
  return {
    id: "t1",
    date: "2026-07-10",
    startTime: "10:00",
    endTime: "10:30",
    status: "Programado",
    reason: "Control anual",
    notes: null,
    cancellationReason: null,
    cancelledAt: null,
    servicio: { id: "s1", nombre: "Consulta", tipo: "clinica", duracionMinutos: 30 },
    doctor: { id: "d1", name: "Dra. Ana Gómez" },
    mascota: { id: "m1", name: "Firulais" },
    cliente: { id: "c1", fullName: "Juan Pérez" },
    accionesDisponibles: ["modificar", "cancelar", "eliminar"],
    ...over,
  };
}

function makeApi(turno: Turno): TurnoDetalleApi & {
  obtenerTurno: ReturnType<typeof vi.fn>;
  cancelarTurno: ReturnType<typeof vi.fn>;
  cambiarEstado: ReturnType<typeof vi.fn>;
  eliminarTurno: ReturnType<typeof vi.fn>;
} {
  return {
    obtenerTurno: vi.fn().mockResolvedValue(turno),
    cancelarTurno: vi.fn().mockResolvedValue(turno),
    cambiarEstado: vi.fn().mockResolvedValue(turno),
    eliminarTurno: vi.fn().mockResolvedValue(undefined),
  };
}

function setup(turno: Turno, apiOver: Partial<TurnoDetalleApi> = {}) {
  const api = { ...makeApi(turno), ...apiOver };
  const onSuccess = vi.fn();
  const onModificar = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TurnoDetalleDialog
      turnoId={turno.id}
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      onModificar={onModificar}
      api={api}
    />,
  );
  return { api, onSuccess, onModificar, onOpenChange };
}

describe("TurnoDetalleDialog", () => {
  it("carga el detalle al abrir (accionesDisponibles solo viene en el detalle)", async () => {
    const { api } = setup(makeTurno());
    await waitFor(() => expect(api.obtenerTurno).toHaveBeenCalledWith("t1"));
    expect(await screen.findByText("Consulta")).toBeInTheDocument();
    expect(screen.getByText("Firulais")).toBeInTheDocument();
  });

  it("renderiza solo los botones que trae accionesDisponibles", async () => {
    setup(makeTurno({ accionesDisponibles: ["modificar", "cancelar", "eliminar"] }));
    expect(await screen.findByRole("button", { name: /^Modificar$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelar turno/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Eliminar$/ })).toBeInTheDocument();
  });

  it("estado terminal sin eliminar → sin acciones, muestra el aviso", async () => {
    setup(makeTurno({ status: "Completado", accionesDisponibles: [] }));
    expect(await screen.findByText(/No hay acciones disponibles/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Modificar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eliminar$/ })).not.toBeInTheDocument();
  });

  it("estado Cancelado con solo eliminar (por accionesDisponibles, no por rol)", async () => {
    setup(makeTurno({
      status: "Cancelado",
      cancellationReason: "El cliente no puede asistir",
      cancelledAt: "2026-07-05T09:00:00Z",
      accionesDisponibles: ["eliminar"],
    }));
    expect(await screen.findByRole("button", { name: /^Eliminar$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar turno/ })).not.toBeInTheDocument();
    expect(screen.getByText("El cliente no puede asistir")).toBeInTheDocument();
  });

  it("dibuja el botón de transición derivado del estado: Programado → Confirmar", async () => {
    setup(makeTurno({ status: "Programado" }));
    expect(await screen.findByRole("button", { name: /^Confirmar$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Completar$/ })).not.toBeInTheDocument();
  });

  it("dibuja Completar cuando el estado es Confirmado", async () => {
    setup(makeTurno({ status: "Confirmado" }));
    expect(await screen.findByRole("button", { name: /^Completar$/ })).toBeInTheDocument();
  });

  it("la transición llama cambiarEstado con el estado siguiente y refresca la agenda", async () => {
    const turno = makeTurno({ status: "Programado" });
    const { api, onSuccess } = setup(turno);
    await screen.findByRole("button", { name: /^Confirmar$/ });

    await userEvent.click(screen.getByRole("button", { name: /^Confirmar$/ }));

    await waitFor(() => expect(api.cambiarEstado).toHaveBeenCalledWith("t1", "Confirmado"));
    expect(onSuccess).toHaveBeenCalled();
  });

  it("RN-MC5: cancelar exige un motivo y llama cancelarTurno con él", async () => {
    const turno = makeTurno();
    const { api, onSuccess, onOpenChange } = setup(turno);
    await userEvent.click(await screen.findByRole("button", { name: /Cancelar turno/ }));

    // Sin motivo: no debe llamar al backend, muestra validación.
    await userEvent.click(screen.getByRole("button", { name: /Confirmar cancelación/ }));
    expect(api.cancelarTurno).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/motivo/i);

    await userEvent.type(screen.getByLabelText(/Motivo/), "No puede asistir");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar cancelación/ }));

    await waitFor(() => expect(api.cancelarTurno).toHaveBeenCalledWith("t1", "No puede asistir"));
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("modificar delega en onModificar y cierra el modal", async () => {
    const { onModificar, onOpenChange } = setup(makeTurno());
    await userEvent.click(await screen.findByRole("button", { name: /^Modificar$/ }));
    expect(onModificar).toHaveBeenCalledWith("t1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("APPOINTMENT_LOCKED en una acción → toast de error y re-fetch del detalle", async () => {
    const turno = makeTurno({ status: "Programado" });
    const api = makeApi(turno);
    api.cambiarEstado.mockRejectedValueOnce(
      new ApiError(ErrorCode.APPOINTMENT_LOCKED, 422, "El turno está bloqueado"),
    );
    setup(turno, api);
    await screen.findByRole("button", { name: /^Confirmar$/ });
    expect(api.obtenerTurno).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /^Confirmar$/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("El turno está bloqueado"));
    // Re-fetch: el detalle se vuelve a pedir para refrescar acciones.
    await waitFor(() => expect(api.obtenerTurno).toHaveBeenCalledTimes(2));
  });

  it("INVALID_TRANSITION en la transición → toast de error y re-fetch", async () => {
    const turno = makeTurno({ status: "Confirmado" });
    const api = makeApi(turno);
    api.cambiarEstado.mockRejectedValueOnce(
      new ApiError(ErrorCode.INVALID_TRANSITION, 422, "Transición inválida"),
    );
    setup(turno, api);
    await userEvent.click(await screen.findByRole("button", { name: /^Completar$/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Transición inválida"));
    await waitFor(() => expect(api.obtenerTurno).toHaveBeenCalledTimes(2));
  });

  it("muestra el estado de error de carga con reintentar", async () => {
    const api = makeApi(makeTurno());
    api.obtenerTurno.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Boom"));
    setup(makeTurno(), api);
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    const reintentar = screen.getByRole("button", { name: /Reintentar/ });
    await userEvent.click(reintentar);
    await waitFor(() => expect(api.obtenerTurno).toHaveBeenCalledTimes(2));
  });

  it("RN-MC5: eliminar pide confirmación y llama eliminarTurno", async () => {
    const turno = makeTurno({ status: "Cancelado", accionesDisponibles: ["eliminar"] });
    const { api, onSuccess, onOpenChange } = setup(turno);
    await userEvent.click(await screen.findByRole("button", { name: /^Eliminar$/ }));

    // El AlertDialog de confirmación tiene su propio botón Eliminar.
    const dialogs = screen.getAllByRole("alertdialog");
    const confirm = within(dialogs[dialogs.length - 1]).getByRole("button", { name: /^Eliminar$/ });
    await userEvent.click(confirm);

    await waitFor(() => expect(api.eliminarTurno).toHaveBeenCalledWith("t1"));
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
