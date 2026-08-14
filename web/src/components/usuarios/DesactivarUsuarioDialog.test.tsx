import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, ErrorCode, type Usuario } from "../../types/index.ts";
import { DesactivarUsuarioDialog } from "./DesactivarUsuarioDialog.tsx";

function makeUsuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: "u1",
    username: "ana",
    email: "ana@x.com",
    fullName: "Ana Pérez",
    phone: null,
    active: true,
    rolId: "r-admin",
    rolName: "Administrador",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function setup() {
  const desactivar = vi.fn();
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DesactivarUsuarioDialog
      usuario={makeUsuario()}
      open
      onOpenChange={onOpenChange}
      desactivar={desactivar}
      onSuccess={onSuccess}
    />,
  );
  return { desactivar, onSuccess, onOpenChange };
}

beforeEach(() => vi.clearAllMocks());

describe("DesactivarUsuarioDialog", () => {
  it("confirma la baja: llama desactivar con el id y avisa el éxito", async () => {
    const { desactivar, onSuccess } = setup();
    desactivar.mockResolvedValue(makeUsuario({ active: false }));

    await userEvent.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(desactivar).toHaveBeenCalledWith("u1"));
    expect(onSuccess).toHaveBeenCalled();
  });

  it("RN-SEC6: LAST_ADMIN se muestra en el diálogo sin dar por exitosa la baja", async () => {
    const { desactivar, onSuccess } = setup();
    desactivar.mockRejectedValue(
      new ApiError(ErrorCode.LAST_ADMIN, 409, "No se puede desactivar el último administrador activo"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Desactivar" }));

    // El mensaje del server se muestra en el alert propio del diálogo (la
    // descripción también menciona la regla, por eso se apunta al role="alert").
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede desactivar el último administrador activo",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
