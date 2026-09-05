import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ComprasPage } from "./ComprasPage.tsx";
import * as comprasApi from "../api/comercial/compras.ts";
import * as proveedoresApi from "../api/comercial/proveedores.ts";
import type { Compra, Proveedor } from "../types/index.ts";

const MOCK_PROVEEDORES: Proveedor[] = [
  {
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
  },
];

const MOCK_COMPRAS: Compra[] = [
  {
    id: "c-1",
    fecha: "2026-03-01",
    comprobanteProveedorTipo: "Factura A",
    comprobanteProveedorNumero: "0001-00001234",
    totalNeto: 1000,
    totalIva: 210,
    total: 1210,
    estado: "borrador",
    generaEgresoCaja: false,
    observaciones: "Compra de prueba 1",
    proveedor: { id: "prov-1", razonSocial: "Droguería Sur", cuit: "30-11223344-5" },
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
  },
  {
    id: "c-2",
    fecha: "2026-03-02",
    comprobanteProveedorTipo: "Remito",
    comprobanteProveedorNumero: "0002-00005678",
    totalNeto: 5000,
    totalIva: 525,
    total: 5525,
    estado: "confirmada",
    generaEgresoCaja: true,
    observaciones: null,
    proveedor: { id: "prov-1", razonSocial: "Droguería Sur", cuit: "30-11223344-5" },
    createdAt: "2026-03-02T11:00:00Z",
    updatedAt: "2026-03-02T11:00:00Z",
  },
  {
    id: "c-3",
    fecha: "2026-03-03",
    comprobanteProveedorTipo: "Factura B",
    comprobanteProveedorNumero: "0003-00009999",
    totalNeto: 800,
    totalIva: 168,
    total: 968,
    estado: "anulada",
    generaEgresoCaja: false,
    observaciones: "Anulada por error de carga",
    proveedor: { id: "prov-1", razonSocial: "Droguería Sur", cuit: "30-11223344-5" },
    createdAt: "2026-03-03T12:00:00Z",
    updatedAt: "2026-03-03T12:00:00Z",
  },
];

describe("ComprasPage (F2·T3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(proveedoresApi, "listarProveedores").mockResolvedValue({
      items: MOCK_PROVEEDORES,
      meta: { page: 1, limit: 100, total: 1 },
    });
    vi.spyOn(comprasApi, "listarCompras").mockResolvedValue({
      items: MOCK_COMPRAS,
      meta: { page: 1, limit: 20, total: 3 },
    });
  });

  it("renderiza lista de compras y sus badges de estado (borrador, confirmada, anulada)", async () => {
    render(
      <MemoryRouter>
        <ComprasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Compras" })).toBeInTheDocument();

    // Verificamos los badges de estado
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
    expect(screen.getByText("Anulada")).toBeInTheDocument();

    // Comprobante de proveedor
    expect(screen.getByText(/0001-00001234/)).toBeInTheDocument();
  });

  it("muestra estado de carga", () => {
    vi.spyOn(comprasApi, "listarCompras").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <ComprasPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("compras-loading").length).toBeGreaterThan(0);
  });

  it("muestra estado de error", async () => {
    vi.spyOn(comprasApi, "listarCompras").mockRejectedValue(new Error("Error de conexión con compras"));

    render(
      <MemoryRouter>
        <ComprasPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Error de conexión con compras/i);
  });

  it("muestra estado vacío", async () => {
    vi.spyOn(comprasApi, "listarCompras").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });

    render(
      <MemoryRouter>
        <ComprasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No se encontraron compras registradas/i)).toBeInTheDocument();
  });
});
