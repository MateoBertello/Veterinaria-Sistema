import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { VencimientosPage } from "./VencimientosPage.tsx";
import * as stockApi from "../api/comercial/stock.ts";
import { hoyISO, sumarDias } from "../lib/fechas.ts";
import type { Lote } from "../types/index.ts";

describe("VencimientosPage (F2·T2)", () => {
  const hoy = hoyISO();
  const ayer = sumarDias(hoy, -1);
  const en3Dias = sumarDias(hoy, 3);
  const en45Dias = sumarDias(hoy, 45);

  const MOCK_LOTES_VENCIMIENTOS: Lote[] = [
    {
      id: "lote-vencido",
      codigoLote: "LOT-VENCIDO",
      fechaVencimiento: ayer,
      fechaIngreso: "2025-01-01",
      costoUnitarioNeto: 100,
      costoUnitarioEfectivo: 121,
      estado: "vencido",
      origen: "compra",
      producto: { id: "prod-1", codigo: "MED-001", nombre: "Amoxicilina 500mg" },
      proveedor: { id: "prov-1", razonSocial: "Droguería Sur" },
      cantidad: 10,
    },
    {
      id: "lote-semana",
      codigoLote: "LOT-SEMANA",
      fechaVencimiento: en3Dias,
      fechaIngreso: "2025-06-01",
      costoUnitarioNeto: 150,
      costoUnitarioEfectivo: 181.5,
      estado: "disponible",
      origen: "compra",
      producto: { id: "prod-2", codigo: "MED-002", nombre: "Ibuprofeno Gotas" },
      proveedor: { id: "prov-2", razonSocial: "Laboratorios Vet" },
      cantidad: 25,
    },
    {
      id: "lote-rango",
      codigoLote: "LOT-RANGO",
      fechaVencimiento: en45Dias,
      fechaIngreso: "2025-09-01",
      costoUnitarioNeto: 200,
      costoUnitarioEfectivo: 242,
      estado: "disponible",
      origen: "compra",
      producto: { id: "prod-3", codigo: "MED-003", nombre: "Cefalexina 250mg" },
      proveedor: null,
      cantidad: 40,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(stockApi, "listarLotes").mockResolvedValue({
      items: MOCK_LOTES_VENCIMIENTOS,
      meta: { page: 1, limit: 100, total: 3 },
    });
  });

  it("los tres grupos se arman bien y los días restantes de un lote vencido son negativos", async () => {
    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Vencimientos Próximos")).toBeInTheDocument();

    // Verificamos los 3 encabezados de grupos
    expect(screen.getByText(/Vencidos/i)).toBeInTheDocument();
    expect(screen.getByText(/Vencen esta semana/i)).toBeInTheDocument();
    expect(screen.getByText(/Vencen en el rango/i)).toBeInTheDocument();

    // Lote vencido va al grupo de vencidos y muestra días negativos
    expect(screen.getByText("LOT-VENCIDO")).toBeInTheDocument();
    expect(screen.getByText(/-1\s*días?/i)).toBeInTheDocument();

    // Lote de 3 días va a 'Esta semana'
    expect(screen.getByText("LOT-SEMANA")).toBeInTheDocument();
    expect(screen.getByText(/3\s*días?/i)).toBeInTheDocument();

    // Lote de 45 días va al tercer grupo
    expect(screen.getByText("LOT-RANGO")).toBeInTheDocument();
    expect(screen.getByText(/45\s*días?/i)).toBeInTheDocument();
  });

  it("§4.5: el selector de rango existe y arranca en 60", async () => {
    const spy = vi.spyOn(stockApi, "listarLotes");

    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    await screen.findByText("Vencimientos Próximos");

    // Por defecto arranca en 60 días
    const fechaEsperada60 = sumarDias(hoy, 60);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        venceAntesDe: fechaEsperada60,
        conExistencia: "true",
      }),
    );
  });

  it("cambiar el rango a 30 dispara un fetch nuevo con el venceAntesDe recalculado", async () => {
    const spy = vi.spyOn(stockApi, "listarLotes");
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    await screen.findByText("Vencimientos Próximos");

    // Buscamos el selector de rango
    const selectTrigger = screen.getByRole("combobox", { name: /rango de alerta|días/i });
    await user.click(selectTrigger);

    const opcion30 = await screen.findByRole("option", { name: /30 días/i });
    await user.click(opcion30);

    const fechaEsperada30 = sumarDias(hoy, 30);
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          venceAntesDe: fechaEsperada30,
          conExistencia: "true",
        }),
      );
    });
  });

  it("§4.3: la paginación no usa meta.total — con meta.total: 100 y respuesta < limit, no intenta pedir más páginas", async () => {
    const spy = vi.spyOn(stockApi, "listarLotes").mockResolvedValueOnce({
      items: MOCK_LOTES_VENCIMIENTOS, // 3 ítems devueltos < limit (100)
      meta: { page: 1, limit: 100, total: 100 }, // meta.total engañoso
    });

    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    await screen.findByText("Vencimientos Próximos");

    // Como devolvió 3 (< limit 100), se detuvo la paginación y solo llamó 1 vez
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("muestra estado vacío con el copy propio", async () => {
    vi.spyOn(stockApi, "listarLotes").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 100, total: 0 },
    });

    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/No hay lotes que venzan en los próximos 60 días\./i),
    ).toBeInTheDocument();
  });

  it("ningún request lleva tenantId", async () => {
    const spy = vi.spyOn(stockApi, "listarLotes");

    render(
      <MemoryRouter>
        <VencimientosPage />
      </MemoryRouter>,
    );

    await screen.findByText("Vencimientos Próximos");

    for (const call of spy.mock.calls) {
      expect(call[0]).not.toHaveProperty("tenantId");
      expect(call[0]).not.toHaveProperty("tenant_id");
    }
  });
});
