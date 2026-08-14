import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Cliente } from "../types/index.ts";

// La página importa la capa de datos; la mockeamos por completo.
vi.mock("../api/clientes.ts", () => ({
  listarClientes: vi.fn(),
  crearCliente: vi.fn(),
  editarCliente: vi.fn(),
  eliminarCliente: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ClientesPage } from "./ClientesPage.tsx";
import { listarClientes } from "../api/clientes.ts";

const mockListar = vi.mocked(listarClientes);

function makeCliente(over: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1",
    fullName: "María García",
    dniCuit: "20-12345678-9",
    phone: "+54 11 4567-8900",
    address: "Av. Libertador 1234",
    email: "maria@mail.com",
    observations: null,
    createdAt: "2026-06-19T12:00:00Z",
    createdBy: null,
    livePetCount: 0,
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <ClientesPage />
    </TooltipProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("ClientesPage", () => {
  it("muestra el listado de clientes tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeCliente()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("María García")).toBeInTheDocument();
    expect(screen.getByText("20-12345678-9")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay clientes", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay clientes/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    // Reintentar vuelve a llamar a la API (esta vez con datos).
    mockListar.mockResolvedValue({ items: [makeCliente()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("María García")).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita la página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeCliente()],
      meta: { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByText("María García");

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("busca con debounce por el término ingresado", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay clientes/i);

    await userEvent.type(screen.getByLabelText(/Buscar clientes/i), "García");

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ search: "García" })),
    );
  });

  it("RN-CL8: 'Eliminar' deshabilitado con tooltip cuando el cliente tiene mascotas vivas", async () => {
    mockListar.mockResolvedValue({
      items: [makeCliente({ livePetCount: 2 })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    const row = (await screen.findByText("María García")).closest("tr")!;

    const eliminar = within(row).getByRole("button", { name: /Eliminar María García/i });
    expect(eliminar).toBeDisabled();
    expect(within(row).getByTitle(/No se puede eliminar/i)).toBeInTheDocument();
  });

  it("RN-CL8: 'Eliminar' habilitado cuando no hay mascotas vivas", async () => {
    mockListar.mockResolvedValue({
      items: [makeCliente({ livePetCount: 0 })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    const row = (await screen.findByText("María García")).closest("tr")!;

    expect(within(row).getByRole("button", { name: /Eliminar María García/i })).toBeEnabled();
  });
});
