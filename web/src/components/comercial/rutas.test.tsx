import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const USUARIO_COMERCIAL_COMPLETO: AuthUser = {
  id: "u-comercial",
  username: "vendedor",
  fullName: "Vendedor Demo",
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

beforeEach(() => {
  mockAuth.user = USUARIO_COMERCIAL_COMPLETO;
  fetchModulosHabilitadosMock.mockReset();
  fetchModulosHabilitadosMock.mockResolvedValue([
    { modulo: "stock", habilitado: true, fechaAlta: null },
    { modulo: "ventas", habilitado: true, fechaAlta: null },
  ]);
});

const RUTAS_COMERCIALES = [
  { path: "/stock", tituloEsperado: "Stock" },
  { path: "/stock/existencias", tituloEsperado: "Existencias de Stock" },
  { path: "/stock/productos", tituloEsperado: "Catálogo de Productos" },
  { path: "/stock/productos/precios", tituloEsperado: "Carga Asistida de Precios" },
  { path: "/stock/familias", tituloEsperado: "Familias de Productos" },
  { path: "/stock/lotes/l-123", tituloEsperado: "Detalle de Lote" },
  { path: "/stock/vencimientos", tituloEsperado: "Vencimientos Próximos" },
  { path: "/stock/proveedores", tituloEsperado: "Proveedores" },
  { path: "/stock/compras", tituloEsperado: "Compras" },
  { path: "/stock/compras/c-123", tituloEsperado: "Detalle de Compra" },
  { path: "/stock/ajustes", tituloEsperado: "Ajustes de Stock" },
  { path: "/stock/recuentos", tituloEsperado: "Recuentos de Inventario" },
  { path: "/stock/recuentos/r-123", tituloEsperado: "Detalle de Recuento" },
  { path: "/stock/fraccionamiento", tituloEsperado: "Fraccionamiento de Lotes" },
  { path: "/stock/reportes", tituloEsperado: "Reportes de Stock" },
  { path: "/ventas", tituloEsperado: "Mostrador de Ventas" },
  { path: "/ventas/historial", tituloEsperado: "Historial de Ventas" },
  { path: "/ventas/v-123", tituloEsperado: "Detalle de Venta" },
  { path: "/ventas/caja", tituloEsperado: "Sesión de Caja" },
  { path: "/ventas/caja/ses-123", tituloEsperado: "Detalle de Sesión de Caja" },
  { path: "/ventas/reportes", tituloEsperado: "Reportes de Ventas" },
];

describe("Rutas y Gating Comercial (F1·T1)", () => {
  for (const { path, tituloEsperado } of RUTAS_COMERCIALES) {
    it(`navegar a '${path}' con módulo contratado y permiso renderiza el placeholder con título '${tituloEsperado}'`, async () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );

      const heading = await screen.findByRole("heading", { level: 1, name: tituloEsperado });
      expect(heading).toBeInTheDocument();
      if (
        path !== "/stock/productos/precios" &&
        path !== "/stock/productos" &&
        path !== "/stock/familias" &&
        path !== "/stock/proveedores" &&
        path !== "/stock/existencias" &&
        path !== "/stock/lotes/l-123" &&
        path !== "/stock/vencimientos" &&
        path !== "/stock/compras" &&
        path !== "/stock/compras/c-123" &&
        path !== "/ventas/caja"
      ) {
        expect(
          screen.getByText("Esta pantalla se habilitará en las siguientes tandas del módulo comercial."),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Ruta configurada y protegida por permisos/),
        ).toBeInTheDocument();
      }
    });
  }

  it("si el usuario no tiene el permiso correspondiente, RequirePermission bloquea el acceso", async () => {
    mockAuth.user = {
      ...USUARIO_COMERCIAL_COMPLETO,
      permissions: ["view_stock"], // Solo view_stock, no manage_products
    };

    render(
      <MemoryRouter initialEntries={["/stock/productos"]}>
        <App />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole("heading", { level: 1, name: "Sin acceso" });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Catálogo de Productos" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Tu rol no tiene permiso para ver esta sección."),
    ).toBeInTheDocument();
  });

  it("si el tenant no tiene 'stock' contratado, RequireModule bloquea el acceso a /stock", async () => {
    fetchModulosHabilitadosMock.mockResolvedValue([
      { modulo: "ventas", habilitado: true, fechaAlta: null },
    ]);

    render(
      <MemoryRouter initialEntries={["/stock"]}>
        <App />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole("heading", { level: 1, name: "Módulo no contratado" });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stock" })).not.toBeInTheDocument();
    expect(screen.getByText(/no forma parte del plan contratado/)).toBeInTheDocument();
    expect(screen.getAllByText(/Stock e Inventario/).length).toBeGreaterThan(0);
  });

  it("si el tenant no tiene 'ventas' contratado, RequireModule bloquea el acceso a /ventas", async () => {
    fetchModulosHabilitadosMock.mockResolvedValue([
      { modulo: "stock", habilitado: true, fechaAlta: null },
    ]);

    render(
      <MemoryRouter initialEntries={["/ventas"]}>
        <App />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole("heading", { level: 1, name: "Módulo no contratado" });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mostrador de Ventas" })).not.toBeInTheDocument();
    expect(screen.getByText(/no forma parte del plan contratado/)).toBeInTheDocument();
    expect(screen.getAllByText(/Ventas y Facturación/).length).toBeGreaterThan(0);
  });
});
