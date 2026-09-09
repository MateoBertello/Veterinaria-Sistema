import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LotesPage } from "./LotesPage.tsx";
import * as stockApi from "../api/comercial/stock.ts";
import type { EstadoLote, Lote } from "../types/index.ts";

const MOCK_LOTES: Lote[] = [
  {
    id: "lote-1",
    codigoLote: "LOT-2026-001",
    fechaVencimiento: "2026-12-31",
    fechaIngreso: "2026-01-10",
    costoUnitarioNeto: 100,
    costoUnitarioEfectivo: 121,
    estado: "disponible",
    origen: "compra",
    producto: { id: "prod-1", codigo: "MED-001", nombre: "Amoxicilina 500mg" },
    proveedor: { id: "prov-1", razonSocial: "Droguería Sur" },
    cantidad: 50,
  },
  {
    id: "lote-2",
    codigoLote: "LOT-2026-002",
    fechaVencimiento: "2026-11-15",
    fechaIngreso: "2026-02-15",
    costoUnitarioNeto: 200,
    costoUnitarioEfectivo: 242,
    estado: "cuarentena",
    origen: "compra",
    producto: { id: "prod-2", codigo: "MED-002", nombre: "Ibuprofeno Gotas" },
    proveedor: { id: "prov-2", razonSocial: "Laboratorios Vet" },
    cantidad: 20,
  },
  {
    id: "lote-3",
    codigoLote: "LOT-2026-003",
    fechaVencimiento: "2026-05-01",
    fechaIngreso: "2026-01-05",
    costoUnitarioNeto: 50,
    costoUnitarioEfectivo: 60.5,
    estado: "bloqueado",
    origen: "ajuste",
    producto: { id: "prod-3", codigo: "MED-003", nombre: "Antiparasitario Canino" },
    proveedor: null,
    cantidad: 15,
  },
  {
    id: "lote-4",
    codigoLote: "LOT-2026-004",
    fechaVencimiento: "2025-12-31",
    fechaIngreso: "2025-01-01",
    costoUnitarioNeto: 80,
    costoUnitarioEfectivo: 96.8,
    estado: "vencido",
    origen: "compra",
    producto: { id: "prod-4", codigo: "MED-004", nombre: "Vacuna Antirrábica" },
    proveedor: null,
    cantidad: 10,
  },
  {
    id: "lote-5",
    codigoLote: "LOT-2026-005",
    fechaVencimiento: "2026-08-20",
    fechaIngreso: "2026-02-01",
    costoUnitarioNeto: 120,
    costoUnitarioEfectivo: 145.2,
    estado: "agotado",
    origen: "compra",
    producto: { id: "prod-5", codigo: "MED-005", nombre: "Cefalexina 250mg" },
    proveedor: null,
    cantidad: 0,
  },
];

describe("LotesPage (F2·T1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(stockApi, "listarLotes").mockResolvedValue({
      items: MOCK_LOTES,
      meta: { page: 1, limit: 20, total: 5 },
    });
  });

  it("los badges de estado corresponden a los cinco valores del ENUM", async () => {
    render(
      <MemoryRouter>
        <LotesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("LOT-2026-001")).toBeInTheDocument();

    // Verificamos los 5 estados
    expect(screen.getByText("Disponible")).toBeInTheDocument();
    expect(screen.getByText("Cuarentena")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getByText("Vencido")).toBeInTheDocument();
    expect(screen.getByText("Agotado")).toBeInTheDocument();
  });

  it("§4.3: con conExistencia activo, el paginador no usa meta.total y 'Siguiente' se deshabilita cuando la respuesta trae menos de limit", async () => {
    // Simulamos respuesta con limit=20 pero trae solo 3 ítems porque el filtro en memoria descartó lotes
    // Aunque meta.total diga 100, no hay más en esta página.
    vi.spyOn(stockApi, "listarLotes").mockResolvedValueOnce({
      items: MOCK_LOTES.slice(0, 3), // 3 ítems devueltos < limit (20)
      meta: { page: 1, limit: 20, total: 100 }, // meta.total mentiroso por bug §4.3
    });

    render(
      <MemoryRouter>
        <LotesPage conExistenciaInicial="true" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("LOT-2026-001")).toBeInTheDocument();

    // El botón 'Siguiente' debe estar deshabilitado porque items.length (3) < limit (20)
    const botonSiguiente = screen.getByRole("button", { name: /siguiente/i });
    expect(botonSiguiente).toBeDisabled();

    // Y no debe renderizar números de página basados en 100
    expect(screen.queryByText("Página 1 de 5")).not.toBeInTheDocument();
  });

  it("muestra estado de carga", () => {
    vi.spyOn(stockApi, "listarLotes").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <LotesPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("lotes-loading").length).toBeGreaterThan(0);
  });

  it("muestra estado de error", async () => {
    vi.spyOn(stockApi, "listarLotes").mockRejectedValue(new Error("Fallo en servidor"));

    render(
      <MemoryRouter>
        <LotesPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Fallo en servidor/i);
  });

  it("muestra estado vacío", async () => {
    vi.spyOn(stockApi, "listarLotes").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });

    render(
      <MemoryRouter>
        <LotesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No se encontraron lotes/i)).toBeInTheDocument();
  });
});
