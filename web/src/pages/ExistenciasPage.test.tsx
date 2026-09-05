import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ExistenciasPage } from "./ExistenciasPage.tsx";
import * as stockApi from "../api/comercial/stock.ts";
import type { ExistenciaFila, ValorizacionStock } from "../types/index.ts";

const MOCK_VALORIZACION: ValorizacionStock = {
  totalValorizado: 154200.5,
  productos: [
    {
      producto: { id: "prod-1", codigo: "MED-001", nombre: "Amoxicilina 500mg" },
      cantidadTotal: 150,
      valorTotal: 75000,
    },
    {
      producto: { id: "prod-2", codigo: "MED-002", nombre: "Ibuprofeno Gotas" },
      cantidadTotal: 80,
      valorTotal: 79200.5,
    },
  ],
};

const MOCK_FILAS_EXISTENCIAS: ExistenciaFila[] = [
  // 3 filas del mismo producto con distintos lotes (bug §4.1)
  {
    productoId: "prod-1",
    cantidad: 50,
    producto: {
      id: "prod-1",
      codigo: "MED-001",
      nombre: "Amoxicilina 500mg",
      unidad_medida: { id: "uni-1", codigo: "COMP", nombre: "Comprimido" },
    },
  },
  {
    productoId: "prod-1",
    cantidad: 30,
    producto: {
      id: "prod-1",
      codigo: "MED-001",
      nombre: "Amoxicilina 500mg",
      unidad_medida: { id: "uni-1", codigo: "COMP", nombre: "Comprimido" },
    },
  },
  {
    productoId: "prod-1",
    cantidad: 70,
    producto: {
      id: "prod-1",
      codigo: "MED-001",
      nombre: "Amoxicilina 500mg",
      unidad_medida: { id: "uni-1", codigo: "COMP", nombre: "Comprimido" },
    },
  },
  // Otro producto
  {
    productoId: "prod-2",
    cantidad: 80,
    producto: {
      id: "prod-2",
      codigo: "MED-002",
      nombre: "Ibuprofeno Gotas",
      unidad_medida: { id: "uni-2", codigo: "FCO", nombre: "Frasco" },
    },
  },
];

describe("ExistenciasPage (F2·T1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(stockApi, "valorizacion").mockResolvedValue(MOCK_VALORIZACION);
    vi.spyOn(stockApi, "listarExistencias").mockResolvedValue({
      items: MOCK_FILAS_EXISTENCIAS,
      meta: { page: 1, limit: 100, total: 4 },
    });
  });

  it("§4.1: tres filas del mismo productoId se muestran como UNA con la cantidad sumada", async () => {
    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    // Debe mostrar encabezado y tarjeta de valorización
    expect(await screen.findByText("Existencias de Stock")).toBeInTheDocument();
    expect(screen.getByText(/\$?\s*154\.200,50/)).toBeInTheDocument();

    // Amoxicilina solo aparece una vez como fila en la tabla
    const amoxiRows = screen.getAllByText("Amoxicilina 500mg");
    expect(amoxiRows).toHaveLength(1);

    // La cantidad total debe ser la suma de 50 + 30 + 70 = 150
    expect(screen.getByText("150")).toBeInTheDocument();
    // Debe indicar 3 lotes
    expect(screen.getByText("3 lotes")).toBeInTheDocument();
  });

  it("§4.2: el total de meta no se usa para paginar (con meta.total: 30 y 10 productos distintos, el paginador dice 10, no 30)", async () => {
    // 30 filas que corresponden a 10 productos únicos (3 lotes cada uno)
    const filasMultiples: ExistenciaFila[] = [];
    for (let i = 1; i <= 10; i++) {
      for (let j = 1; j <= 3; j++) {
        filasMultiples.push({
          productoId: `prod-${i}`,
          cantidad: 10,
          producto: {
            id: `prod-${i}`,
            codigo: `COD-${i}`,
            nombre: `Producto ${i}`,
            unidad_medida: { id: "u-1", codigo: "U", nombre: "Unidad" },
          },
        });
      }
    }

    vi.spyOn(stockApi, "listarExistencias").mockResolvedValueOnce({
      items: filasMultiples,
      meta: { page: 1, limit: 100, total: 30 }, // meta.total es 30 por lotes
    });

    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    // El contador de productos debe decir 10 productos, nunca 30
    expect(await screen.findByText(/10 productos/i)).toBeInTheDocument();
    expect(screen.queryByText(/30 productos/i)).not.toBeInTheDocument();
  });

  it("muestra estado de carga mientras obtiene existencias", () => {
    vi.spyOn(stockApi, "listarExistencias").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("existencias-loading").length).toBeGreaterThan(0);
  });

  it("muestra estado de error cuando la API falla", async () => {
    vi.spyOn(stockApi, "listarExistencias").mockRejectedValue(new Error("Error de conexión"));

    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Error de conexión/i);
  });

  it("muestra estado vacío cuando no hay existencias", async () => {
    vi.spyOn(stockApi, "listarExistencias").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 100, total: 0 },
    });

    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No hay existencias registradas/i)).toBeInTheDocument();
  });

  it("con N productos, la cantidad de fetch es constante", async () => {
    const spy = vi.spyOn(stockApi, "listarExistencias");

    render(
      <MemoryRouter>
        <ExistenciasPage />
      </MemoryRouter>,
    );

    await screen.findByText("Amoxicilina 500mg");

    // Solo pide existencias (1 sola vez con limit 100 para la página) y valorización (1 sola vez)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
