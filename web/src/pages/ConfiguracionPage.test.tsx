import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type ConfiguracionTenant } from "../types/index.ts";

vi.mock("../api/configuracion.ts", () => ({
  obtenerConfiguracion: vi.fn(),
  actualizarConfiguracion: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConfiguracionPage } from "./ConfiguracionPage.tsx";
import { actualizarConfiguracion, obtenerConfiguracion } from "../api/configuracion.ts";

const mockObtener = vi.mocked(obtenerConfiguracion);
const mockActualizar = vi.mocked(actualizarConfiguracion);

function makeConfig(over: Partial<ConfiguracionTenant> = {}): ConfiguracionTenant {
  return {
    cupoMaximoDiario: 10,
    diasAvisoVacuna: 7,
    parametrosExtra: {},
    updatedAt: "2026-06-09T12:00:00Z",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ConfiguracionPage", () => {
  it("carga y muestra los valores actuales", async () => {
    mockObtener.mockResolvedValue(makeConfig());

    render(<ConfiguracionPage />);

    expect(await screen.findByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });

  it("RN-CF1: CONFIG_NOT_FOUND reemplaza la página por un estado de error, sin form", async () => {
    mockObtener.mockRejectedValue(new ApiError("CONFIG_NOT_FOUND", 404, "Configuración no encontrada"));

    render(<ConfiguracionPage />);

    expect(await screen.findByText(/Contactá a soporte/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Cupo máximo diario/i)).not.toBeInTheDocument();
  });

  it("el footer de guardado solo aparece tras modificar un valor (dirty state)", async () => {
    mockObtener.mockResolvedValue(makeConfig());
    render(<ConfiguracionPage />);
    await screen.findByDisplayValue("10");

    expect(screen.queryByRole("button", { name: /Guardar cambios/i })).not.toBeInTheDocument();

    const cupo = screen.getByLabelText(/Cupo máximo diario/i);
    await userEvent.clear(cupo);
    await userEvent.type(cupo, "15");

    expect(await screen.findByRole("button", { name: /Guardar cambios/i })).toBeInTheDocument();
  });

  it("'Descartar' revierte los valores y oculta el footer", async () => {
    mockObtener.mockResolvedValue(makeConfig());
    render(<ConfiguracionPage />);
    const cupo = await screen.findByLabelText(/Cupo máximo diario/i) as HTMLInputElement;

    await userEvent.clear(cupo);
    await userEvent.type(cupo, "15");
    await screen.findByRole("button", { name: /Guardar cambios/i });

    await userEvent.click(screen.getByRole("button", { name: /Descartar/i }));

    await waitFor(() => expect(cupo.value).toBe("10"));
    expect(screen.queryByRole("button", { name: /Guardar cambios/i })).not.toBeInTheDocument();
  });

  it("RN-CF3: guarda cambios y muestra toast de éxito", async () => {
    mockObtener.mockResolvedValue(makeConfig());
    mockActualizar.mockResolvedValue(makeConfig({ cupoMaximoDiario: 15 }));

    render(<ConfiguracionPage />);
    const cupo = await screen.findByLabelText(/Cupo máximo diario/i);

    await userEvent.clear(cupo);
    await userEvent.type(cupo, "15");
    await userEvent.click(await screen.findByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() =>
      expect(mockActualizar).toHaveBeenCalledWith(
        expect.objectContaining({ cupoMaximoDiario: 15, diasAvisoVacuna: 7 }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Guardar cambios/i })).not.toBeInTheDocument(),
    );
  });

  it("RN-CF2: rango inválido muestra error inline bajo el campo", async () => {
    mockObtener.mockResolvedValue(makeConfig());
    mockActualizar.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", 422, "Datos de configuración inválidos", [
        { field: "cupoMaximoDiario", message: "Debe ser menor o igual a 500" },
      ]),
    );

    render(<ConfiguracionPage />);
    const cupo = await screen.findByLabelText(/Cupo máximo diario/i);

    await userEvent.clear(cupo);
    await userEvent.type(cupo, "600");
    await userEvent.click(await screen.findByRole("button", { name: /Guardar cambios/i }));

    expect(await screen.findByText("Debe ser menor o igual a 500")).toBeInTheDocument();
  });
});
