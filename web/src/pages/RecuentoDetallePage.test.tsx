import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RecuentoDetallePage } from "./RecuentoDetallePage.tsx";
import {
  aplicarRecuento,
  guardarDetallesRecuento,
  obtenerRecuento,
} from "../api/comercial/ajustes.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import { ApiError } from "../types/index.ts";
import type { Lote, Recuento } from "../types/index.ts";

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

vi.mock("../api/comercial/stock.ts", () => ({
  listarLotes: vi.fn(),
  obtenerLote: vi.fn(),
  kardex: vi.fn(),
  trazabilidad: vi.fn(),
}));

const mockObtenerRecuento = vi.mocked(obtenerRecuento);
const mockGuardarDetallesRecuento = vi.mocked(guardarDetallesRecuento);
const mockAplicarRecuento = vi.mocked(aplicarRecuento);
const mockListarLotes = vi.mocked(listarLotes);

const MOCK_LOTE_1: Lote = {
  id: "lote-1",
  codigoLote: "LOT-001",
  fechaIngreso: "2026-01-01T00:00:00Z",
  fechaVencimiento: "2026-12-31T00:00:00Z",
  cantidad: 10,
  costoUnitarioNeto: 100,
  costoUnitarioEfectivo: 120,
  estado: "disponible",
  origen: "compra",
  proveedor: null,
  producto: {
    id: "p-1",
    codigo: "MED-1",
    nombre: "Amoxicilina 500mg",
  },
};

const MOCK_LOTE_2: Lote = {
  id: "lote-2",
  codigoLote: "LOT-002",
  fechaIngreso: "2026-01-10T00:00:00Z",
  fechaVencimiento: "2026-11-30T00:00:00Z",
  cantidad: 20,
  costoUnitarioNeto: 200,
  costoUnitarioEfectivo: 240,
  estado: "disponible",
  origen: "compra",
  proveedor: null,
  producto: {
    id: "p-2",
    codigo: "VAC-1",
    nombre: "Vacuna Antirrábica",
  },
};

const MOCK_RECUENTO_BORRADOR: Recuento = {
  id: "rec-borrador-1",
  fecha: "2026-03-01T10:00:00Z",
  estado: "borrador",
  observaciones: "Conteo farmacia central",
  createdAt: "2026-03-01T10:00:00Z",
  aplicadoAt: null,
  usuario: { id: "u-1", nombre: "Dra. García" },
  aplicadoPor: null,
  detalles: [],
};

const MOCK_RECUENTO_APLICADO: Recuento = {
  id: "rec-aplicado-1",
  fecha: "2026-02-15T10:00:00Z",
  estado: "aplicado",
  observaciones: "Recuento general cerrado",
  createdAt: "2026-02-15T10:00:00Z",
  aplicadoAt: "2026-02-15T12:00:00Z",
  usuario: { id: "u-1", nombre: "Dra. García" },
  aplicadoPor: { id: "u-2", nombre: "Admin Leo" },
  detalles: [
    {
      id: "det-1",
      loteId: "lote-1",
      codigoLote: "LOT-001",
      fechaVencimiento: "2026-12-31T00:00:00Z",
      producto: { id: "p-1", codigo: "MED-1", nombre: "Amoxicilina 500mg" },
      cantidadSistema: 10,
      cantidadContada: 12,
      diferencia: 2,
      motivo: "Sobrante en caja",
    },
    {
      id: "det-2",
      loteId: "lote-2",
      codigoLote: "LOT-002",
      fechaVencimiento: "2026-11-30T00:00:00Z",
      producto: { id: "p-2", codigo: "VAC-1", nombre: "Vacuna Antirrábica" },
      cantidadSistema: 20,
      cantidadContada: 18,
      diferencia: -2,
      motivo: "Ampolla rota descartada",
    },
  ],
};

