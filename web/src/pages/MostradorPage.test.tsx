import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MostradorPage } from "./MostradorPage.tsx";
import * as cajaApi from "../api/comercial/caja.ts";
import * as productosApi from "../api/comercial/productos.ts";
import * as stockApi from "../api/comercial/stock.ts";
import * as ventasApi from "../api/comercial/ventas.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import * as clientesApi from "../api/clientes.ts";
import * as mascotasApi from "../api/mascotas.ts";
import { ApiError } from "../types/index.ts";
import type {
  AuthUser,
  Cliente,
  Familia,
  LoteCandidato,
  MedioPago,
  Producto,
  ResultadoVenta,
  ServicioVendible,
  SesionCaja,
  UnidadMedida,
} from "../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: null as AuthUser | null,
  login: () => Promise.resolve(),
  logout: vi.fn(() => Promise.resolve()),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

const USUARIO_VENDEDOR: AuthUser = {
  id: "u-vendedor-1",
  username: "vendedor",
  fullName: "Vendedor Prueba",
  roleName: "Recepcionista",
  permissions: ["view_stock", "manage_sales", "manage_cash"],
};

const MOCK_SESION_ABIERTA: SesionCaja = {
  id: "ses-100",
  cajaId: "caja-1",
  cajaNombre: "Caja Mostrador",
  estado: "abierta",
  aperturaAt: "2026-09-05T08:00:00.000Z",
  aperturaUsuarioId: "u-vendedor-1",
  cierreAt: null,
  cierreUsuarioId: null,
  saldoInicial: 5000,
  saldoTeoricoEfectivo: 5000,
  efectivoContado: null,
  diferencia: null,
  motivoDiferencia: null,
  observaciones: null,
};

const MOCK_FAMILIAS: Familia[] = [
  { id: "fam-1", tenantId: "tenant-1", nombre: "Farmacia", unidadBaseId: "u-1", activo: true, createdAt: "" },
  { id: "fam-2", tenantId: "tenant-1", nombre: "Alimentos", unidadBaseId: "u-2", activo: true, createdAt: "" },
];

const MOCK_UNIDADES: UnidadMedida[] = [
  { id: "u-1", codigo: "U", nombre: "Unidad", abreviatura: "u", admite_decimales: false, escala_decimal: 0 },
  { id: "u-2", codigo: "KG", nombre: "Kilogramo", abreviatura: "kg", admite_decimales: true, escala_decimal: 3 },
];

const MOCK_MEDIOS_PAGO: MedioPago[] = [
  { id: "mp-efectivo", codigo: "efectivo", nombre: "Efectivo", afecta_arqueo: true, requiere_referencia: false },
  { id: "mp-tarjeta", codigo: "tarjeta_credito", nombre: "Tarjeta de Crédito", afecta_arqueo: false, requiere_referencia: true },
];

const MOCK_PRODUCTOS: Producto[] = [
  {
    id: "prod-1",
    tenantId: "tenant-1",
    nombre: "Antiparasitario Canino",
    codigo: "AP-001",
    precioVenta: 1500,
    costoReposicion: 900,
    margenObjetivo: 40,
    alicuotaIva: 21,
    unidadMedidaId: "u-1",
    activo: true,
    esVendible: true,
    esConsumibleClinico: false,
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    stockMinimo: 5,
    condicionVenta: "libre",
    requiereFrio: false,
    trazable: false,
    codigoBarras: "7791234567890",
    descripcion: "Antiparasitario interno",
    marca: "Bayer",
    familiaId: "fam-1",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "prod-2",
    tenantId: "tenant-1",
    nombre: "Alimento Perro Adulto 15kg",
    codigo: "AL-002",
    precioVenta: 25000,
    costoReposicion: 18000,
    margenObjetivo: 35,
    alicuotaIva: 21,
    unidadMedidaId: "u-2",
    activo: true,
    esVendible: true,
    esConsumibleClinico: false,
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    stockMinimo: 2,
    condicionVenta: "libre",
    requiereFrio: false,
    trazable: false,
    codigoBarras: "7799876543210",
    descripcion: "Alimento balanceado",
    marca: "Royal Canin",
    familiaId: "fam-2",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "prod-sin-precio",
    tenantId: "tenant-1",
    nombre: "Shampoo Hipoalergénico",
    codigo: "SH-003",
    precioVenta: null,
    costoReposicion: 500,
    margenObjetivo: 30,
    alicuotaIva: 21,
    unidadMedidaId: "u-1",
    activo: true,
    esVendible: true,
    esConsumibleClinico: false,
    controlaLote: false,
    controlaVencimiento: false,
    vidaUtilPostAperturaDias: null,
    stockMinimo: 0,
    condicionVenta: "libre",
    requiereFrio: false,
    trazable: false,
    codigoBarras: null,
    descripcion: null,
    marca: null,
    familiaId: null,
    createdAt: "",
    updatedAt: "",
  },
];

