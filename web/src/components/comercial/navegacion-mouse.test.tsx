import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, ModuloContratado } from "../../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: null as AuthUser | null,
  login: () => Promise.resolve(),
  logout: vi.fn(() => Promise.resolve()),
};

vi.mock("../../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../../components/accesibilidad/AccessibilityButton.tsx", () => ({
  AccessibilityButton: () => null,
}));

const fetchModulosHabilitadosMock = vi.fn<() => Promise<ModuloContratado[]>>();
vi.mock("../../api/modulos.ts", () => ({
  fetchModulosHabilitados: () => fetchModulosHabilitadosMock(),
}));

import { App } from "../../App.tsx";

const USUARIO_ADMIN_COMERCIAL: AuthUser = {
  id: "u-admin-comercial",
  username: "admin",
  fullName: "Administrador Comercial",
  roleName: "Administrador",
  permissions: [
    "view_stock",
    "manage_products",
    "manage_suppliers",
    "manage_stock",
    "split_stock",
    "manage_sales",
    "manage_cash",
    "view_sales",
  ],
};

describe("Navegación completa por mouse (F9·T1)", () => {
  beforeEach(() => {
    mockAuth.user = USUARIO_ADMIN_COMERCIAL;
    fetchModulosHabilitadosMock.mockReset();
    fetchModulosHabilitadosMock.mockResolvedValue([
      { modulo: "stock", habilitado: true, fechaAlta: null },
      { modulo: "ventas", habilitado: true, fechaAlta: null },
    ]);
  });

  it("Navegación completa de Stock: desde Sidebar -> Hub Stock -> 12 secciones -> breadcrumb vuelve al Hub", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    // 1. Clic en "Stock" en el Sidebar
    const sidebar = await screen.findByRole("navigation", { name: "Navegación principal" });
    const stockSidebarLink = within(sidebar).getByRole("link", { name: "Stock" });
    await user.click(stockSidebarLink);

    // Verificamos que estamos en el Hub de Stock
    expect(await screen.findByRole("heading", { level: 1, name: "Stock" })).toBeInTheDocument();
    expect(screen.getByText(/Gestión integral de catálogo/i)).toBeInTheDocument();

    // 2. Recorrido de cada una de las 12 secciones de StockPage
    const seccionesStock = [
      { cardTitle: "Productos", hrefExpected: "/stock/productos", headingExpected: "Catálogo de Productos" },
      { cardTitle: "Familias", hrefExpected: "/stock/familias", headingExpected: "Familias de Productos" },
      { cardTitle: "Proveedores", hrefExpected: "/stock/proveedores", headingExpected: "Proveedores" },
      { cardTitle: "Precios", hrefExpected: "/stock/productos/precios", headingExpected: "Carga Asistida de Precios" },
      { cardTitle: "Existencias", hrefExpected: "/stock/existencias", headingExpected: "Existencias de Stock" },
      { cardTitle: "Lotes", hrefExpected: "/stock/lotes", headingExpected: "Lotes de Stock" },
      { cardTitle: "Vencimientos", hrefExpected: "/stock/vencimientos", headingExpected: "Vencimientos Próximos" },
      { cardTitle: "Compras", hrefExpected: "/stock/compras", headingExpected: "Compras" },
      { cardTitle: "Ajustes", hrefExpected: "/stock/ajustes", headingExpected: "Ajustes de Stock" },
      { cardTitle: "Recuentos", hrefExpected: "/stock/recuentos", headingExpected: "Recuentos de Inventario" },
      { cardTitle: "Fraccionamiento", hrefExpected: "/stock/fraccionamiento", headingExpected: "Fraccionamiento de Lotes" },
      { cardTitle: "Reportes", hrefExpected: "/stock/reportes", headingExpected: "Reportes de Stock" },
    ];

    for (const { cardTitle, hrefExpected, headingExpected } of seccionesStock) {
      // Estamos en el Hub de Stock, buscamos el card por su título h3
      const main = screen.getByRole("main");
      const cardHeading = within(main).getByRole("heading", { level: 3, name: cardTitle });
      const cardLink = cardHeading.closest("a");
      expect(cardLink).not.toBeNull();
      expect(cardLink).toHaveAttribute("href", hrefExpected);

      // Hacemos click en el card
      await user.click(cardLink!);

      // Verificamos que la pantalla cargó con su heading correspondiente
      expect(await screen.findByRole("heading", { level: 1, name: headingExpected })).toBeInTheDocument();

      // Usamos el Breadcrumb para volver al Hub de Stock
      const breadcrumbNav = within(screen.getByRole("main")).getByRole("navigation", { name: /breadcrumb/i });
      const stockBreadcrumbLink = within(breadcrumbNav).getByRole("link", { name: "Stock" });
      await user.click(stockBreadcrumbLink);

      // Verificamos que regresamos al Hub de Stock
      expect(await screen.findByRole("heading", { level: 1, name: "Stock" })).toBeInTheDocument();
    }
  });

  it("Navegación de sub-pantallas de detalle de Stock con breadcrumbs jerárquicos", async () => {
    // Detalle de Lote
    const { unmount: unmountLote } = render(
      <MemoryRouter initialEntries={["/stock/lotes/lote-001"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Lote" })).toBeInTheDocument();
    const bcLote = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(bcLote).getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/stock");
    expect(within(bcLote).getByRole("link", { name: "Lotes" })).toHaveAttribute("href", "/stock/lotes");
    unmountLote();

    // Detalle de Compra
    const { unmount: unmountCompra } = render(
      <MemoryRouter initialEntries={["/stock/compras/compra-001"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Compra" })).toBeInTheDocument();
    const bcCompra = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(bcCompra).getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/stock");
    expect(within(bcCompra).getByRole("link", { name: "Compras" })).toHaveAttribute("href", "/stock/compras");
    unmountCompra();

    // Detalle de Recuento
    const { unmount: unmountRecuento } = render(
      <MemoryRouter initialEntries={["/stock/recuentos/rec-001"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Recuento" })).toBeInTheDocument();
    const bcRecuento = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(bcRecuento).getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/stock");
    expect(within(bcRecuento).getByRole("link", { name: "Recuentos" })).toHaveAttribute("href", "/stock/recuentos");
    unmountRecuento();
  });

  it("Navegación de Ventas: desde Sidebar -> Mostrador -> VentasNav (Historial, Caja, Reportes, Mostrador)", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    // 1. Clic en "Ventas" en el Sidebar
    const sidebar = await screen.findByRole("navigation", { name: "Navegación principal" });
    const ventasSidebarLink = within(sidebar).getByRole("link", { name: "Ventas" });
    await user.click(ventasSidebarLink);

    // Verificamos que estamos en Mostrador de Ventas
    expect(await screen.findByRole("heading", { level: 1, name: "Mostrador de Ventas" })).toBeInTheDocument();

    // 2. Navegar a Historial mediante VentasNav
    const navVentas = screen.getByRole("navigation", { name: "Navegación de ventas" });
    const historialLink = within(navVentas).getByRole("link", { name: /Historial/i });
    await user.click(historialLink);
    expect(await screen.findByRole("heading", { level: 1, name: "Historial de Ventas" })).toBeInTheDocument();

    // 3. Navegar a Caja mediante VentasNav
    const navCaja = screen.getByRole("navigation", { name: "Navegación de ventas" });
    const cajaLink = within(navCaja).getByRole("link", { name: /Caja/i });
    await user.click(cajaLink);
    expect(await screen.findByRole("heading", { level: 1, name: "Sesión de Caja" })).toBeInTheDocument();

    // 4. Navegar a Reportes mediante VentasNav
    const navReportes = screen.getByRole("navigation", { name: "Navegación de ventas" });
    const reportesLink = within(navReportes).getByRole("link", { name: /Reportes/i });
    await user.click(reportesLink);
    expect(await screen.findByRole("heading", { level: 1, name: "Reportes de Ventas" })).toBeInTheDocument();

    // 5. Volver al Mostrador mediante VentasNav
    const navMostrador = screen.getByRole("navigation", { name: "Navegación de ventas" });
    const mostradorLink = within(navMostrador).getByRole("link", { name: /Mostrador/i });
    await user.click(mostradorLink);
    expect(await screen.findByRole("heading", { level: 1, name: "Mostrador de Ventas" })).toBeInTheDocument();
  });

  it("Detalle de Venta y Detalle de Sesión de Caja son accesibles", async () => {
    // Detalle de Venta
    const { unmount: unmountVenta } = render(
      <MemoryRouter initialEntries={["/ventas/v-001"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Venta" })).toBeInTheDocument();
    unmountVenta();

    // Arqueo / Detalle de Sesión de Caja
    const { unmount: unmountCaja } = render(
      <MemoryRouter initialEntries={["/ventas/caja/ses-001"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Detalle de Sesión de Caja" })).toBeInTheDocument();
    unmountCaja();
  });
});
