import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoteDetallePage } from "./LoteDetallePage.tsx";
import * as stockApi from "../api/comercial/stock.ts";
import type { KardexMovimiento, Lote, TrazabilidadNodo } from "../types/index.ts";

const MOCK_LOTE: Lote = {
  id: "lote-123",
  codigoLote: "LOT-2026-X",
  fechaVencimiento: "2026-10-31",
  fechaIngreso: "2026-01-15",
  costoUnitarioNeto: 150,
  costoUnitarioEfectivo: 181.5,
  estado: "disponible",
  origen: "compra",
  producto: { id: "prod-1", codigo: "MED-001", nombre: "Amoxicilina 500mg" },
  proveedor: { id: "prov-1", razonSocial: "Droguería Central" },
  cantidad: 45,
};

const MOCK_KARDEX: KardexMovimiento[] = [
  {
    id: "mov-1",
    fecha: "2026-01-15T10:00:00Z",
    tipo: "entrada_compra",
    cantidad: 50,
    cantidadConSigno: 50,
    costoUnitario: 150,
    costoTotal: 7500,
    motivo: "OP-10023",
    saldoAcumulado: 50,
  },
  {
    id: "mov-2",
    fecha: "2026-01-20T14:30:00Z",
    tipo: "salida_venta",
    cantidad: 5,
    cantidadConSigno: -5,
    costoUnitario: 150,
    costoTotal: 750,
    motivo: "OP-10045",
    saldoAcumulado: 45,
  },
];

const MOCK_TRAZABILIDAD: TrazabilidadNodo[] = [
  {
    loteId: "lote-parent",
    productoId: "prod-origen",
    productoNombre: "Amoxicilina Suspensión 100ml",
    codigoLote: "PADRE-01",
    fechaVencimiento: "2026-12-31",
    costoUnitarioEfectivo: 500,
    nivel: -1,
    direccion: "origen",
  },
  {
    loteId: "lote-123",
    productoId: "prod-1",
    productoNombre: "Amoxicilina Fraccionada 10ml",
    codigoLote: "LOT-2026-X",
    fechaVencimiento: "2026-10-31",
    costoUnitarioEfectivo: 181.5,
    nivel: 0,
    direccion: "actual",
  },
  {
    loteId: "lote-child",
    productoId: "prod-sub",
    productoNombre: "Dosis Individual 5ml",
    codigoLote: "HIJO-01",
    fechaVencimiento: "2026-10-31",
    costoUnitarioEfectivo: 90.75,
    nivel: 1,
    direccion: "destino",
  },
];

describe("LoteDetallePage (F2·T1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(stockApi, "obtenerLote").mockResolvedValue(MOCK_LOTE);
    vi.spyOn(stockApi, "kardex").mockResolvedValue({
      items: MOCK_KARDEX,
      meta: { page: 1, limit: 20, total: 2 },
    });
    vi.spyOn(stockApi, "trazabilidad").mockResolvedValue(MOCK_TRAZABILIDAD);
  });

  const renderComponent = (loteId = "lote-123") => {
    return render(
      <MemoryRouter initialEntries={[`/stock/lotes/${loteId}`]}>
        <Routes>
          <Route path="/stock/lotes/:id" element={<LoteDetallePage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("los tres bloques cargan y muestran su información", async () => {
    renderComponent();

    // Bloque 1: Ficha
    await screen.findByRole("heading", { level: 1, name: /Detalle de Lote/i });
    expect(screen.getAllByText(/LOT-2026-X/).length).toBeGreaterThan(0);
    expect(screen.getByText("Amoxicilina 500mg")).toBeInTheDocument();
    expect(screen.getByText("Droguería Central")).toBeInTheDocument();
    expect(screen.getAllByText(/\$?\s*181,50/).length).toBeGreaterThanOrEqual(1);

    // Bloque 2: Kardex
    expect(screen.getByText("Kardex de Movimientos")).toBeInTheDocument();
    expect(screen.getByText("+50")).toBeInTheDocument();
    expect(screen.getByText("-5")).toBeInTheDocument();

    // Bloque 3: Trazabilidad
    expect(screen.getByText("Cadena de Trazabilidad")).toBeInTheDocument();
    expect(screen.getByText("PADRE-01")).toBeInTheDocument();
    expect(screen.getByText("HIJO-01")).toBeInTheDocument();
  });

  it("§2.6: el kardex dice 'Operación N°' y en ninguna parte 'Comprobante' ni 'Factura'", async () => {
    renderComponent();

    await screen.findByRole("heading", { level: 1, name: /Detalle de Lote/i });

    // Debe contener el encabezado 'Operación N°' o 'Ref. / Operación N°'
    expect(await screen.findByText(/Operación N°/i)).toBeInTheDocument();

    // Prohibido 'Comprobante' o 'Factura'
    expect(screen.queryByText(/Comprobante/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Factura/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ticket/i)).not.toBeInTheDocument();
  });

  it("la trazabilidad sin padre ni hijos muestra el estado vacío, no un árbol roto", async () => {
    // Solo el nodo actual o lista vacía
    vi.spyOn(stockApi, "trazabilidad").mockResolvedValueOnce([
      {
        loteId: "lote-123",
        productoId: "prod-1",
        productoNombre: "Amoxicilina Fraccionada 10ml",
        codigoLote: "LOT-2026-X",
        fechaVencimiento: "2026-10-31",
        costoUnitarioEfectivo: 181.5,
        nivel: 0,
        direccion: "actual",
      },
    ]);

    renderComponent();

    await screen.findByRole("heading", { level: 1, name: /Detalle de Lote/i });

    expect(
      await screen.findByText(/Este lote no tiene fraccionamientos vinculados/i),
    ).toBeInTheDocument();
  });

  it("muestra estado de error si la carga del lote falla", async () => {
    vi.spyOn(stockApi, "obtenerLote").mockRejectedValue(new Error("Lote no encontrado"));

    renderComponent();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Lote no encontrado/i);
  });
});
