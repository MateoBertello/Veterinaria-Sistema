import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type ModuloContratado } from "../../types/index.ts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ModulosPanel } from "./ModulosPanel.tsx";
import { toast } from "sonner";

const MODULOS: ModuloContratado[] = [
  { modulo: "historial_clinico", habilitado: true,  fechaAlta: "2026-06-09" },
  { modulo: "turnos",            habilitado: false, fechaAlta: null },
  { modulo: "guarderia",         habilitado: false, fechaAlta: null },
];

const listarModulos = vi.fn();
const setModulo = vi.fn();

function renderPanel() {
  return render(
    <ModulosPanel tenantId="t-1" listarModulos={listarModulos} setModulo={setModulo} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarModulos.mockResolvedValue(MODULOS);
});

describe("ModulosPanel", () => {
  it("muestra un switch por módulo con su estado actual", async () => {
    renderPanel();

    expect(await screen.findByText(/HC · Historial Clínico/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Historial Clínico: habilitado/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /Turnos: deshabilitado/i })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /Guardería: deshabilitado/i })).not.toBeChecked();
  });

  it("habilitar aplica directo (sin confirmación) con PUT habilitado=true", async () => {
    setModulo.mockResolvedValue({ modulo: "guarderia", habilitado: true, fechaAlta: "2026-07-25" });

    renderPanel();
    await screen.findByText(/GU · Guardería/);

    await userEvent.click(screen.getByRole("switch", { name: /Guardería: deshabilitado/i }));

    await waitFor(() => expect(setModulo).toHaveBeenCalledWith("t-1", "guarderia", true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: /Guardería: habilitado/i })).toBeChecked();
  });

  it("deshabilitar pide confirmación advirtiendo que los datos se conservan (RN-SM2)", async () => {
    setModulo.mockResolvedValue({
      modulo: "historial_clinico",
      habilitado: false,
      fechaAlta: "2026-06-09",
    });

    renderPanel();
    await screen.findByText(/HC · Historial Clínico/);

    await userEvent.click(screen.getByRole("switch", { name: /Historial Clínico: habilitado/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Los datos se conservan/i)).toBeInTheDocument();
    expect(setModulo).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Deshabilitar" }));

    await waitFor(() => expect(setModulo).toHaveBeenCalledWith("t-1", "historial_clinico", false));
    expect(
      await screen.findByRole("switch", { name: /Historial Clínico: deshabilitado/i }),
    ).not.toBeChecked();
  });

  it("cancelar la confirmación deja el módulo como estaba", async () => {
    renderPanel();
    await screen.findByText(/HC · Historial Clínico/);

    await userEvent.click(screen.getByRole("switch", { name: /Historial Clínico: habilitado/i }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(setModulo).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: /Historial Clínico: habilitado/i })).toBeChecked();
  });

  it("si el backend rechaza el toggle, el switch no cambia y se informa el error", async () => {
    setModulo.mockRejectedValue(new ApiError("MODULE_UNKNOWN", 422, "Módulo desconocido"));

    renderPanel();
    await screen.findByText(/TU · Turnos/);

    await userEvent.click(screen.getByRole("switch", { name: /Turnos: deshabilitado/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Módulo desconocido"));
    expect(screen.getByRole("switch", { name: /Turnos: deshabilitado/i })).not.toBeChecked();
  });

  it("error al cargar: mensaje del envelope y reintento", async () => {
    listarModulos.mockRejectedValueOnce(new ApiError("TENANT_NOT_FOUND", 404, "Tenant no encontrado"));

    renderPanel();

    expect(await screen.findByText("Tenant no encontrado")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText(/HC · Historial Clínico/)).toBeInTheDocument();
  });

  it("estado vacío cuando el tenant no tiene módulos aprovisionados", async () => {
    listarModulos.mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText(/todavía no tiene módulos aprovisionados/i)).toBeInTheDocument();
  });
});
