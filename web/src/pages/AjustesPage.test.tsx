import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AjustesPage, TIPOS_AJUSTE } from "./AjustesPage.tsx";
import { ajustarExistencia, bloquearLote, desbloquearLote } from "../api/comercial/ajustes.ts";
import { listarProductos } from "../api/comercial/productos.ts";
import { listarLotes, obtenerLote } from "../api/comercial/stock.ts";
import { ApiError } from "../types/index.ts";
import type { Lote, Producto } from "../types/index.ts";

vi.mock("../api/comercial/stock.ts", () => ({
  listarLotes: vi.fn(),
  obtenerLote: vi.fn(),
  kardex: vi.fn(),
  trazabilidad: vi.fn(),
}));

vi.mock("../api/comercial/ajustes.ts", () => ({
  ajustarExistencia: vi.fn(),
  bloquearLote: vi.fn(),
  desbloquearLote: vi.fn(),
}));

vi.mock("../api/comercial/productos.ts", () => ({
  listarProductos: vi.fn(),
}));

const mockObtenerLote = vi.mocked(obtenerLote);
const mockListarLotes = vi.mocked(listarLotes);
const mockListarProductos = vi.mocked(listarProductos);
const mockAjustarExistencia = vi.mocked(ajustarExistencia);
const mockBloquearLote = vi.mocked(bloquearLote);
const mockDesbloquearLote = vi.mocked(desbloquearLote);

