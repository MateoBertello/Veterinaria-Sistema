import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StockBreadcrumb } from "./StockBreadcrumb.tsx";

describe("StockBreadcrumb", () => {
  it("renderiza el enlace a Stock como primer ítem", () => {
    render(
      <MemoryRouter>
        <StockBreadcrumb items={[{ label: "Catálogo de Productos" }]} />
      </MemoryRouter>,
    );

    const stockLink = screen.getByRole("link", { name: "Stock" });
    expect(stockLink).toHaveAttribute("href", "/stock");
    expect(screen.getByText("Catálogo de Productos")).toBeInTheDocument();
  });

  it("renderiza migas intermedias con enlaces y la última como página actual", () => {
    render(
      <MemoryRouter>
        <StockBreadcrumb
          items={[
            { label: "Compras", href: "/stock/compras" },
            { label: "Detalle de Compra" },
          ]}
        />
      </MemoryRouter>,
    );

    const stockLink = screen.getByRole("link", { name: "Stock" });
    expect(stockLink).toHaveAttribute("href", "/stock");

    const comprasLink = screen.getByRole("link", { name: "Compras" });
    expect(comprasLink).toHaveAttribute("href", "/stock/compras");

    expect(screen.getByText("Detalle de Compra")).toBeInTheDocument();
  });
});
