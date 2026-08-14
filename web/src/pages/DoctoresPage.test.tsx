import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Doctor } from "../types/index.ts";

vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
  obtenerDoctor: vi.fn(),
  editarDoctor: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { DoctoresPage } from "./DoctoresPage.tsx";
import { listarDoctores } from "../api/doctores.ts";

const mockListar = vi.mocked(listarDoctores);

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

function renderPage() {
  return render(
    <TooltipProvider>
      <DoctoresPage />
    </TooltipProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("DoctoresPage", () => {
  it("muestra el listado de doctores tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeDoctor()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Dra. Ana Gómez")).toBeInTheDocument();
    expect(screen.getByText("Clínica general")).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay doctores", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay doctores/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeDoctor()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Dra. Ana Gómez")).toBeInTheDocument();
  });

  it("un doctor no disponible muestra badge 'No disponible'", async () => {
    mockListar.mockResolvedValue({
      items: [makeDoctor({ available: false })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("No disponible")).toBeInTheDocument();
  });

  it("filtra por disponibilidad", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay doctores/i);

    await userEvent.click(screen.getByLabelText(/Filtrar por disponibilidad/i));
    await userEvent.click(await screen.findByRole("option", { name: "Disponible" }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ available: true })),
    );
  });

  it("busca con debounce por el término ingresado", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay doctores/i);

    await userEvent.type(screen.getByLabelText(/Buscar doctores/i), "Gómez");

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Gómez" })),
    );
  });

  it("abre el diálogo de edición al pulsar 'Editar'", async () => {
    mockListar.mockResolvedValue({
      items: [makeDoctor()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    await screen.findByText("Dra. Ana Gómez");

    await userEvent.click(screen.getByRole("button", { name: /Editar Dra. Ana Gómez/i }));

    expect(await screen.findByRole("heading", { name: /Editar doctor/i })).toBeInTheDocument();
  });
});
