import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClienteFormDialog } from "./ClienteFormDialog.tsx";
import { ApiError, type Cliente } from "../../types/index.ts";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

beforeEach(() => vi.clearAllMocks());

function setup(overrides: Partial<React.ComponentProps<typeof ClienteFormDialog>> = {}) {
  const crear = vi.fn();
  const editar = vi.fn();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ClienteFormDialog
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      crear={crear}
      editar={editar}
      {...overrides}
    />,
  );
  return { crear, editar, onSaved, onOpenChange };
}

describe("ClienteFormDialog", () => {
  it("muestra errores inline al enviar vacío (RN-CL1)", async () => {
    const { crear } = setup();

    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("El nombre completo es requerido")).toBeInTheDocument();
    expect(screen.getByText("El DNI/CUIT es requerido")).toBeInTheDocument();
    expect(screen.getByText("El teléfono es requerido")).toBeInTheDocument();
    expect(screen.getByText("La dirección es requerida")).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("valida el formato del DNI/CUIT (RN-CL2/RN-CL6: paridad backend/front)", async () => {
    setup();

    await userEvent.type(screen.getByLabelText(/DNI\/CUIT/i), "20-ABC-9");
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText(/Solo dígitos y guiones/i)).toBeInTheDocument();
  });

  it("alta válida llama a crear con los datos y notifica éxito", async () => {
    const saved = { id: "c1" } as Cliente;
    const { crear, onSaved } = setup();
    (crear as ReturnType<typeof vi.fn>).mockResolvedValue(saved);

    await userEvent.type(screen.getByLabelText(/Nombre completo/i), "María García");
    await userEvent.type(screen.getByLabelText(/DNI\/CUIT/i), "20-12345678-9");
    await userEvent.type(screen.getByLabelText(/Teléfono/i), "+54 11 4567-8900");
    await userEvent.type(screen.getByLabelText(/Dirección/i), "Av. Libertador 1234");
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    await waitFor(() => expect(crear).toHaveBeenCalledTimes(1));
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "María García",
        dniCuit: "20-12345678-9",
        phone: "+54 11 4567-8900",
        address: "Av. Libertador 1234",
        email: undefined,
        observations: undefined,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("RN-CL3: DUPLICATE_DNI del envelope marca el campo DNI/CUIT", async () => {
    const { crear } = setup();
    (crear as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("DUPLICATE_DNI", 409, "El DNI/CUIT ya está registrado"),
    );

    await userEvent.type(screen.getByLabelText(/Nombre completo/i), "María García");
    await userEvent.type(screen.getByLabelText(/DNI\/CUIT/i), "20-12345678-9");
    await userEvent.type(screen.getByLabelText(/Teléfono/i), "1145678900");
    await userEvent.type(screen.getByLabelText(/Dirección/i), "Av. Libertador 1234");
    await userEvent.click(screen.getByRole("button", { name: /Registrar/i }));

    expect(await screen.findByText("El DNI/CUIT ya está registrado")).toBeInTheDocument();
  });
});
