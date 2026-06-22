import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteClienteDialog } from "./DeleteClienteDialog.tsx";
import { ApiError, type Cliente } from "../../types/index.ts";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

beforeEach(() => vi.clearAllMocks());

const cliente = { id: "c1", fullName: "María García" } as Cliente;

function setup(eliminar: ReturnType<typeof vi.fn>) {
  const onDeleted = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DeleteClienteDialog
      cliente={cliente}
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
      eliminar={eliminar}
    />,
  );
  return { onDeleted, onOpenChange };
}

describe("DeleteClienteDialog", () => {
  it("confirma la baja y notifica éxito", async () => {
    const eliminar = vi.fn().mockResolvedValue({ id: "c1", deleted: true });
    const { onDeleted } = setup(eliminar);

    await userEvent.click(screen.getByRole("button", { name: /^Eliminar$/i }));

    await waitFor(() => expect(eliminar).toHaveBeenCalledWith("c1"));
    expect(onDeleted).toHaveBeenCalledWith("c1");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("RN-CL8 (fallback): si vuelve CLIENT_HAS_PETS muestra toast de error", async () => {
    const eliminar = vi.fn().mockRejectedValue(
      new ApiError("CLIENT_HAS_PETS", 409, "No puede eliminar un cliente con mascotas vivas asociadas"),
    );
    const { onDeleted } = setup(eliminar);

    await userEvent.click(screen.getByRole("button", { name: /^Eliminar$/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No puede eliminar un cliente con mascotas vivas asociadas",
      ),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
