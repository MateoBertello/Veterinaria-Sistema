import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Franja } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError   = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { FranjaFormDialog } from "./FranjaFormDialog.tsx";

beforeEach(() => vi.clearAllMocks());

function makeFranja(over: Partial<Franja> = {}): Franja {
  return {
    id: "f1",
    doctorId: "d1",
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "13:00",
    active: true,
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof FranjaFormDialog>> = {}) {
  const crearFranja = vi.fn();
  const eliminarFranja = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FranjaFormDialog
      doctorId="d1"
      open
      onOpenChange={onOpenChange}
      crearFranja={crearFranja}
      eliminarFranja={eliminarFranja}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { crearFranja, eliminarFranja, onSaved, onOpenChange };
}

describe("FranjaFormDialog — alta", () => {
  it("muestra el título 'Agregar franja'", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Agregar franja/i })).toBeInTheDocument();
  });

  it("crea la franja con los valores ingresados y no borra nada", async () => {
    const { crearFranja, eliminarFranja, onSaved } = setup();
    const creada = makeFranja();
    crearFranja.mockResolvedValue(creada);

    await userEvent.type(screen.getByLabelText(/Hora inicio/i), "09:00");
    await userEvent.type(screen.getByLabelText(/Hora fin/i), "13:00");
    await userEvent.click(screen.getByRole("button", { name: /Agregar franja/i }));

    await waitFor(() => expect(crearFranja).toHaveBeenCalledTimes(1));
    expect(crearFranja).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ startTime: "09:00", endTime: "13:00" }),
    );
    expect(eliminarFranja).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(creada);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("RN-HOR1: INVALID_RANGE se muestra bajo hora fin y no llama a eliminar", async () => {
    const { crearFranja, eliminarFranja } = setup();
    crearFranja.mockRejectedValue(
      new ApiError("INVALID_RANGE", 422, "La hora de inicio debe ser anterior a la hora de fin"),
    );

    await userEvent.type(screen.getByLabelText(/Hora inicio/i), "13:00");
    await userEvent.type(screen.getByLabelText(/Hora fin/i), "09:00");
    await userEvent.click(screen.getByRole("button", { name: /Agregar franja/i }));

    expect(
      await screen.findByText(/La hora de inicio debe ser anterior a la hora de fin/i),
    ).toBeInTheDocument();
    expect(eliminarFranja).not.toHaveBeenCalled();
  });

  it("RN-HOR2: SCHEDULE_OVERLAP se muestra bajo hora inicio", async () => {
    const { crearFranja } = setup();
    crearFranja.mockRejectedValue(
      new ApiError("SCHEDULE_OVERLAP", 409, "La franja se solapa con otra franja activa"),
    );

    await userEvent.type(screen.getByLabelText(/Hora inicio/i), "09:00");
    await userEvent.type(screen.getByLabelText(/Hora fin/i), "13:00");
    await userEvent.click(screen.getByRole("button", { name: /Agregar franja/i }));

    expect(
      await screen.findByText(/La franja se solapa con otra franja activa/i),
    ).toBeInTheDocument();
  });
});

describe("FranjaFormDialog — edición (POST antes que DELETE)", () => {
  it("pre-llena día/horas/activa de la franja existente", () => {
    setup({ franja: makeFranja() });
    expect(screen.getByRole("heading", { name: /Editar franja/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Hora inicio/i)).toHaveValue("09:00");
    expect(screen.getByLabelText(/Hora fin/i)).toHaveValue("13:00");
  });

  it("hace POST de la franja nueva y luego DELETE de la vieja", async () => {
    const franja = makeFranja();
    const { crearFranja, eliminarFranja, onSaved } = setup({ franja });
    const nueva = makeFranja({ id: "f2", startTime: "10:00" });
    crearFranja.mockResolvedValue(nueva);
    eliminarFranja.mockResolvedValue({ deleted: true });

    const startTime = screen.getByLabelText(/Hora inicio/i);
    await userEvent.clear(startTime);
    await userEvent.type(startTime, "10:00");
    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(crearFranja).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(eliminarFranja).toHaveBeenCalledWith("f1"));
    expect(onSaved).toHaveBeenCalledWith(nueva);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("si el POST de la franja nueva falla, NO llama a eliminar (la franja original se conserva)", async () => {
    const franja = makeFranja();
    const { crearFranja, eliminarFranja } = setup({ franja });
    crearFranja.mockRejectedValue(
      new ApiError("SCHEDULE_OVERLAP", 409, "La franja se solapa con otra franja activa"),
    );

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    expect(
      await screen.findByText(/La franja se solapa con otra franja activa/i),
    ).toBeInTheDocument();
    expect(eliminarFranja).not.toHaveBeenCalled();
  });

  it("si el POST tiene éxito pero el DELETE falla, avisa con toast y de todos modos guarda la nueva", async () => {
    const franja = makeFranja();
    const { crearFranja, eliminarFranja, onSaved, onOpenChange } = setup({ franja });
    const nueva = makeFranja({ id: "f2" });
    crearFranja.mockResolvedValue(nueva);
    eliminarFranja.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500, "network error"));

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/franja nueva se creó/i),
      ),
    );
    expect(onSaved).toHaveBeenCalledWith(nueva);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
