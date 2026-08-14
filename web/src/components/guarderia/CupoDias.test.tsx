import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type CupoDia } from "../../types/index.ts";

vi.mock("../../api/estadias.ts", () => ({
  obtenerCupo: vi.fn(),
}));

import { CupoDias } from "./CupoDias.tsx";
import { obtenerCupo } from "../../api/estadias.ts";

const mockCupo = vi.mocked(obtenerCupo);

function makeCupoDia(over: Partial<CupoDia> = {}): CupoDia {
  return { date: "2026-07-10", ocupados: 2, cupo: 5, disponible: 3, ...over };
}

beforeEach(() => vi.clearAllMocks());

describe("CupoDias", () => {
  it("sin fechas no fetchea y muestra el placeholder", () => {
    render(<CupoDias checkInDate="" checkOutDate="" />);
    expect(screen.getByText(/Elegí las fechas/)).toBeInTheDocument();
    expect(mockCupo).not.toHaveBeenCalled();
  });

  it("con fechas válidas fetchea el rango y pinta un chip por día", async () => {
    mockCupo.mockResolvedValue([
      makeCupoDia({ date: "2026-07-10", disponible: 3 }),
      makeCupoDia({ date: "2026-07-11", disponible: 0, ocupados: 5, cupo: 5 }),
    ]);

    render(<CupoDias checkInDate="2026-07-10" checkOutDate="2026-07-11" />);

    await waitFor(() =>
      expect(mockCupo).toHaveBeenCalledWith({ dateFrom: "2026-07-10", dateTo: "2026-07-11" }),
    );
    expect(await screen.findByText("10/07")).toBeInTheDocument();
    expect(screen.getByText("11/07")).toBeInTheDocument();
  });

  it("día lleno se muestra en rojo con aria-label de sin cupo", async () => {
    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-10", disponible: 0, ocupados: 5, cupo: 5 })]);

    render(<CupoDias checkInDate="2026-07-10" checkOutDate="2026-07-10" />);

    const chip = await screen.findByLabelText(/sin cupo disponible/);
    expect(chip).toHaveClass("bg-red-100");
  });

  it("día disponible se muestra en verde", async () => {
    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-10", disponible: 3 })]);

    render(<CupoDias checkInDate="2026-07-10" checkOutDate="2026-07-10" />);

    const chip = await screen.findByLabelText(/lugares? disponible/);
    expect(chip).toHaveClass("bg-green-100");
  });

  it("error de red muestra mensaje y botón reintentar", async () => {
    mockCupo.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Boom cupo"));
    render(<CupoDias checkInDate="2026-07-10" checkOutDate="2026-07-10" />);
    expect(await screen.findByText("Boom cupo")).toBeInTheDocument();

    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-10", disponible: 3 })]);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(mockCupo).toHaveBeenCalledTimes(2));
  });

  it("diasAgotadosForzados fuerza rojo aunque el mock diga disponible", async () => {
    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-10", disponible: 3 })]);

    render(
      <CupoDias
        checkInDate="2026-07-10"
        checkOutDate="2026-07-10"
        diasAgotadosForzados={["2026-07-10"]}
      />,
    );

    const chip = await screen.findByLabelText(/sin cupo disponible/);
    expect(chip).toHaveClass("bg-red-100");
  });

  it("cambiar las fechas vuelve a fetchear con el nuevo rango", async () => {
    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-10", disponible: 3 })]);
    const { rerender } = render(<CupoDias checkInDate="2026-07-10" checkOutDate="2026-07-10" />);
    await waitFor(() => expect(mockCupo).toHaveBeenCalledTimes(1));

    mockCupo.mockResolvedValue([makeCupoDia({ date: "2026-07-12", disponible: 1 })]);
    rerender(<CupoDias checkInDate="2026-07-12" checkOutDate="2026-07-12" />);

    await waitFor(() =>
      expect(mockCupo).toHaveBeenCalledWith({ dateFrom: "2026-07-12", dateTo: "2026-07-12" }),
    );
  });
});
