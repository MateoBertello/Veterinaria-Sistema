import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Servicio } from "../types/index.ts";

vi.mock("../api/servicios.ts", () => ({
  listarServicios: vi.fn(),
  crearServicio: vi.fn(),
  editarServicio: vi.fn(),
  cambiarEstadoServicio: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ServiciosPage } from "./ServiciosPage.tsx";
import { listarServicios } from "../api/servicios.ts";

const mockListar = vi.mocked(listarServicios);

function makeServicio(over: Partial<Servicio> = {}): Servicio {
  return {
    id: "s1",
    nombre: "Consulta general",
    tipo: "clinica",
    duracionMinutos: 30,
    requiereProfesional: true,
    descripcion: null,
    activo: true,
    createdAt: "2026-06-09T12:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <ServiciosPage />
    </TooltipProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("ServiciosPage", () => {
  it("muestra el listado de servicios tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeServicio()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Consulta general")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay servicios", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay servicios/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeServicio()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Consulta general")).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita la página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeServicio()],
      meta: { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByText("Consulta general");

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("busca con debounce por el término ingresado", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay servicios/i);

    await userEvent.type(screen.getByLabelText(/Buscar servicios/i), "Baño");

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Baño" })),
    );
  });

  it("abre el formulario de alta al pulsar 'Nuevo servicio'", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay servicios/i);

    await userEvent.click(screen.getByRole("button", { name: /Nuevo servicio/i }));

    expect(await screen.findByRole("heading", { name: /Nuevo servicio/i })).toBeInTheDocument();
  });

  it("un servicio inactivo muestra badge 'Inactivo' y acción 'Activar'", async () => {
    mockListar.mockResolvedValue({
      items: [makeServicio({ activo: false })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activar Consulta general/i })).toBeInTheDocument();
  });
});
