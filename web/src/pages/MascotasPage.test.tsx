import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Mascota } from "../types/index.ts";

vi.mock("../api/mascotas.ts", () => ({
  listarMascotas:  vi.fn(),
  crearMascota:    vi.fn(),
  editarMascota:   vi.fn(),
  eliminarMascota: vi.fn(),
  cambiarDueno:    vi.fn(),
  marcarFallecida: vi.fn(),
}));

vi.mock("../api/catalogos.ts", () => ({
  listarEspecies: vi.fn().mockResolvedValue([]),
  listarRazas:    vi.fn().mockResolvedValue([]),
}));

vi.mock("../api/clientes.ts", () => ({
  listarClientes: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { MascotasPage } from "./MascotasPage.tsx";
import { listarMascotas } from "../api/mascotas.ts";

const mockListar = vi.mocked(listarMascotas);

function makeMascota(over: Partial<Mascota> = {}): Mascota {
  return {
    id:             "m1",
    name:           "Pelusa",
    clientId:       "c1",
    ownerName:      "María García",
    especieId:      "e1",
    especieName:    "Perro",
    razaId:         null,
    razaName:       null,
    sex:            "Hembra",
    tamano:         "Pequeño",
    alimentoDieta:  null,
    birthDate:      "2020-03-15",
    color:          null,
    observations:   null,
    estado:         "Activa",
    deceasedDate:   null,
    deceasedReason: null,
    ultimoPeso:     null,
    createdAt:      "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <MascotasPage />
    </TooltipProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("MascotasPage", () => {
  it("muestra la tabla con mascotas tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeMascota()],
      meta:  { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Pelusa")).toBeInTheDocument();
    expect(screen.getByText("María García")).toBeInTheDocument();
    expect(screen.getByText("Perro")).toBeInTheDocument();
  });

  it("muestra badge 'Activa' para mascotas activas", async () => {
    mockListar.mockResolvedValue({
      items: [makeMascota({ estado: "Activa" })],
      meta:  { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Activa")).toBeInTheDocument();
  });

  it("muestra badge 'Fallecida' para mascotas fallecidas", async () => {
    mockListar.mockResolvedValue({
      items: [makeMascota({ estado: "Fallecida" })],
      meta:  { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Fallecida")).toBeInTheDocument();
  });

  it("muestra estado vacío cuando no hay mascotas", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay mascotas/i)).toBeInTheDocument();
  });

  it("muestra mensaje diferenciado cuando hay filtros activos sin resultados", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay mascotas/i);

    // Buscar algo que no existe
    await userEvent.type(screen.getByLabelText(/Buscar mascotas/i), "xyzxyz");

    expect(
      await screen.findByText(/No hay mascotas que coincidan con los filtros/i),
    ).toBeInTheDocument();
  });

  it("muestra error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Error de carga"));

    renderPage();

    expect(await screen.findByText("Error de carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeMascota()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Pelusa")).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeMascota()],
      meta:  { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByText("Pelusa");

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("solo muestra acciones de cambio de dueño y fallecimiento para mascotas activas", async () => {
    mockListar.mockResolvedValue({
      items: [
        makeMascota({ id: "m1", name: "Pelusa",   estado: "Activa" }),
        makeMascota({ id: "m2", name: "Firulais", estado: "Fallecida" }),
      ],
      meta: { page: 1, limit: 20, total: 2 },
    });

    renderPage();
    await screen.findByText("Pelusa");

    expect(screen.getByRole("button", { name: /Cambiar dueño de Pelusa/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar dueño de Firulais/i })).not.toBeInTheDocument();
  });
});
