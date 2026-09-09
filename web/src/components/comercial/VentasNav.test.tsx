import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VentasNav } from "./VentasNav.tsx";
import type { AuthUser } from "../../types/index.ts";

const mockAuth = {
  user: null as AuthUser | null,
};

vi.mock("../../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

describe("VentasNav", () => {
  it("Admin ve todos los accesos: Mostrador, Historial, Caja, Reportes", () => {
    mockAuth.user = {
      id: "u-1",
      username: "admin",
      fullName: "Admin",
      roleName: "Administrador",
      permissions: ["manage_sales", "manage_cash", "view_sales"],
    };

    render(
      <MemoryRouter initialEntries={["/ventas"]}>
        <VentasNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Mostrador/i })).toHaveAttribute("href", "/ventas");
    expect(screen.getByRole("link", { name: /Historial/i })).toHaveAttribute("href", "/ventas/historial");
    expect(screen.getByRole("link", { name: /Caja/i })).toHaveAttribute("href", "/ventas/caja");
    expect(screen.getByRole("link", { name: /Reportes/i })).toHaveAttribute("href", "/ventas/reportes");
  });

  it("Veterinario ve Mostrador e Historial, pero NO Caja ni Reportes", () => {
    mockAuth.user = {
      id: "u-2",
      username: "vet",
      fullName: "Vet",
      roleName: "Veterinario",
      permissions: ["manage_sales"],
    };

    render(
      <MemoryRouter initialEntries={["/ventas"]}>
        <VentasNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Mostrador/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Historial/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Caja/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Reportes/i })).not.toBeInTheDocument();
  });

  it("Recepcionista ve Mostrador, Historial y Caja, pero NO Reportes", () => {
    mockAuth.user = {
      id: "u-3",
      username: "rec",
      fullName: "Recep",
      roleName: "Recepcionista",
      permissions: ["manage_sales", "manage_cash"],
    };

    render(
      <MemoryRouter initialEntries={["/ventas"]}>
        <VentasNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Mostrador/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Historial/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Caja/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Reportes/i })).not.toBeInTheDocument();
  });
});
