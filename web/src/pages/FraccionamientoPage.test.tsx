import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FraccionamientoPage } from "./FraccionamientoPage.tsx";
import {
  crearDerivado,
  listarConversiones,
  listarProductos,
  obtenerProducto,
} from "../api/comercial/productos.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import {
  fraccionar,
  historial,
  sugerirVencimiento,
} from "../api/comercial/fraccionamiento.ts";
import { listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import { ApiError } from "../types/index.ts";
import type {
  Conversion,
  ItemHistorialFraccionamiento,
  Lote,
  Producto,
  ResultadoFraccionamiento,
  UnidadMedida,
} from "../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: {
    id: "user-1",
    email: "vet@leo.com",
    role: "veterinario",
    permissions: ["split_stock", "view_stock", "manage_products"],
  },
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/catalogos-comercial.ts", () => ({
  listarUnidadesMedida: vi.fn(),
}));

vi.mock("../api/comercial/productos.ts", () => ({
  listarProductos: vi.fn(),
  obtenerProducto: vi.fn(),
  listarConversiones: vi.fn(),
  crearDerivado: vi.fn(),
}));

vi.mock("../api/comercial/stock.ts", () => ({
  listarLotes: vi.fn(),
}));

vi.mock("../api/comercial/fraccionamiento.ts", () => ({
  fraccionar: vi.fn(),
  sugerirVencimiento: vi.fn(),
  historial: vi.fn(),
}));

const mockListarUnidadesMedida = vi.mocked(listarUnidadesMedida);
const mockListarProductos = vi.mocked(listarProductos);
const mockObtenerProducto = vi.mocked(obtenerProducto);
const mockListarConversiones = vi.mocked(listarConversiones);
const mockCrearDerivado = vi.mocked(crearDerivado);
const mockListarLotes = vi.mocked(listarLotes);
const mockFraccionar = vi.mocked(fraccionar);
const mockSugerirVencimiento = vi.mocked(sugerirVencimiento);
const mockHistorial = vi.mocked(historial);

const MOCK_UNIDADES: UnidadMedida[] = [
  { id: "u-frasco", codigo: "FRASCO", nombre: "Frasco", abreviatura: "frasco", admite_decimales: false, escala_decimal: 0 },
  { id: "u-ml", codigo: "ML", nombre: "Mililitro", abreviatura: "ml", admite_decimales: true, escala_decimal: 2 },
];

