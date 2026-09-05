import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MostradorPage } from "./MostradorPage.tsx";
import * as cajaApi from "../api/comercial/caja.ts";
import * as productosApi from "../api/comercial/productos.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import * as clientesApi from "../api/clientes.ts";
import * as mascotasApi from "../api/mascotas.ts";
import type {
  AuthUser,
  Cliente,
  Familia,
  Producto,
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

function renderMostrador() {
  return render(
    <MemoryRouter initialEntries={["/ventas"]}>
      <MostradorPage />
    </MemoryRouter>,
  );
}

describe("MostradorPage (F4·T1) — Catálogo, Buscador y Carrito", () => {
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
    vi.spyOn(catalogosComercialApi, "listarServiciosVendibles").mockResolvedValue(MOCK_SERVICIOS);
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: MOCK_PRODUCTOS,
      meta: { page: 1, limit: 50, total: 3 },
    });
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

    // No se dibuja el carrito ni el buscador
    expect(screen.queryByText("Carrito de Venta")).not.toBeInTheDocument();
  });

  it("Sin manage_cash, el panel no muestra el link", async () => {
    vi.spyOn(cajaApi, "sesionActual").mockResolvedValue(null);
    mockAuth.user = {
      ...USUARIO_VENDEDOR,
      permissions: ["view_stock", "manage_sales"], // sin manage_cash
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

    // Verificar que se guardó en localStorage con key del usuario
    const rawStorage = localStorage.getItem(`leo:mostrador:favoritos:${USUARIO_VENDEDOR.id}`);
    expect(rawStorage).toBeTruthy();
    expect(rawStorage).toContain("Antiparasitario Canino");

    unmount();

    // Remontar pantalla
    renderMostrador();

    // Debe mostrarse en la sección de favoritos
    expect(await screen.findByText("Accesos rápidos favoritos")).toBeInTheDocument();
    const favItems = screen.getAllByText("Antiparasitario Canino");
    expect(favItems.length).toBeGreaterThanOrEqual(2); // en favoritos y en la lista
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

    // El botón Agregar para ese producto debe estar deshabilitado
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
    // prod-1 tiene precioVenta = 1500. Se debe ver exactamente $ 1.500,00
    expect(screen.getByText("$ 1.500,00")).toBeInTheDocument();
  });

  it("§2.4: el costo no aparece en ninguna parte del mostrador", async () => {
    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    // costoReposicion de prod-1 es 900, de prod-2 es 18000
    expect(screen.queryByText(/900/)).not.toBeInTheDocument();
    expect(screen.queryByText(/18000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Costo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Margen/i)).not.toBeInTheDocument();
  });

  it("§2.6: no aparece 'Comprobante', 'Factura', 'Ticket' ni 'Recibo'", async () => {
    const { container } = renderMostrador();

    await screen.findByText("Mostrador de Ventas");

    const text = container.textContent || "";
    expect(text).not.toMatch(/comprobante/i);
    expect(text).not.toMatch(/factura/i);
    expect(text).not.toMatch(/ticket/i);
    expect(text).not.toMatch(/recibo/i);
  });

  it("cuenta_corriente solo se puede elegir con cliente seleccionado", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Mostrador de Ventas");

    // Abrir select de condición de pago
    const condicionTrigger = screen.getByRole("combobox", { name: "Condición de pago" });
    await user.click(condicionTrigger);

    // La opción cuenta corriente debe estar deshabilitada sin cliente
    const optionCC = screen.getByRole("option", { name: /Cuenta corriente/i });
    expect(optionCC).toHaveAttribute("aria-disabled", "true");
  });

  it("El total del carrito es la suma de las líneas con IVA incluido, menos el descuento global", async () => {
    const user = userEvent.setup();

    renderMostrador();

    await screen.findByText("Antiparasitario Canino");

    // Agregar producto 1 (1500)
    const rowProd1 = screen.getByText("Antiparasitario Canino").closest("div.flex")!;
    const btnAdd1 = within(rowProd1.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd1);

    // Agregar producto 2 (25000)
    const rowProd2 = screen.getByText("Alimento Perro Adulto 15kg").closest("div.flex")!;
    const btnAdd2 = within(rowProd2.parentElement!).getByRole("button", { name: /Agregar/i });
    await user.click(btnAdd2);

    // Total inicial = 1500 + 25000 = 26500
    expect(screen.getByText("$ 26.500,00")).toBeInTheDocument();

    // Aplicar descuento global de $ 1500
    const descInput = screen.getByRole("spinbutton", { name: "Descuento global" });
    await user.type(descInput, "1500");

    // Total nuevo = 25000 en el pie del carrito
    const totalContainer = screen.getByText("Total a pagar").closest("div.flex") as HTMLElement;
    expect(within(totalContainer).getByText("$ 25.000,00")).toBeInTheDocument();
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

    // Debe haber un solo fetch para traer los 20 productos (no un fetch por producto para stock ni nada)
    expect(spyProductos).toHaveBeenCalledTimes(1);
  });
});
