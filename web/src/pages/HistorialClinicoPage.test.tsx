import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type HistorialItem, type ResumenClinico } from "../types/index.ts";

vi.mock("../api/historial-clinico.ts", () => ({
  listarHistorial:        vi.fn(),
  resumenClinico:         vi.fn(),
  obtenerEvento:          vi.fn(),
  obtenerAdjuntoFirmado:  vi.fn(),
  crearEvento:            vi.fn(),
  subirAdjunto:           vi.fn(),
}));

vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0 } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { HistorialClinicoPage } from "./HistorialClinicoPage.tsx";
import { listarHistorial, resumenClinico } from "../api/historial-clinico.ts";

const mockListar = vi.mocked(listarHistorial);
const mockResumen = vi.mocked(resumenClinico);

function makeResumen(over: Partial<ResumenClinico> = {}): ResumenClinico {
  return {
    id: "m1", name: "Firulais", estado: "Activa", ownerName: "Juan Pérez",
    especieName: "Perro", razaName: "Labrador", ultimoPeso: 12.5,
    ...over,
  };
}

function makeEvento(over: Partial<HistorialItem> = {}): HistorialItem {
  return {
    id: "e1", date: "2026-06-01", eventType: "Consulta", professionalName: "Dra. García",
    weightKg: 12.5, temperatureC: 38.2, diagnosis: null,
    clientNameAtTime: "Juan Pérez", isPreviousOwner: false, hasAttachments: false,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/historial/m1"]}>
      <Routes>
        <Route path="/historial/:mascotaId" element={<HistorialClinicoPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("HistorialClinicoPage", () => {
  it("RN-HC1: muestra los eventos en el orden que devuelve el backend (desc)", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({
      items: [
        makeEvento({ id: "e2", date: "2026-06-05", professionalName: "Dra. Reciente" }),
        makeEvento({ id: "e1", date: "2026-06-01", professionalName: "Dra. Antigua" }),
      ],
      meta: { page: 1, limit: 20, total: 2 },
    });

    renderPage();

    await screen.findByText("Dra. Reciente");
    const nombres = screen.getAllByText(/^Dra\./);
    expect(nombres.map((n) => n.textContent)).toEqual(["Dra. Reciente", "Dra. Antigua"]);
  });

  it("RN-HC2: el último peso viene del resumen clínico, no de un campo por evento", async () => {
    mockResumen.mockResolvedValue(makeResumen({ ultimoPeso: 15.3 }));
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    expect(await screen.findByText(/Último peso: 15\.3 kg/)).toBeInTheDocument();
  });

  it("RN-HC3: cada evento muestra el dueño al momento del evento, no el actual", async () => {
    mockResumen.mockResolvedValue(makeResumen({ ownerName: "Dueño Actual" }));
    mockListar.mockResolvedValue({
      items: [makeEvento({ clientNameAtTime: "Dueño Histórico", isPreviousOwner: true })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Dueño Histórico")).toBeInTheDocument();
    expect(screen.queryByText("Dueño Actual")).not.toBeInTheDocument();
  });

  it("RN-EC3: mascota Fallecida bloquea el registro de eventos con mensaje explicativo", async () => {
    mockResumen.mockResolvedValue(makeResumen({ estado: "Fallecida" }));
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    expect(await screen.findByText(/no se pueden registrar nuevos eventos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar evento/i })).not.toBeInTheDocument();
  });

  it("muestra el estado vacío cuando la mascota no tiene eventos", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay eventos clínicos/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    await waitFor(() => expect(screen.queryByText("Falló la carga")).not.toBeInTheDocument());
  });
});
