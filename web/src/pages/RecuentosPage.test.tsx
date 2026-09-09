import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RecuentosPage } from "./RecuentosPage.tsx";
import { crearRecuento, eliminarRecuento, listarRecuentos } from "../api/comercial/ajustes.ts";
import { ApiError } from "../types/index.ts";
import type { Recuento } from "../types/index.ts";

vi.mock("../api/comercial/ajustes.ts", () => ({
  crearRecuento: vi.fn(),
  listarRecuentos: vi.fn(),
  eliminarRecuento: vi.fn(),
  obtenerRecuento: vi.fn(),
  guardarDetallesRecuento: vi.fn(),
  aplicarRecuento: vi.fn(),
  ajustarExistencia: vi.fn(),
  bloquearLote: vi.fn(),
  desbloquearLote: vi.fn(),
}));

const mockListarRecuentos = vi.mocked(listarRecuentos);
const mockCrearRecuento = vi.mocked(crearRecuento);
const mockEliminarRecuento = vi.mocked(eliminarRecuento);

const MOCK_RECUENTO_BORRADOR: Recuento = {
  id: "rec-1",
  fecha: "2026-03-01T10:00:00Z",
  estado: "borrador",
  observaciones: "Conteo mensual farmacia",
  createdAt: "2026-03-01T10:00:00Z",
  aplicadoAt: null,
  usuario: { id: "u-1", nombre: "Dra. García" },
  aplicadoPor: null,
};

const MOCK_RECUENTO_APLICADO: Recuento = {
  id: "rec-2",
  fecha: "2026-02-15T10:00:00Z",
  estado: "aplicado",
  observaciones: "Inventario general cerrado",
  createdAt: "2026-02-15T10:00:00Z",
  aplicadoAt: "2026-02-15T12:00:00Z",
  usuario: { id: "u-1", nombre: "Dra. García" },
  aplicadoPor: { id: "u-2", nombre: "Admin Leo" },
};

describe("RecuentosPage (F5·T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListarRecuentos.mockResolvedValue({
      items: [MOCK_RECUENTO_BORRADOR, MOCK_RECUENTO_APLICADO],
      meta: { page: 1, limit: 20, total: 2 },
    });
    mockCrearRecuento.mockResolvedValue({
      id: "rec-nuevo",
      fecha: "2026-03-06T00:00:00Z",
      estado: "borrador",
      observaciones: "Recuento creado desde test",
      createdAt: "2026-03-06T00:00:00Z",
      aplicadoAt: null,
    });
    mockEliminarRecuento.mockResolvedValue({ id: "rec-1", deleted: true });
  });

  const renderPage = () => {
    return render(
      <MemoryRouter initialEntries={["/stock/recuentos"]}>
        <Routes>
          <Route path="/stock/recuentos" element={<RecuentosPage />} />
          <Route path="/stock/recuentos/:id" element={<div data-testid="detalle-route">Detalle Recuento</div>} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("renderiza el listado con sus badges de estado (borrador y aplicado)", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Recuentos de Inventario" })).toBeInTheDocument();
    expect(await screen.findByText("Conteo mensual farmacia")).toBeInTheDocument();
    expect(screen.getByText("Inventario general cerrado")).toBeInTheDocument();

    expect(screen.getByText("Borrador")).toBeInTheDocument();
    expect(screen.getByText("Aplicado")).toBeInTheDocument();
  });

  it("muestra estado vacío si no hay recuentos", async () => {
    mockListarRecuentos.mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });

    renderPage();

    expect(
      await screen.findByText("No se encontraron recuentos de inventario."),
    ).toBeInTheDocument();
  });

  it("muestra error si falla la carga inicial", async () => {
    mockListarRecuentos.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", 500, "Error en el servidor al listar recuentos"),
    );

    renderPage();

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Error en el servidor al listar recuentos");
  });

  it("botón 'Nuevo recuento' abre diálogo y crea un borrador navegando al detalle", async () => {
    const user = userEvent.setup();
    renderPage();

    const btnNuevo = await screen.findByRole("button", { name: /Nuevo recuento/i });
    await user.click(btnNuevo);

    expect(screen.getByRole("heading", { name: "Nuevo Recuento de Inventario" })).toBeInTheDocument();

    const inputObs = screen.getByLabelText(/Observaciones/i);
    await user.type(inputObs, "Recuento creado desde test");

    const btnSubmit = screen.getByRole("button", { name: "Crear recuento" });
    await user.click(btnSubmit);

    expect(mockCrearRecuento).toHaveBeenCalledWith("Recuento creado desde test");
    expect(await screen.findByTestId("detalle-route")).toBeInTheDocument();
  });

  it("eliminar solo está disponible para recuentos en borrador y abre AlertDialog", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Conteo mensual farmacia");

    // Botón eliminar para rec-1 (borrador)
    const btnEliminar = screen.getByLabelText("Eliminar recuento rec-1");
    expect(btnEliminar).toBeInTheDocument();

    // No debe existir botón eliminar para rec-2 (aplicado)
    expect(screen.queryByLabelText("Eliminar recuento rec-2")).not.toBeInTheDocument();

    await user.click(btnEliminar);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Eliminar recuento en borrador");
    expect(dialog).toHaveTextContent("Se eliminará este borrador de recuento");

    const btnConfirmar = screen.getByRole("button", { name: "Eliminar recuento" });
    await user.click(btnConfirmar);

    expect(mockEliminarRecuento).toHaveBeenCalledWith("rec-1");
  });

  it("ningún request lleva tenantId", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Recuentos de Inventario" });

    expect(mockListarRecuentos).toHaveBeenCalled();
    const callArgs = mockListarRecuentos.mock.calls[0][0];
    expect((callArgs as any)?.tenantId).toBeUndefined();
    expect((callArgs as any)?.tenant_id).toBeUndefined();
  });
});