const MOCK_CANDIDATOS_PROD_1: LoteCandidato[] = [
  {
    loteId: "lote-1",
    codigoLote: "LOT-001",
    fechaVencimiento: "2026-10-31",
    fechaIngreso: "2026-01-01",
    estado: "disponible",
    costoUnitarioEfectivo: 800,
    cantidadDisponible: 10,
  },
  {
    loteId: "lote-2",
    codigoLote: "LOT-002",
    fechaVencimiento: "2027-06-30",
    fechaIngreso: "2026-02-01",
    estado: "disponible",
    costoUnitarioEfectivo: 850,
    cantidadDisponible: 20,
  },
];

const MOCK_SERVICIOS: ServicioVendible[] = [
  {
    id: "serv-1",
    nombre: "Consulta General",
    precio: 4000,
    alicuota_iva: 21,
    tipo: "consulta",
  },
  {
    id: "serv-sin-precio",
    nombre: "Cirugía Compleja",
    precio: null,
    alicuota_iva: 21,
    tipo: "cirugia",
  },
];

const MOCK_CLIENTES: Cliente[] = [
  {
    id: "cli-1",
    fullName: "Juan Pérez",
    dniCuit: "30123456",
    phone: "1123456789",
    email: "juan@example.com",
    address: "Calle 123",
    observations: null,
    createdAt: "",
    createdBy: null,
    livePetCount: 1,
  },
];

const MOCK_RESULTADO_VENTA: ResultadoVenta = {
  ventaId: "v-999",
  numeroOperacion: "0001-00000042",
  operacionId: "op-42",
  subtotalNeto: 1239.67,
  totalIva: 260.33,
  total: 1500,
  saldoPendiente: 0,
};

function renderMostrador() {
  return render(
    <MemoryRouter initialEntries={["/ventas"]}>
      <MostradorPage />
    </MemoryRouter>,
  );
}

