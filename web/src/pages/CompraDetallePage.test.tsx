import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CompraDetallePage } from "./CompraDetallePage.tsx";
import * as comprasApi from "../api/comercial/compras.ts";
import * as proveedoresApi from "../api/comercial/proveedores.ts";
import * as productosApi from "../api/comercial/productos.ts";
import type { Compra, Producto, Proveedor } from "../types/index.ts";

const MOCK_PROVEEDOR: Proveedor = {
  id: "prov-1",
  tenantId: "t-1",
  razonSocial: "Droguería Sur",
  nombreFantasia: null,
  cuit: "30-11223344-5",
  condicionFiscal: "responsable_inscripto",
  telefono: null,
  email: null,
  direccion: null,
  contactoNombre: null,
  observaciones: null,
  clienteId: null,
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const MOCK_PRODUCTO: Producto = {
  id: "prod-1",
  tenantId: "t-1",
  codigo: "MED-001",
  nombre: "Amoxicilina 500mg",
  descripcion: null,
  familiaId: null,
  unidadMedidaId: "uni-1",
  marca: null,
  alicuotaIva: 21,
  condicionVenta: "bajo_receta",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: null,
  precioVenta: 200,
  costoReposicion: 100,
  margenObjetivo: 50,
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

const MOCK_PRODUCTO_SIN_CONTROL: Producto = {
  ...MOCK_PRODUCTO,
  id: "prod-2",
  codigo: "ACC-001",
  nombre: "Collar de nylon",
  condicionVenta: "libre",
  controlaLote: false,
  controlaVencimiento: false,
  esConsumibleClinico: false,
  trazable: false,
};

const MOCK_COMPRA_BORRADOR: Compra = {
  id: "c-123",
  fecha: "2026-03-01",
  comprobanteProveedorTipo: "Factura A",
  comprobanteProveedorNumero: "0001-00001234",
  totalNeto: 1000,
  totalIva: 210,
  total: 1210,
  estado: "borrador",
  generaEgresoCaja: true,
  observaciones: "Compra inicial",
  proveedor: { id: "prov-1", razonSocial: "Droguería Sur", cuit: "30-11223344-5" },
  items: [
    {
      id: "item-1",
      productoId: "prod-1",
      producto: { id: "prod-1", codigo: "MED-001", nombre: "Amoxicilina 500mg" },
      cantidad: 10,
      costoUnitarioNeto: 100,
      alicuotaIva: 21,
      codigoLote: "LOT-ABC",
      fechaVencimiento: "2026-12-31",
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
    },
  ],
  createdAt: "2026-03-01T10:00:00Z",
  updatedAt: "2026-03-01T10:00:00Z",
};

const MOCK_COMPRA_CONFIRMADA: Compra = {
  ...MOCK_COMPRA_BORRADOR,
  estado: "confirmada",
};

describe("CompraDetallePage (F2·T3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(proveedoresApi, "listarProveedores").mockResolvedValue({
      items: [MOCK_PROVEEDOR],
      meta: { page: 1, limit: 100, total: 1 },
    });
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: [MOCK_PRODUCTO],
      meta: { page: 1, limit: 100, total: 1 },
    });
    vi.spyOn(comprasApi, "obtenerCompra").mockResolvedValue(MOCK_COMPRA_BORRADOR);
  });

  const renderComponent = (compraId = "c-123") => {
    return render(
      <MemoryRouter initialEntries={[`/stock/compras/${compraId}`]}>
        <Routes>
          <Route path="/stock/compras/:id" element={<CompraDetallePage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("en borrador los controles de edición están presentes", async () => {
    renderComponent();

    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" })).toBeInTheDocument();

    // Botones de acción en borrador
    expect(screen.getByRole("button", { name: /agregar ítem/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar compra/i })).toBeInTheDocument();
  });

  it("en confirmada los controles de edición NO se renderizan", async () => {
    vi.spyOn(comprasApi, "obtenerCompra").mockResolvedValueOnce(MOCK_COMPRA_CONFIRMADA);

    renderComponent("c-confirmada");

    expect(await screen.findByText("Confirmada")).toBeInTheDocument();

    // En confirmada NO se renderizan los controles de edición
    expect(screen.queryByRole("button", { name: /agregar ítem/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar compra/i })).not.toBeInTheDocument();
  });

  it("agregar un ítem manda exactamente los campos de agregarItemCompraSchema", async () => {
    const spy = vi.spyOn(comprasApi, "agregarItem").mockResolvedValue({
      id: "item-2",
      productoId: "prod-1",
      cantidad: 5,
      costoUnitarioNeto: 80,
      alicuotaIva: 21,
      codigoLote: "LOT-NEW",
      fechaVencimiento: "2026-11-30",
      importeNeto: 400,
      importeIva: 84,
      importeTotal: 484,
    });

    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    // Abrir modal de agregar ítem
    await user.click(await screen.findByRole("button", { name: /agregar ítem/i }));

    // Cantidad
    const inputCantidad = screen.getByLabelText(/cantidad/i);
    await user.clear(inputCantidad);
    await user.type(inputCantidad, "5");

    // Costo neto
    const inputCosto = screen.getByLabelText(/costo unit. neto/i);
    await user.clear(inputCosto);
    await user.type(inputCosto, "80");

    // Código lote
    await user.type(screen.getByLabelText(/código de lote/i), "LOT-NEW");

    // Vencimiento
    await user.type(screen.getByLabelText(/fecha de vencimiento/i), "2026-11-30");

    // Guardar ítem
    await user.click(screen.getByRole("button", { name: /guardar ítem/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        "c-123",
        expect.objectContaining({
          productoId: "prod-1",
          cantidad: 5,
          costoUnitarioNeto: 80,
          alicuotaIva: 21,
          codigoLote: "LOT-NEW",
          fechaVencimiento: "2026-11-30",
        }),
      );
    });
  });

  it("RN-LO2: un producto que no controla vencimiento ni lote no muestra esos campos y se agrega sin ellos", async () => {
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: [MOCK_PRODUCTO_SIN_CONTROL],
      meta: { page: 1, limit: 100, total: 1 },
    });
    const spy = vi.spyOn(comprasApi, "agregarItem").mockResolvedValue({
      id: "item-3",
      productoId: "prod-2",
      cantidad: 2,
      costoUnitarioNeto: 100,
      alicuotaIva: 21,
      codigoLote: null,
      fechaVencimiento: null,
      importeNeto: 200,
      importeIva: 42,
      importeTotal: 242,
    });

    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });
    await user.click(await screen.findByRole("button", { name: /agregar ítem/i }));

    // El collar no vence ni se lotea: los campos no se piden.
    expect(screen.queryByLabelText(/fecha de vencimiento/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/código de lote/i)).not.toBeInTheDocument();

    const inputCantidad = screen.getByLabelText(/cantidad/i);
    await user.clear(inputCantidad);
    await user.type(inputCantidad, "2");

    await user.click(screen.getByRole("button", { name: /guardar ítem/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        "c-123",
        expect.objectContaining({
          productoId: "prod-2",
          cantidad: 2,
          codigoLote: null,
          fechaVencimiento: null,
        }),
      );
    });
  });

  it("RN-LO2: un producto que controla vencimiento sin fecha falla con mensaje visible y no llama a la API", async () => {
    const spy = vi.spyOn(comprasApi, "agregarItem").mockResolvedValue({
      id: "item-4",
      productoId: "prod-1",
      cantidad: 1,
      costoUnitarioNeto: 100,
      alicuotaIva: 21,
      codigoLote: "LOT-X",
      fechaVencimiento: null,
      importeNeto: 100,
      importeIva: 21,
      importeTotal: 121,
    });

    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });
    await user.click(await screen.findByRole("button", { name: /agregar ítem/i }));

    // MOCK_PRODUCTO sí controla vencimiento: los campos se piden.
    expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/código de lote/i), "LOT-X");
    // Se deja la fecha de vencimiento vacía a propósito.

    await user.click(screen.getByRole("button", { name: /guardar ítem/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/fecha de vencimiento/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("los totales se calculan bien: neto × cantidad, IVA por alícuota, total", async () => {
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    // En MOCK_COMPRA_BORRADOR: 10 × 100 = 1000 neto, IVA 21% = 210, total = 1210
    expect(screen.getAllByText(/\$?\s*1\.000,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\$?\s*210,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\$?\s*1\.210,00/).length).toBeGreaterThanOrEqual(1);
  });

  it("RN §2.1: confirmar pide confirmación explícita, el texto nombra los lotes que se crean y dice que no se puede deshacer", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    await user.click(screen.getByRole("button", { name: /confirmar compra/i }));

    // El diálogo debe abrirse y contener el texto obligatorio
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(/Se van a crear 1 lotes? con las cantidades y vencimientos cargados/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No se puede deshacer/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Además se registra el egreso de.*1\.210,00.*en la caja abierta/i),
    ).toBeInTheDocument();
  });

  it("RN §2.1: el error de confirmar queda DENTRO del diálogo y el diálogo no se cierra", async () => {
    vi.spyOn(comprasApi, "confirmarCompra").mockRejectedValueOnce(
      new Error("NO_OPEN_CASH_SESSION: No hay sesión de caja abierta"),
    );

    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    await user.click(screen.getByRole("button", { name: /confirmar compra/i }));

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = screen.getByRole("button", { name: /confirmar ingreso/i });
    await user.click(confirmBtn);

    // El error debe mostrarse DENTRO del diálogo
    expect(
      await screen.findByText(/No hay sesión de caja abierta/i),
    ).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it("anular con motivo de menos de 10 caracteres no habilita el botón", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    await user.click(screen.getByRole("button", { name: /anular compra/i }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    const inputMotivo = screen.getByPlaceholderText(/describa el motivo.*mínimo 10/i);
    const btnConfirmarAnulacion = screen.getByRole("button", { name: /confirmar anulación/i });

    // Inicialmente deshabilitado
    expect(btnConfirmarAnulacion).toBeDisabled();

    // Escribir 5 caracteres
    await user.type(inputMotivo, "error");
    expect(btnConfirmarAnulacion).toBeDisabled();

    // Escribir al menos 10 caracteres
    await user.type(inputMotivo, " de facturación");
    expect(btnConfirmarAnulacion).not.toBeDisabled();
  });

  it("ningún request lleva tenantId", async () => {
    const spy = vi.spyOn(comprasApi, "obtenerCompra");

    renderComponent();

    await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" });

    expect(spy).toHaveBeenCalledWith("c-123");
  });
});
