import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type Doctor } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError   = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

import { DoctorEditDialog } from "./DoctorEditDialog.tsx";

beforeEach(() => vi.clearAllMocks());

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: "d1",
    userId: "u1",
    name: "Dra. Ana Gómez",
    specialty: "Clínica general",
    licenseNumber: "MP-1234",
    available: true,
    createdAt: "2026-06-09T12:00:00Z",
    usuario: { username: "agomez", fullName: "Ana Gómez", active: true },
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof DoctorEditDialog>> = {}) {
  const editar = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DoctorEditDialog
      doctor={makeDoctor()}
      open
      onOpenChange={onOpenChange}
      editar={editar}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { editar, onSaved, onOpenChange };
}

describe("DoctorEditDialog", () => {
  it("pre-llena specialty y licenseNumber del doctor", () => {
    setup();
    expect(screen.getByDisplayValue("Clínica general")).toBeInTheDocument();
    expect(screen.getByDisplayValue("MP-1234")).toBeInTheDocument();
  });

  it("no muestra un campo de nombre editable", () => {
    setup();
    expect(screen.queryByLabelText(/^Nombre/i)).not.toBeInTheDocument();
  });

  it("guarda los cambios llamando a editar con el id del doctor", async () => {
    const doctor = makeDoctor();
    const { editar, onSaved } = setup({ doctor });
    const actualizado = makeDoctor({ specialty: "Cirugía" });
    editar.mockResolvedValue(actualizado);

    const specialty = screen.getByDisplayValue("Clínica general");
    await userEvent.clear(specialty);
    await userEvent.type(specialty, "Cirugía");

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ specialty: "Cirugía", licenseNumber: "MP-1234", available: true }),
    );
    expect(onSaved).toHaveBeenCalledWith(actualizado);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("desactivar el switch envía available=false (baja lógica)", async () => {
    const doctor = makeDoctor();
    const { editar } = setup({ doctor });
    editar.mockResolvedValue(makeDoctor({ available: false }));

    await userEvent.click(screen.getByRole("switch", { name: /Disponible/i }));
    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar).toHaveBeenCalledWith("d1", expect.objectContaining({ available: false }));
  });

  it("muestra un error de API con toast sin cerrar el diálogo", async () => {
    const { editar, onOpenChange } = setup();
    editar.mockRejectedValue(new ApiError("VALIDATION_ERROR", 422, "Datos de doctor inválidos"));

    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Datos de doctor inválidos"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
