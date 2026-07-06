import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarcarFallecidaDialog } from "./MarcarFallecidaDialog.tsx";
import { ApiError, type Mascota } from "../../types/index.ts";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

beforeEach(() => vi.clearAllMocks());

const mascota = { id: "pet1", name: "Firulais" } as Mascota;

function setup(marcarFallecida: ReturnType<typeof vi.fn>) {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MarcarFallecidaDialog
      mascota={mascota}
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      marcarFallecida={marcarFallecida}
    />,
  );
  return { onSuccess, onOpenChange };
}

describe("MarcarFallecidaDialog", () => {
  it("RN-MF3: el AlertDialog advierte explícitamente que la acción no se puede revertir", () => {
    setup(vi.fn());
    expect(screen.getByText(/no se puede revertir/i)).toBeInTheDocument();
  });

  it("RN-MF3: deceasedReason vacío bloquea el envío", async () => {
    const marcarFallecida = vi.fn();
    setup(marcarFallecida);

    await userEvent.click(screen.getByRole("button", { name: /Confirmar fallecimiento/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/motivo es requerido/i);
    expect(marcarFallecida).not.toHaveBeenCalled();
  });

  it("RN-MF3: confirmar llama marcarFallecida con el payload y muestra toast de éxito", async () => {
    const marcarFallecida = vi.fn().mockResolvedValue({ id: "pet1", estado: "Fallecida" });
    const { onSuccess, onOpenChange } = setup(marcarFallecida);

    await userEvent.type(screen.getByLabelText(/Motivo del fallecimiento/i), "Insuficiencia renal");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar fallecimiento/i }));

    await waitFor(() =>
      expect(marcarFallecida).toHaveBeenCalledWith(
        "pet1",
        expect.objectContaining({ deceasedReason: "Insuficiencia renal" }),
      ),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("RN-MF3: si la API falla muestra toast de error y no cierra el diálogo", async () => {
    const marcarFallecida = vi.fn().mockRejectedValue(
      new ApiError("PET_DECEASED", 422, "La mascota ya está marcada como fallecida"),
    );
    const { onOpenChange } = setup(marcarFallecida);

    await userEvent.type(screen.getByLabelText(/Motivo del fallecimiento/i), "Insuficiencia renal");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar fallecimiento/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("La mascota ya está marcada como fallecida"),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