describe("MostradorPage (F4·T1 & F4·T2)", () => {
  beforeEach(() => {
    mockAuth.user = { ...USUARIO_VENDEDOR };
    localStorage.clear();
    vi.restoreAllMocks();

    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(MOCK_SESION_ABIERTA);
    vi.spyOn(productosApi, "listarFamilias").mockResolvedValue({
      items: MOCK_FAMILIAS,
      meta: { page: 1, limit: 100, total: 2 },
    });
    vi.spyOn(catalogosComercialApi, "listarUnidadesMedida").mockResolvedValue(MOCK_UNIDADES);
    vi.spyOn(catalogosComercialApi, "listarMediosPago").mockResolvedValue(MOCK_MEDIOS_PAGO);
    vi.spyOn(catalogosComercialApi, "listarServiciosVendibles").mockResolvedValue(MOCK_SERVICIOS);
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: MOCK_PRODUCTOS,
      meta: { page: 1, limit: 50, total: 3 },
    });
    vi.spyOn(stockApi, "candidatosFefo").mockResolvedValue(MOCK_CANDIDATOS_PROD_1);
    vi.spyOn(ventasApi, "registrarVenta").mockResolvedValue(MOCK_RESULTADO_VENTA);
    vi.spyOn(clientesApi, "listarClientes").mockResolvedValue({
      items: MOCK_CLIENTES,
      meta: { page: 1, limit: 10, total: 1 },
    });
    vi.spyOn(mascotasApi, "listarMascotas").mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 50, total: 0 },
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tests F4·T1
  // ───────────────────────────────────────────────────────────────────────────

  it("Sin sesión de caja abierta, el mostrador no se dibuja y aparece el panel con el link", async () => {
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);

    renderMostrador();

    expect(await screen.findByText("Caja cerrada")).toBeInTheDocument();
    expect(
      screen.getByText("No hay una caja abierta. Las ventas necesitan una sesión de caja."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ir a Caja para abrir sesión/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/ventas/caja");

    expect(screen.queryByText("Carrito de Venta")).not.toBeInTheDocument();
  });

  it("Sin manage_cash, el panel no muestra el link", async () => {
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);
    mockAuth.user = {
      ...USUARIO_VENDEDOR,
      permissions: ["view_stock", "manage_sales"],
    };

    renderMostrador();

    expect(await screen.findByText("Caja cerrada")).toBeInTheDocument();
    expect(
      screen.getByText("Pedí a un usuario con permisos que abra la caja."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ir a Caja/i })).not.toBeInTheDocument();
  });

  it("La búsqueda por texto hace debounce y manda vendible=true&activo=true", async () => {
    const user = userEvent.setup();
    const spyProductos = vi.spyOn(productosApi, "listarProductos");

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    const searchInput = screen.getByRole("searchbox", { name: /Buscar productos o servicios/i });
    await user.type(searchInput, "Canino");

    await waitFor(() => {
      expect(spyProductos).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "Canino",
          vendible: true,
          activo: true,
        }),
      );
    });
  });

  it("P-09: el filtro por familia existe y manda familiaId", async () => {
    const user = userEvent.setup();
    const spyProductos = vi.spyOn(productosApi, "listarProductos");

    renderMostrador();

    const chipFarmacia = await screen.findByRole("button", { name: "Farmacia" });
    expect(chipFarmacia).toBeInTheDocument();

    await user.click(chipFarmacia);

    await waitFor(() => {
      expect(spyProductos).toHaveBeenCalledWith(
        expect.objectContaining({
          familiaId: "fam-1",
          vendible: true,
          activo: true,
        }),
      );
    });
  });

  it("P-09: los favoritos persisten en localStorage por usuario y sobreviven al remontado", async () => {
    const user = userEvent.setup();

    const { unmount } = renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    const starBtn = screen.getByRole("button", { name: /Favorito Antiparasitario Canino/i });
    await user.click(starBtn);

    const rawStorage = localStorage.getItem(`leo:mostrador:favoritos:${USUARIO_VENDEDOR.id}`);
    expect(rawStorage).toBeTruthy();
    expect(rawStorage).toContain("Antiparasitario Canino");

    unmount();

    renderMostrador();

    expect(await screen.findByText("Accesos rápidos favoritos")).toBeInTheDocument();
    const favItems = screen.getAllByText("Antiparasitario Canino");
    expect(favItems.length).toBeGreaterThanOrEqual(2);
  });

  it("localStorage que tira excepción no rompe la pantalla", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key.includes("favoritos")) {
        throw new Error("SecurityError: Private browsing mode");
      }
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string) => {
      if (key.includes("favoritos")) {
        throw new Error("SecurityError: Private browsing mode");
      }
    });

    renderMostrador();

    expect(await screen.findByText("Accesos rápidos favoritos")).toBeInTheDocument();
  });

  it("Un producto con precioVenta: null está deshabilitado con el badge 'Sin precio'", async () => {
    renderMostrador();

    await screen.findByText("Shampoo Hipoalergénico");

    const badges = screen.getAllByText("Sin precio");
    expect(badges.length).toBeGreaterThanOrEqual(1);

    const row = screen.getByText("Shampoo Hipoalergénico").closest("div.flex")!;
    const agregarBtn = within(row.parentElement!).getByRole("button", { name: /Agregar/i });
    expect(agregarBtn).toBeDisabled();
  });

  it("Un servicio sin precio, igual", async () => {
    const user = userEvent.setup();

    renderMostrador();

    const tabServicios = await screen.findByRole("tab", { name: "Servicios" });
    await user.click(tabServicios);

    await screen.findByText("Cirugía Compleja");
    const badge = screen.getByText("Sin precio");
    expect(badge).toBeInTheDocument();

    const row = screen.getByText("Cirugía Compleja").closest("div.flex")!;
    const agregarBtn = within(row.parentElement!).getByRole("button", { name: /Agregar/i });
    expect(agregarBtn).toBeDisabled();
  });

  it("§2.5: el precio que se muestra es precio_venta tal cual, sin sumarle ni restarle IVA", async () => {
    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    expect(screen.getByText("$ 1.500,00")).toBeInTheDocument();
  });

  it("§2.4: el costo no aparece en ninguna parte del mostrador", async () => {
    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    expect(screen.queryByText(/900/)).not.toBeInTheDocument();
    expect(screen.queryByText(/18000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Costo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Margen/i)).not.toBeInTheDocument();
  });

  it("§2.6: no aparece 'Comprobante', 'Factura', 'Ticket' ni 'Recibo'", async () => {
    const { container } = renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    const text = container.textContent || "";
    expect(text).not.toMatch(/comprobante/i);
    expect(text).not.toMatch(/factura/i);
    expect(text).not.toMatch(/ticket/i);
    expect(text).not.toMatch(/recibo/i);
  });

  it("cuenta_corriente solo se puede elegir con cliente seleccionado", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    const condicionTrigger = screen.getByRole("combobox", { name: "Condición de pago" });
    await user.click(condicionTrigger);

    const optionCC = screen.getByRole("option", { name: /Cuenta corriente/i });
    expect(optionCC).toHaveAttribute("aria-disabled", "true");
  });

  it("El total del carrito es la suma de las líneas con IVA incluido, menos el descuento global", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    const rowProd1 = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd1 = within(rowProd1.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd1);

    const rowProd2 = screen.getByText("Alimento Perro Adulto 15kg").closest("div.flex")!;
    const btnAdd2 = within(rowProd2.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd2);

    expect(screen.getByText("$ 26.500,00")).toBeInTheDocument();

    const descInput = screen.getByRole("spinbutton", { name: "Descuento global" });
    await user.type(descInput, "1500");

    const totalContainer = screen.getByText("Total a pagar").closest("div.flex") as HTMLElement;
    expect(within(totalContainer).getByText("$ 25.000,00")).toBeInTheDocument();
  });

  it("El total combina cantidad, descuento de línea y descuento global (caso no trivial)", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    // Línea 1: Antiparasitario Canino ($ 1.500) — cantidad 3, sin descuento de línea.
    const rowProd1 = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    await user.click(within(rowProd1.parentElement!).getByRole("button", { name: /Agregar/i }));

    // Línea 2: Alimento Perro Adulto 15kg ($ 25.000) — cantidad 1, 10% de descuento.
    const rowProd2 = screen.getByText("Alimento Perro Adulto 15kg").closest("div.flex")!;
    await user.click(within(rowProd2.parentElement!).getByRole("button", { name: /Agregar/i }));

    const cantProd1 = screen.getByRole("spinbutton", {
      name: "Cantidad para Antiparasitario Canino",
    });
    await user.clear(cantProd1);
    await user.type(cantProd1, "3");

    const descProd2 = screen.getByRole("spinbutton", {
      name: "Descuento para Alimento Perro Adulto 15kg",
    });
    await user.clear(descProd2);
    await user.type(descProd2, "10");

    // Subtotal esperado: (1500 × 3) + (25000 × 1 − 10%) = 4500 + 22500 = 27000
    const totalContainer = screen.getByText("Total a pagar").closest("div.flex") as HTMLElement;
    await waitFor(() =>
      expect(within(totalContainer).getByText("$ 27.000,00")).toBeInTheDocument(),
    );

    // Descuento global de $ 1.500 sobre el subtotal: 27000 − 1500 = 25500
    const descGlobal = screen.getByRole("spinbutton", { name: "Descuento global" });
    await user.type(descGlobal, "1500");

    await waitFor(() =>
      expect(within(totalContainer).getByText("$ 25.500,00")).toBeInTheDocument(),
    );
  });

  it("Con 20 resultados, la cantidad de fetch es constante (no hay N+1)", async () => {
    const muchosProductos: Producto[] = Array.from({ length: 20 }).map((_, i) => ({
      id: `prod-bulk-${i}`,
      tenantId: "tenant-1",
      nombre: `Producto Bulk ${i}`,
      codigo: `BLK-${i}`,
      precioVenta: 100 * (i + 1),
      costoReposicion: 50,
      margenObjetivo: 50,
      alicuotaIva: 21,
      unidadMedidaId: "u-1",
      activo: true,
      esVendible: true,
      esConsumibleClinico: false,
      controlaLote: false,
      controlaVencimiento: false,
      vidaUtilPostAperturaDias: null,
      stockMinimo: 0,
      condicionVenta: "libre",
      requiereFrio: false,
      trazable: false,
      codigoBarras: null,
      descripcion: null,
      marca: null,
      familiaId: null,
      createdAt: "",
      updatedAt: "",
    }));

    const spyProductos = vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: muchosProductos,
      meta: { page: 1, limit: 50, total: 20 },
    });

    renderMostrador();

    await screen.findByText("Producto Bulk 0");
    await screen.findByText("Producto Bulk 19");

    expect(spyProductos).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Tests F4·T2: FEFO, Cobro y Cierre de Venta
  // ───────────────────────────────────────────────────────────────────────────

  it("RN §2.2: el primer lote candidato viene preseleccionado y marcado como sugerido", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    // Esperar a que se consulten los lotes FEFO
    await waitFor(() => {
      expect(stockApi.candidatosFefo).toHaveBeenCalledWith({
        productoId: "prod-1",
        cantidad: 1,
      });
    });

    // El combo de lote muestra el primer lote preseleccionado (LOT-001)
    const loteTrigger = await screen.findByRole("combobox", { name: /Lote para Antiparasitario Canino/i });
    expect(loteTrigger).toBeInTheDocument();
    expect(within(loteTrigger).getByText("LOT-001")).toBeInTheDocument();

    // No debe haber campo de motivo visible porque está en el sugerido
    expect(screen.queryByLabelText(/Motivo FEFO/i)).not.toBeInTheDocument();
  });

  it("RN §2.2: elegir un lote distinto al sugerido muestra motivoFefo EN LA MISMA LÍNEA y lo vuelve requerido", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const loteTrigger = await screen.findByRole("combobox", { name: /Lote para Antiparasitario Canino/i });
    await user.click(loteTrigger);

    // Seleccionar LOT-002 (no sugerido)
    const optionLot2 = await screen.findByRole("option", { name: /LOT-002/i });
    await user.click(optionLot2);

    // En el acto aparece el campo de motivo en la misma línea
    const motivoInput = await screen.findByLabelText(/Motivo FEFO para Antiparasitario Canino/i);
    expect(motivoInput).toBeInTheDocument();
    expect(motivoInput).toBeRequired();
  });

  it("RN §2.2: con lote no sugerido y motivo vacío, el botón de cobrar queda deshabilitado", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    // Con el lote sugerido, el botón Cobrar está habilitado
    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    expect(btnCobrar).toBeEnabled();

    // Cambiar al lote 2
    const loteTrigger = screen.getByRole("combobox", { name: /Lote para Antiparasitario Canino/i });
    await user.click(loteTrigger);
    const optionLot2 = await screen.findByRole("option", { name: /LOT-002/i });
    await user.click(optionLot2);

    // Ahora queda deshabilitado porque el motivo está vacío
    expect(btnCobrar).toBeDisabled();

    // Escribir motivo
    const motivoInput = screen.getByLabelText(/Motivo FEFO para Antiparasitario Canino/i);
    await user.type(motivoInput, "Cliente solicita expresamente lote con vencimiento más lejano");

    // Vuelve a habilitarse
    expect(btnCobrar).toBeEnabled();
  });

  it("RN §2.2: cambiar la cantidad vuelve a pedir candidatos con la cantidad nueva", async () => {
    const user = userEvent.setup();
    const spyFefo = vi.spyOn(stockApi, "candidatosFefo");

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    await waitFor(() => {
      expect(spyFefo).toHaveBeenCalledWith({ productoId: "prod-1", cantidad: 1 });
    });

    // Modificar cantidad a 5
    const cantInput = screen.getByRole("spinbutton", { name: /Cantidad para Antiparasitario Canino/i });
    await user.clear(cantInput);
    await user.type(cantInput, "5");

    await waitFor(() => {
      expect(spyFefo).toHaveBeenCalledWith({ productoId: "prod-1", cantidad: 5 });
    });
  });

  it("Sin candidatos, la línea dice 'Sin existencia disponible' y bloquea el cobro", async () => {
    const user = userEvent.setup();
    vi.spyOn(stockApi, "candidatosFefo").mockResolvedValue([]);

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    expect(await screen.findByText("Sin existencia disponible")).toBeInTheDocument();

    const btnCobrar = screen.getByRole("button", { name: "Cobrar" });
    expect(btnCobrar).toBeDisabled();
  });

  it("El cobro exige referencia cuando el medio de pago la requiere", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    // Diálogo de cobro abierto
    expect(await screen.findByText("Registro de Cobro")).toBeInTheDocument();

    // Cambiar medio de pago a Tarjeta de Crédito (requiere_referencia: true)
    const medioTrigger = screen.getByRole("combobox", { name: "Medio de pago 1" });
    await user.click(medioTrigger);

    const optionTarjeta = await screen.findByRole("option", { name: "Tarjeta de Crédito" });
    await user.click(optionTarjeta);

    // Botón confirmar debe estar deshabilitado mientras referencia esté vacía
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    expect(btnConfirmar).toBeDisabled();

    // Escribir referencia
    const refInput = screen.getByLabelText("Referencia pago 1");
    await user.type(refInput, "CUPON-12345");

    expect(btnConfirmar).toBeEnabled();
  });

  it("Con contado, cobrar se habilita solo cuando los pagos cubren el total", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    await screen.findByText("Registro de Cobro");

    // Cambiar importe a 1000 (total es 1500)
    const importeInput = screen.getByRole("spinbutton", { name: "Importe pago 1" });
    await user.clear(importeInput);
    await user.type(importeInput, "1000");

    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    expect(btnConfirmar).toBeDisabled();
    expect(screen.getByText(/Faltan cubrir \$ 500,00/i)).toBeInTheDocument();

    // Corregir a 1500
    await user.clear(importeInput);
    await user.type(importeInput, "1500");

    expect(btnConfirmar).toBeEnabled();
  });

  it("Con cuenta_corriente y cliente, se permite cubrir menos", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    // Seleccionar cliente
    const clienteBtn = screen.getByRole("combobox", { name: "Seleccionar cliente" });
    await user.click(clienteBtn);
    const cliItem = await screen.findByText("Juan Pérez");
    await user.click(cliItem);

    // Cambiar condición a cuenta corriente
    const condicionTrigger = screen.getByRole("combobox", { name: "Condición de pago" });
    await user.click(condicionTrigger);
    const optionCC = await screen.findByRole("option", { name: /Cuenta corriente/i });
    await user.click(optionCC);

    // Agregar producto
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    await screen.findByText("Registro de Cobro");

    // Cubrir solo 500
    const importeInput = screen.getByRole("spinbutton", { name: "Importe pago 1" });
    await user.clear(importeInput);
    await user.type(importeInput, "500");

    // En cuenta corriente SÍ se permite confirmar con saldo pendiente
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    expect(btnConfirmar).toBeEnabled();
    expect(screen.getByText(/Saldo pendiente a cuenta corriente de Juan Pérez/i)).toBeInTheDocument();
  });

  it("POST /ventas NO manda precioUnitario", async () => {
    const user = userEvent.setup();
    const spyRegistrar = vi.spyOn(ventasApi, "registrarVenta");

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    await screen.findByText("Registro de Cobro");
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    await user.click(btnConfirmar);

    await waitFor(() => {
      expect(spyRegistrar).toHaveBeenCalled();
    });

    const callArg = spyRegistrar.mock.calls[0][0];
    const primerItem = callArg.items[0];

    // Verificar que no viaja precioUnitario en el item
    expect((primerItem as any).precioUnitario).toBeUndefined();
    expect(primerItem.tipoItem).toBe("producto");
    expect(primerItem.productoId).toBe("prod-1");
    expect(primerItem.loteId).toBe("lote-1");
  });

  it("Cada code de error de la RPC produce su mensaje, y el carrito no se vacía", async () => {
    const user = userEvent.setup();
    vi.spyOn(ventasApi, "registrarVenta").mockRejectedValue(
      new ApiError("INSUFFICIENT_STOCK", 400, "Stock agotado"),
    );

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    await screen.findByText("Registro de Cobro");
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    await user.click(btnConfirmar);

    // Mensaje entendible renderizado
    expect(await screen.findByText("Stock insuficiente en los lotes seleccionados para completar la venta.")).toBeInTheDocument();

    // Cancelar modal de cobro y verificar que el ítem sigue en el carrito
    const btnCancelar = screen.getByRole("button", { name: "Cancelar" });
    await user.click(btnCancelar);

    expect(screen.getByRole("spinbutton", { name: /Cantidad para Antiparasitario Canino/i })).toBeInTheDocument();
    expect(screen.getAllByText("Antiparasitario Canino").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("$ 1.500,00").length).toBeGreaterThanOrEqual(2);
  });

  it("RN §2.6: el panel de éxito dice 'Operación N°' y en ningún lado 'Comprobante', 'Factura', 'Ticket' ni 'Recibo'", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    const rowProd = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd = within(rowProd.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd);

    const btnCobrar = await screen.findByRole("button", { name: "Cobrar" });
    await user.click(btnCobrar);

    await screen.findByText("Registro de Cobro");
    const btnConfirmar = screen.getByRole("button", { name: "Confirmar venta" });
    await user.click(btnConfirmar);

    // Panel de éxito
    const tituloExito = await screen.findByText("Operación N° 0001-00000042");
    expect(tituloExito).toBeInTheDocument();

    // Desglose neto / IVA acá sí aparece
    expect(screen.getByText("Subtotal neto:")).toBeInTheDocument();
    expect(screen.getByText("$ 1.239,67")).toBeInTheDocument();
    expect(screen.getByText("IVA:")).toBeInTheDocument();
    expect(screen.getByText("$ 260,33")).toBeInTheDocument();

    // Ninguna palabra prohibida
    const modalContent = tituloExito.closest("div[role='dialog']")?.textContent || "";
    expect(modalContent).not.toMatch(/comprobante/i);
    expect(modalContent).not.toMatch(/factura/i);
    expect(modalContent).not.toMatch(/ticket/i);
    expect(modalContent).not.toMatch(/recibo/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Optimizaciones de Red / Latencia
  // ───────────────────────────────────────────────────────────────────────────

  it("Optimización: catálogos y productos salen en paralelo con la verificación de caja (sin cascada)", async () => {
    const spyFamilias = vi.spyOn(productosApi, "listarFamilias");
    const spyProductos = vi.spyOn(productosApi, "listarProductos");
    const spyUnidades = vi.spyOn(catalogosComercialApi, "listarUnidadesMedida");

    renderMostrador();

    // Salen de inmediato en el mount sin esperar a que sesionActual responda
    expect(spyFamilias).toHaveBeenCalled();
    expect(spyProductos).toHaveBeenCalled();
    expect(spyUnidades).toHaveBeenCalled();
  });

  it("Optimización: servicios vendibles se difiere y no se pide al cargar hasta abrir su pestaña", async () => {
    const user = userEvent.setup();
    const spyServicios = vi.spyOn(catalogosComercialApi, "listarServiciosVendibles");

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");
    // Al montar en la pestaña productos, servicios vendibles no se llamó
    expect(spyServicios).not.toHaveBeenCalled();

    // Al cambiar a la pestaña Servicios, recién ahí se pide
    const tabServicios = screen.getByRole("tab", { name: "Servicios" });
    await user.click(tabServicios);

    await waitFor(() => {
      expect(spyServicios).toHaveBeenCalledTimes(1);
    });
  });
});