const MOCK_PRODUCTO_ORIGEN: Producto = {
  id: "p-origen",
  tenantId: "tenant-1",
  codigo: "AMX-FCO",
  nombre: "Amoxicilina 500mg Frasco 100ml",
  descripcion: "Frasco multidosis",
  familiaId: "fam-1",
  unidadMedidaId: "u-frasco",
  marca: "Bayer",
  alicuotaIva: 21,
  condicionVenta: "libre",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: 30,
  precioVenta: 1000,
  costoReposicion: 600,
  margenObjetivo: 40,
  stockMinimo: 5,
  esVendible: true,
  esConsumibleClinico: true,
  requiereFrio: false,
  trazable: true,
  codigoBarras: "7791234567890",
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const MOCK_PRODUCTO_DESTINO_1: Producto = {
  id: "p-destino-1",
  tenantId: "tenant-1",
  codigo: "AMX-DOSIS-10",
  nombre: "Amoxicilina Dosis 10ml",
  descripcion: "Dosis individual",
  familiaId: "fam-1",
  unidadMedidaId: "u-ml",
  marca: "Bayer",
  alicuotaIva: 21,
  condicionVenta: "libre",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: 15,
  precioVenta: 200,
  costoReposicion: 70,
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

const MOCK_PRODUCTO_DESTINO_2: Producto = {
  id: "p-destino-2",
  tenantId: "tenant-1",
  codigo: "AMX-DOSIS-5",
  nombre: "Amoxicilina Dosis 5ml",
  descripcion: "Dosis menor",
  familiaId: "fam-1",
  unidadMedidaId: "u-ml",
  marca: "Bayer",
  alicuotaIva: 21,
  condicionVenta: "libre",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: 15,
  precioVenta: 120,
  costoReposicion: 40,
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

const MOCK_LOTE_1: Lote = {
  id: "lote-orig-1",
  codigoLote: "LOT-AMX-001",
  fechaIngreso: "2026-01-01T00:00:00Z",
  fechaVencimiento: "2026-12-31",
  cantidad: 10,
  costoUnitarioNeto: 600,
  costoUnitarioEfectivo: 726,
  estado: "disponible",
  origen: "compra",
  proveedor: null,
  producto: { id: "p-origen", codigo: "AMX-FCO", nombre: "Amoxicilina 500mg Frasco 100ml" },
};

const MOCK_CONVERSION_1: Conversion = {
  id: "conv-1",
  tenantId: "tenant-1",
  productoOrigenId: "p-origen",
  productoDestinoId: "p-destino-1",
  factorTeorico: 10,
  mermaEsperadaPorcentaje: 5,
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const MOCK_CONVERSION_2: Conversion = {
  id: "conv-2",
  tenantId: "tenant-1",
  productoOrigenId: "p-origen",
  productoDestinoId: "p-destino-2",
  factorTeorico: 20,
  mermaEsperadaPorcentaje: 8,
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const MOCK_RESULTADO_FRACCIONAMIENTO: ResultadoFraccionamiento = {
  operacionId: "op-12345678-abcd",
  loteDestinoId: "lote-dest-999",
  cantidadTeorica: 20,
  cantidadObtenida: 19,
  desvioPorcentaje: 5,
  costoUnitarioHijo: 76.421,
  mermaRegistrada: 1,
};

const MOCK_ITEM_HISTORIAL: ItemHistorialFraccionamiento = {
  tenantId: "tenant-1",
  operacionId: "op-12345678-abcd",
  productoOrigenId: "p-origen",
  productoDestinoId: "p-destino-1",
  productoOrigenNombre: "Amoxicilina 500mg Frasco 100ml",
  productoDestinoNombre: "Amoxicilina Dosis 10ml",
  cantidadOrigen: 2,
  factorTeorico: 10,
  cantidadTeorica: 20,
  cantidadObtenida: 19,
  merma: 1,
  costoConsumido: 1452,
  costoUnitarioHijo: 76.421,
  sobrecosto: 3.82,
  fraccionadoAt: "2026-02-01T14:30:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <FraccionamientoPage />
    </MemoryRouter>,
  );
}

describe("FraccionamientoPage (F6·T1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = {
      id: "user-1",
      email: "vet@leo.com",
      role: "veterinario",
      permissions: ["split_stock", "view_stock", "manage_products"],
    };

    mockListarUnidadesMedida.mockResolvedValue(MOCK_UNIDADES);
    mockListarProductos.mockResolvedValue({ items: [MOCK_PRODUCTO_ORIGEN], meta: { page: 1, limit: 10, total: 1 } });
    mockListarLotes.mockResolvedValue({ items: [MOCK_LOTE_1], meta: { page: 1, limit: 100, total: 1 } });
    mockListarConversiones.mockResolvedValue({ items: [MOCK_CONVERSION_1], meta: { page: 1, limit: 20, total: 1 } });
    mockObtenerProducto.mockImplementation(async (id) => {
      if (id === "p-destino-1") return MOCK_PRODUCTO_DESTINO_1;
      if (id === "p-destino-2") return MOCK_PRODUCTO_DESTINO_2;
      return MOCK_PRODUCTO_ORIGEN;
    });
    mockSugerirVencimiento.mockResolvedValue({ vencimientoSugerido: "2026-06-15" });
    mockHistorial.mockResolvedValue({ items: [MOCK_ITEM_HISTORIAL], meta: { page: 1, limit: 20, total: 1 } });
    mockFraccionar.mockResolvedValue(MOCK_RESULTADO_FRACCIONAMIENTO);
  });

  // Helper para buscar y seleccionar producto y lote
  async function prepararFormularioBase(user = userEvent.setup()) {
    renderPage();

    // 1. Buscar producto origen
    const inputBuscar = screen.getByLabelText("Buscar producto origen");
    await user.type(inputBuscar, "Amox");

    // 2. Click en el resultado encontrado
    const itemResultado = await screen.findByText(MOCK_PRODUCTO_ORIGEN.nombre);
    await user.click(itemResultado);

    // 3. Seleccionar lote origen
    const selectLoteTrigger = await screen.findByLabelText("Lote origen con existencia");
    await user.click(selectLoteTrigger);
    const itemLote = await screen.findByText(/LOT-AMX-001/);
    await user.click(itemLote);

    return user;
  }

  it("RN §2.3: el campo cantidadObtenida arranca VACÍO.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    // El formulario se despliega
    const inputObtenida = await screen.findByLabelText(/Cantidad obtenida real/i);
    expect(inputObtenida).toHaveValue(null);
    expect((inputObtenida as HTMLInputElement).value).toBe("");
  });

  it("RN §2.3: cambiar el producto destino o la cantidad origen NO escribe el teórico dentro del input.", async () => {
    // Configuramos dos conversiones disponibles
    mockListarConversiones.mockResolvedValueOnce({
      items: [MOCK_CONVERSION_1, MOCK_CONVERSION_2],
      meta: { page: 1, limit: 20, total: 2 },
    });

    const user = userEvent.setup();
    await prepararFormularioBase(user);

    // Con múltiples conversiones, seleccionamos la primera (factor 10)
    const selectConvTrigger = await screen.findByLabelText("Seleccione la conversión destino");
    await user.click(selectConvTrigger);
    const itemConv1 = await screen.findByText(/Factor: ×10/);
    await user.click(itemConv1);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);

    // Escribimos cantidad origen 2
    await user.type(inputOrigen, "2");

    // Teórico sería 2 * 10 = 20, pero cantidadObtenida DEBE SEGUIR VACÍO
    expect(inputObtenida).toHaveValue(null);
    expect((inputObtenida as HTMLInputElement).value).toBe("");

    // Cambiamos a la segunda conversión (factor 20)
    await user.click(selectConvTrigger);
    const itemConv2 = await screen.findByText(/Factor: ×20/);
    await user.click(itemConv2);

    // Teórico ahora sería 2 * 20 = 40, pero cantidadObtenida DEBE SEGUIR VACÍO
    expect(inputObtenida).toHaveValue(null);
    expect((inputObtenida as HTMLInputElement).value).toBe("");
  });

  it("RN §2.3: el teórico y la merma esperada se muestran al lado del campo, siempre.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    // Con cantidadOrigen 2 y factor 10, teórico es 20 ml, merma esperada 5%
    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    await user.type(inputOrigen, "2");

    const refCard = screen.getByText(/Referencia Teórica/i).closest("div")!;
    expect(within(refCard).getByText(/Teórico:/i)).toBeInTheDocument();
    expect(within(refCard).getByText("20 ml")).toBeInTheDocument();
    expect(within(refCard).getByText(/Merma esperada:/i)).toBeInTheDocument();
    expect(within(refCard).getByText("5%")).toBeInTheDocument();
  });

  it("RN §2.3: al tipear, la merma real se calcula y se colorea (dentro de lo esperado, por encima, y obtenido > teórico).", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);

    // Origen: 2 frascos -> Teórico: 20 ml (Merma esperada: 5%, es decir 1 ml de merma)
    await user.type(inputOrigen, "2");

    // Caso 1: Dentro de lo esperado (obtenido: 19.5 ml -> merma 0.5 ml = 2.5% <= 5%)
    await user.type(inputObtenida, "19.5");
    expect(await screen.findByText(/Merma real: 0.5 ml \(2.5%\)/i)).toBeInTheDocument();
    expect(screen.getByText("Esperado")).toBeInTheDocument();
    const alertVerde = screen.getByText(/Merma dentro de los límites de tolerancia esperados/i).closest("div");
    expect(alertVerde?.parentElement).toHaveClass("text-emerald-800");

    // Caso 2: Supera merma esperada (obtenido: 17 ml -> merma 3 ml = 15% > 5%)
    await user.clear(inputObtenida);
    await user.type(inputObtenida, "17");
    expect(await screen.findByText(/Merma real: 3 ml \(15%\)/i)).toBeInTheDocument();
    expect(screen.getByText("Desvío Alto")).toBeInTheDocument();
    const alertAmbar = screen.getByText(/Merma superior a la tolerancia esperada/i).closest("div");
    expect(alertAmbar?.parentElement).toHaveClass("text-amber-800");

    // Caso 3: Obtenido supera al teórico (obtenido: 22 ml -> 110% de rendimiento)
    await user.clear(inputObtenida);
    await user.type(inputObtenida, "22");
    expect(await screen.findByText(/Merma real: -2 ml \(-10%\)/i)).toBeInTheDocument();
    expect(screen.getByText("Rendimiento > 100%")).toBeInTheDocument();
    const alertRojo = screen.getByText(/Atención: La cantidad obtenida supera al rendimiento teórico/i).closest("div");
    expect(alertRojo?.parentElement).toHaveClass("text-rose-800");
  });

  it("fechaVencimientoDestino se precarga desde sugerir-vencimiento y es editable.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    // Esperar a que se invoque sugerirVencimiento y precargue el input
    await waitFor(() => {
      expect(mockSugerirVencimiento).toHaveBeenCalledWith({
        loteOrigenId: "lote-orig-1",
        productoDestinoId: "p-destino-1",
      });
    });

    const inputFecha = await screen.findByLabelText(/Fecha de vencimiento del lote derivado/i);
    expect(inputFecha).toHaveValue("2026-06-15");

    // Es editable
    await user.clear(inputFecha);
    await user.type(inputFecha, "2026-08-20");
    expect(inputFecha).toHaveValue("2026-08-20");
  });

  it("codigoLoteDestino vacío no habilita el botón; el patrón sugerido está en el placeholder, no en el valor.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);
    const inputCodigoDestino = screen.getByLabelText(/Código del lote derivado/i);
    const btnFraccionar = screen.getByRole("button", { name: /Fraccionar lote/i });

    // Completamos cantidades válidas
    await user.type(inputOrigen, "2");
    await user.type(inputObtenida, "19");

    // Código destino arranca con placeholder sugerido 'LOT-AMX-001-F1' pero valor vacío
    expect(inputCodigoDestino).toHaveAttribute("placeholder", "LOT-AMX-001-F1");
    expect(inputCodigoDestino).toHaveValue("");
    expect(btnFraccionar).toBeDisabled();

    // Escribimos código y ahora sí se habilita
    await user.type(inputCodigoDestino, "LOT-AMX-001-F1");
    expect(inputCodigoDestino).toHaveValue("LOT-AMX-001-F1");
    expect(btnFraccionar).toBeEnabled();
  });

  it("cantidadOrigen mayor a la existencia del lote se rechaza en el cliente.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);
    const inputCodigoDestino = screen.getByLabelText(/Código del lote derivado/i);
    const btnFraccionar = screen.getByRole("button", { name: /Fraccionar lote/i });

    // Existencia de MOCK_LOTE_1 es 10. Tipeamos 15
    await user.type(inputOrigen, "15");
    await user.type(inputObtenida, "140");
    await user.type(inputCodigoDestino, "DEST-01");

    // Mensaje de rechazo en cliente con role="alert"
    const alertError = await screen.findByRole("alert");
    expect(alertError).toHaveTextContent(/no puede superar la existencia actual del lote \(10 frasco\)/i);

    // Botón deshabilitado
    expect(btnFraccionar).toBeDisabled();
  });

  it("RN §2.1: el AlertDialog nombra las dos cantidades, los dos lotes, la merma, y dice que no se puede deshacer.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);
    const inputCodigoDestino = screen.getByLabelText(/Código del lote derivado/i);
    const btnFraccionar = screen.getByRole("button", { name: /Fraccionar lote/i });

    await user.type(inputOrigen, "2");
    await user.type(inputObtenida, "19");
    await user.type(inputCodigoDestino, "LOT-AMX-001-F1");

    await user.click(btnFraccionar);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Fraccionar el lote")).toBeInTheDocument();

    // Debe nombrar: cantidadOrigen (2 frasco), loteOrigen (LOT-AMX-001), codigoDestino (LOT-AMX-001-F1), cantidadObtenida (19 ml), merma (1)
    expect(within(dialog).getByText(/2 frasco/i)).toBeInTheDocument();
    expect(within(dialog).getByText("LOT-AMX-001")).toBeInTheDocument();
    expect(within(dialog).getByText("LOT-AMX-001-F1")).toBeInTheDocument();
    expect(within(dialog).getByText(/19 ml/i)).toBeInTheDocument();
    expect(within(dialog).getByText("1")).toBeInTheDocument();

    // Advertencia de irreversibilidad
    expect(within(dialog).getByText(/no se pueden deshacer/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/No se puede revertir/i)).toBeInTheDocument();

    // Confirmamos la acción
    const btnConfirmar = within(dialog).getByRole("button", { name: /Confirmar fraccionamiento/i });
    await user.click(btnConfirmar);

    expect(mockFraccionar).toHaveBeenCalledWith({
      loteOrigenId: "lote-orig-1",
      productoDestinoId: "p-destino-1",
      cantidadOrigen: 2,
      cantidadObtenida: 19,
      codigoLoteDestino: "LOT-AMX-001-F1",
      fechaVencimientoDestino: "2026-06-15",
      motivo: null,
    });

    // Panel de éxito tras fraccionar
    expect(await screen.findByText(/Fraccionamiento registrado con éxito/i)).toBeInTheDocument();
    expect(screen.getByText(/op-12345678-abcd/i)).toBeInTheDocument();
  });

  it("RN §2.1: el error del backend queda DENTRO del diálogo.", async () => {
    const user = userEvent.setup();
    mockFraccionar.mockRejectedValueOnce(
      new ApiError("INSUFFICIENT_STOCK", 409, "Stock insuficiente en el lote origen"),
    );

    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);
    const inputCodigoDestino = screen.getByLabelText(/Código del lote derivado/i);
    const btnFraccionar = screen.getByRole("button", { name: /Fraccionar lote/i });

    await user.type(inputOrigen, "2");
    await user.type(inputObtenida, "19");
    await user.type(inputCodigoDestino, "LOT-AMX-001-F1");
    await user.click(btnFraccionar);

    const dialog = await screen.findByRole("alertdialog");
    const btnConfirmar = within(dialog).getByRole("button", { name: /Confirmar fraccionamiento/i });
    await user.click(btnConfirmar);

    // Diálogo sigue abierto y muestra el error con role="alert"
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    const errorAlert = within(screen.getByRole("alertdialog")).getByRole("alert");
    expect(errorAlert).toHaveTextContent("Stock insuficiente en el lote origen");
  });

  it("Sin conversiones para el producto origen, estado vacío con la salida correcta.", async () => {
    mockListarConversiones.mockResolvedValueOnce({ items: [], meta: { page: 1, limit: 20, total: 0 } });
    const user = userEvent.setup();

    renderPage();
    const inputBuscar = screen.getByLabelText("Buscar producto origen");
    await user.type(inputBuscar, "Amox");
    const itemResultado = await screen.findByText(MOCK_PRODUCTO_ORIGEN.nombre);
    await user.click(itemResultado);

    // Muestra estado vacío con enlace a Familias
    expect(await screen.findByText("Sin conversiones definidas")).toBeInTheDocument();
    expect(screen.getByText("Ir a Catálogo / Familias para configurar una")).toHaveAttribute(
      "href",
      "/stock/familias",
    );
  });

  it("Sin manage_products, el atajo de crear derivado no se renderiza.", async () => {
    // Quitamos manage_products
    mockAuth.user.permissions = ["split_stock", "view_stock"];
    const user = userEvent.setup();

    renderPage();
    const inputBuscar = screen.getByLabelText("Buscar producto origen");
    await user.type(inputBuscar, "Amox");
    const itemResultado = await screen.findByText(MOCK_PRODUCTO_ORIGEN.nombre);
    await user.click(itemResultado);

    // El botón 'Crear producto derivado' NO debe renderizarse
    expect(screen.queryByRole("button", { name: /Crear producto derivado/i })).not.toBeInTheDocument();
  });

  it("Con manage_products, el atajo de crear derivado se renderiza y permite crearlo.", async () => {
    mockAuth.user.permissions = ["split_stock", "view_stock", "manage_products"];
    mockCrearDerivado.mockResolvedValueOnce({
      productoDerivado: MOCK_PRODUCTO_DESTINO_2,
      conversion: MOCK_CONVERSION_2,
    });

    const user = userEvent.setup();
    renderPage();

    const inputBuscar = screen.getByLabelText("Buscar producto origen");
    await user.type(inputBuscar, "Amox");
    const itemResultado = await screen.findByText(MOCK_PRODUCTO_ORIGEN.nombre);
    await user.click(itemResultado);

    // El botón sí existe
    const btnAtajo = await screen.findByRole("button", { name: /Crear producto derivado/i });
    await user.click(btnAtajo);

    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Crear Producto Derivado")).toBeInTheDocument();

    // Llenamos campos
    await user.type(within(modal).getByLabelText("Código *"), "AMX-DOSIS-5");
    await user.type(within(modal).getByLabelText("Nombre *"), "Amoxicilina Dosis 5ml");

    // Seleccionamos unidad destino
    const triggerUnidad = within(modal).getByLabelText("Unidad de medida destino *");
    await user.click(triggerUnidad);
    const itemUnidad = await screen.findByText(/Mililitro/);
    await user.click(itemUnidad);

    await user.type(within(modal).getByLabelText("Factor teórico *"), "20");

    const btnGuardarModal = within(modal).getByRole("button", { name: "Crear derivado" });
    await user.click(btnGuardarModal);

    expect(mockCrearDerivado).toHaveBeenCalledWith("p-origen", {
      codigo: "AMX-DOSIS-5",
      nombre: "Amoxicilina Dosis 5ml",
      unidadMedidaId: "u-ml",
      factorTeorico: 20,
      mermaEsperadaPorcentaje: 0,
      vidaUtilPostAperturaDias: null,
      precioVenta: null,
      descripcion: null,
    });
  });

  it("Historial carga y muestra fraccionamientos.", async () => {
    const user = userEvent.setup();
    renderPage();

    const tabHistorial = screen.getByRole("tab", { name: /Historial de Fraccionamientos/i });
    await user.click(tabHistorial);

    expect(mockHistorial).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(await screen.findByText("Amoxicilina 500mg Frasco 100ml")).toBeInTheDocument();
    expect(screen.getByText("Amoxicilina Dosis 10ml")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument(); // Cant. Obtenida
    expect(screen.getByText("$76.42")).toBeInTheDocument(); // Costo unit.
  });

  it("Ningún request lleva tenantId.", async () => {
    const user = userEvent.setup();
    await prepararFormularioBase(user);

    const inputOrigen = await screen.findByLabelText(/Cantidad a tomar del lote origen/i);
    const inputObtenida = screen.getByLabelText(/Cantidad obtenida real/i);
    const inputCodigoDestino = screen.getByLabelText(/Código del lote derivado/i);
    const btnFraccionar = screen.getByRole("button", { name: /Fraccionar lote/i });

    await user.type(inputOrigen, "2");
    await user.type(inputObtenida, "19");
    await user.type(inputCodigoDestino, "LOT-AMX-001-F1");
    await user.click(btnFraccionar);

    const dialog = await screen.findByRole("alertdialog");
    const btnConfirmar = within(dialog).getByRole("button", { name: /Confirmar fraccionamiento/i });
    await user.click(btnConfirmar);

    // Verificamos que ninguno de los payloads o parámetros enviados a los métodos contenga tenantId
    for (const call of mockListarProductos.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
    }
    for (const call of mockListarLotes.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
    }
    for (const call of mockListarConversiones.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
    }
    for (const call of mockSugerirVencimiento.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
    }
    for (const call of mockFraccionar.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
    }
  });
});