describe("RecuentoDetallePage (F5·T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockObtenerRecuento.mockResolvedValue(MOCK_RECUENTO_BORRADOR);
    mockListarLotes.mockResolvedValue({
      items: [MOCK_LOTE_1, MOCK_LOTE_2],
      meta: { page: 1, limit: 100, total: 2 },
    });
    mockGuardarDetallesRecuento.mockResolvedValue({
      recuentoId: "rec-borrador-1",
      itemsCount: 2,
    });
    mockAplicarRecuento.mockResolvedValue({
      recuentoId: "rec-borrador-1",
      operacionId: "op-1",
      ajustesGenerados: 2,
      lotesMovidos: 2,
    });
  });

  const renderPage = (recuentoId = "rec-borrador-1") => {
    return render(
      <MemoryRouter initialEntries={[`/stock/recuentos/${recuentoId}`]}>
        <Routes>
          <Route path="/stock/recuentos/:id" element={<RecuentoDetallePage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("RN §2.3: el campo 'cantidad contada' arranca VACÍO, no precargado con la cantidad del sistema", async () => {
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    const inputContada2 = screen.getByLabelText("Cantidad contada lote LOT-002");

    // Ambos inputs deben arrancar completamente vacíos
    expect(inputContada1).toHaveValue(null);
    expect(inputContada2).toHaveValue(null);
  });

  it("la cantidad del sistema se muestra en su columna", async () => {
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    // Sistema tiene 10 para lote 1 y 20 para lote 2
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("tipear un valor distinto muestra el desvío con el color correcto; igual, verde", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    const inputContada2 = screen.getByLabelText("Cantidad contada lote LOT-002");

    // Lote 1: sistema 10. Tipeamos 10 -> desvío 0 (verde)
    await user.type(inputContada1, "10");
    const badgeCero = screen.getByText("0");
    expect(badgeCero).toBeInTheDocument();
    expect(badgeCero).toHaveClass("bg-emerald-50");

    // Lote 2: sistema 20. Tipeamos 25 -> desvío +5 (ámbar)
    await user.type(inputContada2, "25");
    const badgePositivo = screen.getByText("+5");
    expect(badgePositivo).toBeInTheDocument();
    expect(badgePositivo).toHaveClass("bg-amber-50");

    // Lote 2: cambiamos a 18 -> desvío -2 (rojo/rose)
    await user.clear(inputContada2);
    await user.type(inputContada2, "18");
    const badgeNegativo = screen.getByText("-2");
    expect(badgeNegativo).toBeInTheDocument();
    expect(badgeNegativo).toHaveClass("bg-rose-50");
  });

  it("una fila con desvío habilita el campo de motivo", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada = screen.getByLabelText("Cantidad contada lote LOT-001");
    const inputMotivo = screen.getByLabelText("Motivo lote LOT-001");

    // Inicialmente deshabilitado porque no hay conteo
    expect(inputMotivo).toBeDisabled();

    // Tipeamos conteo igual al sistema (10) -> desvío 0 -> motivo sigue deshabilitado
    await user.type(inputContada, "10");
    expect(inputMotivo).toBeDisabled();

    // Tipeamos conteo con desvío (12) -> desvío +2 -> motivo se habilita
    await user.clear(inputContada);
    await user.type(inputContada, "12");
    expect(inputMotivo).toBeEnabled();

    await user.type(inputMotivo, "Se encontraron 2 unidades extra");
    expect(inputMotivo).toHaveValue("Se encontraron 2 unidades extra");
  });

  it("'Guardar avance' manda el conjunto completo de ítems cargados", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    const inputContada2 = screen.getByLabelText("Cantidad contada lote LOT-002");
    const inputMotivo2 = screen.getByLabelText("Motivo lote LOT-002");

    await user.type(inputContada1, "10");
    await user.type(inputContada2, "18");
    await user.type(inputMotivo2, "Merma por rotura");

    const btnGuardar = screen.getByRole("button", { name: /Guardar avance/i });
    await user.click(btnGuardar);

    expect(mockGuardarDetallesRecuento).toHaveBeenCalledWith("rec-borrador-1", [
      {
        loteId: "lote-1",
        cantidadContada: 10,
        cantidadSistema: 10,
        motivo: undefined,
      },
      {
        loteId: "lote-2",
        cantidadContada: 18,
        cantidadSistema: 20,
        motivo: "Merma por rotura",
      },
    ]);

    expect(await screen.findByText(/Avance guardado \(2 lotes contados\)/i)).toBeInTheDocument();
  });

  it("§4.3: la carga de lotes no usa meta.total con conExistencia activo", async () => {
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    expect(mockListarLotes).toHaveBeenCalledWith(
      expect.objectContaining({
        conExistencia: "true",
        limit: 100,
      }),
    );
  });

  it("RN §2.1: el AlertDialog nombra la cantidad de movimientos, los lotes afectados, las unidades de entrada y salida, y dice que no se puede deshacer", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    // Cargamos desvíos:
    // Lote 1: 10 -> 15 (+5 entrada)
    // Lote 2: 20 -> 18 (-2 salida)
    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    const inputContada2 = screen.getByLabelText("Cantidad contada lote LOT-002");

    await user.type(inputContada1, "15");
    await user.type(inputContada2, "18");

    const btnAplicarHeader = screen.getByRole("button", { name: /Aplicar recuento/i });
    await user.click(btnAplicarHeader);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // Nombra cantidad de movimientos, lotes afectados, unidades de entrada y salida
    expect(dialog).toHaveTextContent("Aplicar el recuento");
    expect(dialog).toHaveTextContent("Se van a generar 2 movimientos de ajuste sobre 2 lotes");
    expect(dialog).toHaveTextContent("5 unidades de entrada y 2 de salida");
    expect(dialog).toHaveTextContent(
      /El recuento queda aplicado y no se puede deshacer — para corregirlo hay que registrar ajustes nuevos/i,
    );
  });

  it("RN §2.1: con desvíos, el botón de aplicar no se habilita hasta tildar confirmarDesvios, y el checkbox está DENTRO del diálogo", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    await user.type(inputContada1, "15"); // Desvío +5

    const btnAplicarHeader = screen.getByRole("button", { name: /Aplicar recuento/i });
    await user.click(btnAplicarHeader);

    const dialog = await screen.findByRole("alertdialog");

    // Checkbox está DENTRO del diálogo
    const checkbox = within(dialog).getByRole("checkbox", {
      name: /Confirmo que los desvíos son correctos y deben aplicarse/i,
    });
    expect(checkbox).toBeInTheDocument();

    // El botón de acción dentro del diálogo debe estar deshabilitado
    const btnConfirmar = within(dialog).getByRole("button", { name: "Aplicar recuento" });
    expect(btnConfirmar).toBeDisabled();

    // Tildamos el checkbox
    await user.click(checkbox);
    expect(btnConfirmar).toBeEnabled();

    await user.click(btnConfirmar);
    expect(mockAplicarRecuento).toHaveBeenCalledWith("rec-borrador-1", {
      confirmarDesvios: true,
    });
  });

  it("RN §2.1: el error del backend queda DENTRO del diálogo", async () => {
    const user = userEvent.setup();
    mockAplicarRecuento.mockRejectedValueOnce(
      new ApiError("COUNT_STALE", 409, "Las existencias del sistema cambiaron durante el conteo"),
    );

    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    await user.type(inputContada1, "15");

    const btnAplicarHeader = screen.getByRole("button", { name: /Aplicar recuento/i });
    await user.click(btnAplicarHeader);

    const dialog = await screen.findByRole("alertdialog");
    const checkbox = within(dialog).getByRole("checkbox");
    await user.click(checkbox);

    const btnConfirmar = within(dialog).getByRole("button", { name: "Aplicar recuento" });
    await user.click(btnConfirmar);

    // Diálogo sigue abierto y muestra el error dentro con role="alert"
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    const errorAlert = within(screen.getByRole("alertdialog")).getByRole("alert");
    expect(errorAlert).toHaveTextContent("Las existencias del sistema cambiaron durante el conteo");
  });

  it("un recuento aplicado se renderiza en solo lectura, sin inputs", async () => {
    mockObtenerRecuento.mockResolvedValueOnce(MOCK_RECUENTO_APLICADO);

    renderPage("rec-aplicado-1");

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();
    expect(screen.getByText("LOT-002")).toBeInTheDocument();

    // Resumen superior
    expect(screen.getByText("Lotes Contados")).toBeInTheDocument();
    expect(screen.getByText("Lotes con Desvío")).toBeInTheDocument();
    expect(screen.getByText("Desvío Neto")).toBeInTheDocument();

    // No debe existir ningún input editable en la tabla
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("—")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Explicación del desvío...")).not.toBeInTheDocument();

    // Botones de borrador no deben existir
    expect(screen.queryByRole("button", { name: /Guardar avance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar recuento/i })).not.toBeInTheDocument();
  });

  it("ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("LOT-001")).toBeInTheDocument();

    const inputContada1 = screen.getByLabelText("Cantidad contada lote LOT-001");
    await user.type(inputContada1, "10");

    const btnGuardar = screen.getByRole("button", { name: /Guardar avance/i });
    await user.click(btnGuardar);

    expect(mockGuardarDetallesRecuento).toHaveBeenCalled();
    const callArgs = mockGuardarDetallesRecuento.mock.calls[0][1];
    expect((callArgs as any).tenantId).toBeUndefined();
    expect((callArgs as any).tenant_id).toBeUndefined();
  });
});
