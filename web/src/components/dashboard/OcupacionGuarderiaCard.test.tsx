/**
 * OcupacionGuarderiaCard — gráfico de ocupación de la semana.
 * Lo importante: una única consulta de rango (nunca una por día) y el texto
 * alternativo del gráfico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type CupoDia } from "../../types/index.ts";

vi.mock("../../api/estadias.ts", () => ({ obtenerCupo: vi.fn() }));

import { OcupacionGuarderiaCard } from "./OcupacionGuarderiaCard.tsx";
import { obtenerCupo } from "../../api/estadias.ts";

const mockCupo = vi.mocked(obtenerCupo);

function dia(date: string, ocupados: number, cupo = 10): CupoDia {
  return { date, ocupados, cupo, disponible: cupo - ocupados };
}

function renderCard(fecha = "2026-07-25") {
  return render(
    <MemoryRouter>
      <OcupacionGuarderiaCard fecha={fecha} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OcupacionGuarderiaCard", () => {
  it("pide los 7 días en UNA sola consulta de rango (sin un request por día)", async () => {
    mockCupo.mockResolvedValue([dia("2026-07-25", 3)]);

    renderCard();

    expect(await screen.findByRole("img", { name: /Ocupación de guardería por día/i })).toBeInTheDocument();
    expect(mockCupo).toHaveBeenCalledTimes(1);
    expect(mockCupo).toHaveBeenCalledWith({ dateFrom: "2026-07-25", dateTo: "2026-07-31" });
  });

  it("el gráfico describe ocupados sobre cupo como texto accesible", async () => {
    mockCupo.mockResolvedValue([dia("2026-07-25", 3), dia("2026-07-26", 10)]);

    renderCard();

    const grafico = await screen.findByRole("img", { name: /Ocupación de guardería/i });
    expect(grafico).toHaveAccessibleName(/3 de 10/);
    expect(grafico).toHaveAccessibleName(/10 de 10/);
  });

  it("avisa cuando la semana no tiene ninguna estadía reservada", async () => {
    mockCupo.mockResolvedValue([dia("2026-07-25", 0), dia("2026-07-26", 0)]);

    renderCard();

    expect(await screen.findByText(/Sin estadías reservadas/i)).toBeInTheDocument();
  });

  it("muestra el vacío cuando el backend no devuelve días", async () => {
    mockCupo.mockResolvedValue([]);

    renderCard();

    expect(await screen.findByText(/No hay datos de ocupación/i)).toBeInTheDocument();
  });

  it("muestra el error y conserva el acceso a la guardería", async () => {
    mockCupo.mockRejectedValue(new ApiError("INTERNAL_ERROR", 500, "Falló la ocupación"));

    renderCard();

    expect(await screen.findByText("Falló la ocupación")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver la guardería" })).toHaveAttribute("href", "/guarderia");
  });
});
