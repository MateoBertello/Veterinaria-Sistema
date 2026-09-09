import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StockPage } from "./StockPage.tsx";
import type { AuthUser } from "../types/index.ts";

const mockAuth = {
  user: null as AuthUser | null,
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

const ADMIN_USER: AuthUser = {
  id: "u-admin",
  username: "admin",
  fullName: "Administrador Demo",
  roleName: "Administrador",
  permissions: [
    "view_stock",
    "manage_products",
    "manage_suppliers",
    "manage_stock",
    "split_stock",
    "consume_stock",
    "manage_sales",
    "manage_cash",
    "view_sales",
    "void_sales",
  ],
};

const VETERINARIO_USER: AuthUser = {
  id: "u-vet",
  username: "vet",
  fullName: "Veterinario Demo",
  roleName: "Veterinario",
  permissions: [
    "view_stock",
    "split_stock",
    "consume_stock",
    "manage_sales",
  ],
};

const RECEPCIONISTA_USER: AuthUser = {
  id: "u-rec",
  username: "recep",
  fullName: "Recepcionista Demo",
  roleName: "Recepcionista",
  permissions: [
    "view_stock",
    "split_stock",
    "manage_suppliers",
    "manage_sales",
    "manage_cash",
  ],
};

const SIN_PERMISOS_USER: AuthUser = {
  id: "u-none",
  username: "sin_permisos",
  fullName: "Usuario Sin Permisos",
  roleName: "Invitado",
  permissions: [],
};

describe("StockPage — Hub de Stock y Gating por Permisos", () => {
  beforeEach(() => {
    mockAuth.user = ADMIN_USER;
  });

  it("renderiza el título principal 'Stock' y subtítulo", () => {
    render(
      <MemoryRouter>
        <StockPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Stock" })).toBeInTheDocument();
  });

  describe("Rol Administrador (todos los permisos)", () => {
    it("renderiza los 4 grupos de stock", () => {
      mockAuth.user = ADMIN_USER;
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Catálogo" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Existencias" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Operaciones" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Análisis" })).toBeInTheDocument();
    });

    it("renderiza todos los accesos del módulo con sus enlaces correspondientes", () => {
      mockAuth.user = ADMIN_USER;
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      // Catálogo
      expect(screen.getByRole("link", { name: /^Productos/i })).toHaveAttribute("href", "/stock/productos");
      expect(screen.getByRole("link", { name: /^Familias/i })).toHaveAttribute("href", "/stock/familias");
      expect(screen.getByRole("link", { name: /^Proveedores/i })).toHaveAttribute("href", "/stock/proveedores");
      expect(screen.getByRole("link", { name: /^Carga masiva de precios/i })).toHaveAttribute("href", "/stock/productos/precios");

      // Existencias
      expect(screen.getByRole("link", { name: /^Existencias/i })).toHaveAttribute("href", "/stock/existencias");
      expect(screen.getByRole("link", { name: /^Vencimientos/i })).toHaveAttribute("href", "/stock/vencimientos");
      expect(screen.getByRole("link", { name: /^Lotes/i })).toHaveAttribute("href", "/stock/lotes");

      // Operaciones
      expect(screen.getByRole("link", { name: /^Compras/i })).toHaveAttribute("href", "/stock/compras");
      expect(screen.getByRole("link", { name: /^Ajustes/i })).toHaveAttribute("href", "/stock/ajustes");
      expect(screen.getByRole("link", { name: /^Recuentos/i })).toHaveAttribute("href", "/stock/recuentos");
      expect(screen.getByRole("link", { name: /^Fraccionamiento/i })).toHaveAttribute("href", "/stock/fraccionamiento");

      // Análisis
      expect(screen.getByRole("link", { name: /^Reportes/i })).toHaveAttribute("href", "/stock/reportes");
    });
  });

  describe("Rol Veterinario (view_stock, split_stock, consume_stock, manage_sales)", () => {
    beforeEach(() => {
      mockAuth.user = VETERINARIO_USER;
    });

    it("NO renderiza el grupo 'Catálogo' porque no tiene manage_products ni manage_suppliers", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("heading", { level: 2, name: "Catálogo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Productos/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Familias/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Proveedores/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Carga masiva de precios/i })).not.toBeInTheDocument();
    });

    it("renderiza el grupo 'Existencias' completo (view_stock)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Existencias" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Existencias/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Vencimientos/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Lotes/i })).toBeInTheDocument();
    });

    it("en 'Operaciones' SOLO renderiza 'Fraccionamiento' (split_stock)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Operaciones" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Fraccionamiento/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Compras/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Ajustes/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Recuentos/i })).not.toBeInTheDocument();
    });

    it("renderiza el grupo 'Análisis' con 'Reportes' (view_stock)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Análisis" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Reportes/i })).toBeInTheDocument();
    });
  });

  describe("Rol Recepcionista (view_stock, split_stock, manage_suppliers, manage_sales, manage_cash)", () => {
    beforeEach(() => {
      mockAuth.user = RECEPCIONISTA_USER;
    });

    it("en 'Catálogo' SOLO renderiza 'Proveedores' (manage_suppliers)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Catálogo" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Proveedores/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Productos/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Familias/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Carga masiva de precios/i })).not.toBeInTheDocument();
    });

    it("renderiza 'Existencias' completo (view_stock)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Existencias" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Existencias/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Vencimientos/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Lotes/i })).toBeInTheDocument();
    });

    it("en 'Operaciones' renderiza 'Compras' y 'Fraccionamiento', pero NO Ajustes ni Recuentos", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Operaciones" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Compras/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Fraccionamiento/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Ajustes/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Recuentos/i })).not.toBeInTheDocument();
    });

    it("renderiza 'Análisis' con 'Reportes' (view_stock)", () => {
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Análisis" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^Reportes/i })).toBeInTheDocument();
    });
  });

  describe("Usuario sin permisos comerciales de stock", () => {
    it("no renderiza ningún grupo y muestra mensaje de estado vacío o sin permisos", () => {
      mockAuth.user = SIN_PERMISOS_USER;
      render(
        <MemoryRouter>
          <StockPage />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("heading", { level: 2, name: "Catálogo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Existencias" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Operaciones" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Análisis" })).not.toBeInTheDocument();
      expect(screen.getByText(/No tenés permisos para acceder a las secciones de Stock/i)).toBeInTheDocument();
    });
  });
});