const MOCK_PRODUCTO: Producto = {
  id: "prod-1",
  tenantId: "t-1",
  codigo: "MED-001",
  nombre: "Amoxicilina 500mg",
  descripcion: null,
  familiaId: "fam-1",
  unidadMedidaId: "u-1",
  marca: null,
  alicuotaIva: 21,
  condicionVenta: "venta_libre",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: null,
  precioVenta: 1500,
  costoReposicion: 900,
  margenObjetivo: 40,
  stockMinimo: 10,
  esVendible: true,
  esConsumibleClinico: true,
  requiereFrio: false,
  trazable: true,
  codigoBarras: null,
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const MOCK_LOTE: Lote = {
  id: "lote-123",
  codigoLote: "LOT-2026-A",
  fechaIngreso: "2026-01-15T00:00:00Z",
  fechaVencimiento: "2026-12-31T00:00:00Z",
  cantidad: 20,
  costoUnitarioNeto: 800,
  costoUnitarioEfectivo: 850,
  estado: "disponible",
  origen: "compra",
  proveedor: null,
  producto: {
    id: "prod-1",
    codigo: "MED-001",
    nombre: "Amoxicilina 500mg",
  },
};

describe("AjustesPage (F5·T1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListarProductos.mockResolvedValue({
      items: [MOCK_PRODUCTO],
      meta: { page: 1, limit: 10, total: 1 },
    });
    mockListarLotes.mockResolvedValue({
      items: [MOCK_LOTE],
      meta: { page: 1, limit: 100, total: 1 },
    });
    mockObtenerLote.mockResolvedValue(MOCK_LOTE);
    mockAjustarExistencia.mockResolvedValue({
      operacionId: "op-1",
      movimientoId: "mov-1",
      existenciaFinal: 25,
    });
    mockBloquearLote.mockResolvedValue({
      id: "lote-123",
      estado: "bloqueado",
      motivoBloqueo: "Bloqueo preventivo por sospecha",
    });
    mockDesbloquearLote.mockResolvedValue({
      id: "lote-123",
      estado: "disponible",
    });
  });

  const renderAjustes = (initialEntry = "/stock/ajustes?loteId=lote-123") => {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/stock/ajustes" element={<AjustesPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("los cuatro tipos de ajuste aparecen con su explicación", async () => {
    expect(TIPOS_AJUSTE).toHaveLength(4);
    expect(TIPOS_AJUSTE.map((t) => t.value)).toEqual([
      "entrada_ajuste",
      "salida_ajuste",
      "merma_rotura",
      "merma_vencimiento",
    ]);

    expect(TIPOS_AJUSTE.find((t) => t.value === "entrada_ajuste")?.explicacion).toBe(
      "Aparece stock que el sistema no tenía.",
    );
    expect(TIPOS_AJUSTE.find((t) => t.value === "salida_ajuste")?.explicacion).toBe(
      "Falta stock que el sistema tenía.",
    );
    expect(TIPOS_AJUSTE.find((t) => t.value === "merma_rotura")?.explicacion).toBe(
      "Se rompió o se perdió.",
    );
    expect(TIPOS_AJUSTE.find((t) => t.value === "merma_vencimiento")?.explicacion).toBe(
      "Se descarta por vencido.",
    );
  });

  it("la cantidad negativa o cero se rechaza en el cliente", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.clear(inputCantidad);
    await user.type(inputCantidad, "-5");

    expect(await screen.findByRole("alert")).toHaveTextContent("La cantidad debe ser mayor a 0");

    const btn = screen.getByRole("button", { name: "Registrar el ajuste" });
    expect(btn).toBeDisabled();
  });

  it("la existencia resultante se calcula y se muestra antes de confirmar", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "5");

    // Lote arranca con 20 unidades. tipo por defecto es entrada_ajuste -> 20 + 5 = 25
    const resultante = screen.getByTestId("existencia-resultante");
    expect(resultante).toHaveTextContent("25");
  });

  it("una existencia resultante negativa muestra la advertencia", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    // Seleccionamos salida_ajuste
    const selectTrigger = screen.getByLabelText(/Tipo de ajuste/i);
    await user.click(selectTrigger);
    const opcionSalida = await screen.findByRole("option", { name: /Salida por ajuste/i });
    await user.click(opcionSalida);

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "30"); // 20 - 30 = -10

    const advertencia = await screen.findByRole("alert");
    expect(advertencia).toHaveTextContent(/La existencia resultante sería negativa \(-10\)/i);
    expect(advertencia).toHaveTextContent(/RN-MV5/);
  });

  it("el motivo de menos de 10 caracteres no habilita el botón", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "5");

    const inputMotivo = screen.getByLabelText(/Motivo del ajuste/i);
    await user.type(inputMotivo, "123456789"); // 9 caracteres

    const btn = screen.getByRole("button", { name: "Registrar el ajuste" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/9 \/ 10 caracteres/)).toBeInTheDocument();

    await user.type(inputMotivo, "0"); // 10 caracteres
    expect(screen.getByText(/10 \/ 10 caracteres/)).toBeInTheDocument();
    expect(btn).toBeEnabled();
  });

  it("RN §2.1: el AlertDialog nombra el tipo, la cantidad, el lote, la existencia antes y después, y dice que no se puede borrar sino corregir con otro ajuste", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "5");

    const inputMotivo = screen.getByLabelText(/Motivo del ajuste/i);
    await user.type(inputMotivo, "Ajuste por conteo físico verificado");

    const btn = screen.getByRole("button", { name: "Registrar el ajuste" });
    await user.click(btn);

    // Verificamos el contenido del AlertDialog
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Registrar el ajuste");
    expect(dialog).toHaveTextContent("entrada_ajuste");
    expect(dialog).toHaveTextContent("5");
    expect(dialog).toHaveTextContent("LOT-2026-A");
    expect(dialog).toHaveTextContent("20");
    expect(dialog).toHaveTextContent("25");
    expect(dialog).toHaveTextContent(/no se puede borrar: para corregirlo hay que registrar otro ajuste en sentido contrario/i);
  });

  it("RN §2.1: el error del backend queda DENTRO del diálogo", async () => {
    const user = userEvent.setup();
    mockAjustarExistencia.mockRejectedValueOnce(
      new ApiError("INSUFFICIENT_STOCK", 409, "La existencia disponible es insuficiente para el ajuste"),
    );

    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "5");

    const inputMotivo = screen.getByLabelText(/Motivo del ajuste/i);
    await user.type(inputMotivo, "Ajuste con error simulado");

    const btn = screen.getByRole("button", { name: "Registrar el ajuste" });
    await user.click(btn);

    const dialog = await screen.findByRole("alertdialog");
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar ajuste" });
    await user.click(btnConfirmar);

    // Diálogo permanece abierto y contiene el mensaje de error con role="alert"
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    const errorAlert = screen.getByRole("alert");
    expect(errorAlert).toHaveTextContent("La existencia disponible es insuficiente para el ajuste");
  });

  it("bloquear/desbloquear mandan { motivo } y su diálogo dice que sí es reversible", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    // Botón bloquear lote en la ficha seleccionada (el que tiene texto visible "Bloquear lote")
    const btnsBloquear = screen.getAllByRole("button", { name: /Bloquear lote/i });
    // btnsBloquear[1] es el de la ficha del lote con texto
    await user.click(btnsBloquear[btnsBloquear.length - 1]);

    const dialogBloqueo = await screen.findByRole("alertdialog");
    expect(dialogBloqueo).toHaveTextContent("Bloquear lote");
    expect(dialogBloqueo).toHaveTextContent(/Esta acción es reversible/i);
    expect(dialogBloqueo).toHaveTextContent(/deja de estar disponible para ventas y para consumo clínico/i);
    expect(dialogBloqueo).toHaveTextContent(/Se puede desbloquear después/i);

    const inputMotivo = screen.getByLabelText(/Motivo del bloqueo/i);
    await user.type(inputMotivo, "Lote retenido por control de calidad");

    const btnConfirmarBloqueo = screen.getByRole("button", { name: "Bloquear lote" });
    await user.click(btnConfirmarBloqueo);

    expect(mockBloquearLote).toHaveBeenCalledWith(
      "lote-123",
      "Lote retenido por control de calidad",
    );
  });

  it("§4.3: no se usa meta.total con conExistencia activo", async () => {
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    // Aseguramos que listarLotes fue llamado con conExistencia: "true"
    expect(mockListarLotes).toHaveBeenCalledWith(
      expect.objectContaining({
        conExistencia: "true",
        limit: 100,
      }),
    );
  });

  it("ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    renderAjustes();

    expect((await screen.findAllByText(/LOT-2026-A/))[0]).toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/Cantidad a ajustar/i);
    await user.type(inputCantidad, "5");

    const inputMotivo = screen.getByLabelText(/Motivo del ajuste/i);
    await user.type(inputMotivo, "Ajuste sin tenant_id en payload");

    const btn = screen.getByRole("button", { name: "Registrar el ajuste" });
    await user.click(btn);

    const btnConfirmar = screen.getByRole("button", { name: "Confirmar ajuste" });
    await user.click(btnConfirmar);

    expect(mockAjustarExistencia).toHaveBeenCalledWith({
      loteId: "lote-123",
      tipo: "entrada_ajuste",
      cantidad: 5,
      motivo: "Ajuste sin tenant_id en payload",
    });

    const callArgs = mockAjustarExistencia.mock.calls[0][0];
    expect((callArgs as any).tenantId).toBeUndefined();
    expect((callArgs as any).tenant_id).toBeUndefined();
  });
});
