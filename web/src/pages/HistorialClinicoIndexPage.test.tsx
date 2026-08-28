import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type Cliente, type Mascota } from "../types/index.ts";

vi.mock("../api/clientes.ts", () => ({
  listarClientes: vi.fn(),
}));

vi.mock("../api/mascotas.ts", () => ({
  listarMascotas: vi.fn(),
}));

import { HistorialClinicoIndexPage } from "./HistorialClinicoIndexPage.tsx";
import { listarClientes } from "../api/clientes.ts";
import { listarMascotas } from "../api/mascotas.ts";

const mockListarClientes = vi.mocked(listarClientes);
const mockListarMascotas = vi.mocked(listarMascotas);

function makeCliente(over: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1", fullName: "Juan Pérez", dniCuit: "20-12345678-9",
    phone: null, address: null, email: null, observations: null,
    createdAt: "2026-01-01T00:00:00Z", createdBy: null, livePetCount: 1,
    ...over,
  };
}

function makeMascota(over: Partial<Mascota> = {}): Mascota {
  return {
    id: "m1", name: "Firulais", clientId: "c1", ownerName: "Juan Pérez",
    especieId: "e1", especieName: "Perro", razaId: null, razaName: null,
    sex: "Macho", tamano: "Mediano", alimentoDieta: null, birthDate: null,
    color: null, observations: null, estado: "Activa", deceasedDate: null,
    deceasedReason: null, ultimoPeso: null, createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/historial"]}>
      <Routes>
        <Route path="/historial" element={<HistorialClinicoIndexPage />} />
        <Route path="/historial/:mascotaId" element={<div>Historial de mascota</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function elegirCliente(cliente: Cliente) {
  await userEvent.click(screen.getByRole("combobox", { name: "Tutor" }));
  await userEvent.click(await screen.findByText(cliente.fullName));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarClientes.mockResolvedValue({ items: [], meta: { page: 1, limit: 15, total: 0 } });
});

describe("HistorialClinicoIndexPage", () => {
  it("muestra el mensaje inicial antes de elegir un tutor", () => {
    renderPage();
    expect(screen.getByText(/Elegí primero un tutor/i)).toBeInTheDocument();
  });

  it("al elegir un tutor, carga y lista sus mascotas", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [makeMascota()], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);

    await waitFor(() => expect(mockListarMascotas).toHaveBeenCalledWith({ clientId: "c1", limit: 100 }));
    await userEvent.click(screen.getByRole("combobox", { name: "Mascota" }));
    expect(await screen.findByRole("option", { name: "Firulais" })).toBeInTheDocument();
  });

  it("marca las mascotas Fallecidas en la lista", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({
      items: [makeMascota({ id: "m2", name: "Rocky", estado: "Fallecida" })],
      meta: { page: 1, limit: 100, total: 1 },
    });

    renderPage();
    await elegirCliente(cliente);

    await userEvent.click(await screen.findByRole("combobox", { name: "Mascota" }));
    expect(await screen.findByRole("option", { name: "Rocky (Fallecida)" })).toBeInTheDocument();
  });

  it("muestra mensaje explícito si el cliente no tiene mascotas", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0 } });

    renderPage();
    await elegirCliente(cliente);

    expect(await screen.findByText(/no tiene mascotas registradas/i)).toBeInTheDocument();
  });

  it("muestra error si falla la carga de mascotas", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();
    await elegirCliente(cliente);

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();
  });

  it("al elegir una mascota, navega al mismo /historial/:mascotaId que usa el módulo Mascotas", async () => {
    const cliente = makeCliente();
    mockListarClientes.mockResolvedValue({ items: [cliente], meta: { page: 1, limit: 15, total: 1 } });
    mockListarMascotas.mockResolvedValue({ items: [makeMascota()], meta: { page: 1, limit: 100, total: 1 } });

    renderPage();
    await elegirCliente(cliente);

    await userEvent.click(await screen.findByRole("combobox", { name: "Mascota" }));
    await userEvent.click(await screen.findByRole("option", { name: "Firulais" }));

    expect(await screen.findByText("Historial de mascota")).toBeInTheDocument();
  });
});
