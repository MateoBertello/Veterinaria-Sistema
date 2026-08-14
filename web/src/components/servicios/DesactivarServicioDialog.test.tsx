import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesactivarServicioDialog } from "./DesactivarServicioDialog.tsx";
import { ApiError, type Servicio } from "../../types/index.ts";

beforeEach(() => vi.clearAllMocks());

const servicio = { id: "s1", nombre: "Consulta general" } as Servicio;

function setup(cambiarEstado: ReturnType<typeof vi.fn>) {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DesactivarServicioDialog
      servicio={servicio}
      open
      onOpenChange={onOpenChange}
      cambiarEstado={cambiarEstado}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

describe("DesactivarServicioDialog", () => {
  it("confirma la baja y notifica éxito", async () => {
    const actualizado = { ...servicio, activo: false } as Servicio;
    const cambiarEstado = vi.fn().mockResolvedValue(actualizado);
    const { onSuccess, onOpenChange } = setup(cambiarEstado);

    await userEvent.click(screen.getByRole("button", { name: /^Desactivar$/i }));

    await waitFor(() => expect(cambiarEstado).toHaveBeenCalledWith("s1", false));
    expect(onSuccess).toHaveBeenCalledWith(actualizado);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("RN-SV3: turnos futuros → muestra el error dentro del diálogo sin cerrarlo", async () => {
    const cambiarEstado = vi.fn().mockRejectedValue(
      new ApiError("VALIDATION_ERROR", 422, "No se puede desactivar un servicio con turnos futuros programados"),
    );
    const { onSuccess, onOpenChange } = setup(cambiarEstado);

    await userEvent.click(screen.getByRole("button", { name: /^Desactivar$/i }));

    expect(
      await screen.findByText("No se puede desactivar un servicio con turnos futuros programados"),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
