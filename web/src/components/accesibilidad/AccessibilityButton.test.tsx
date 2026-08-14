import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

vi.mock("../../auth/AuthContext.tsx", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "u1" }, login: vi.fn(), logout: vi.fn() }),
}));

import { AccessibilityButton } from "./AccessibilityButton.tsx";
import { PreferencesProvider } from "../../preferences/PreferencesContext.tsx";

function renderButton() {
  return render(
    <PreferencesProvider>
      <AccessibilityButton />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("--font-size");
});

describe("AccessibilityButton (RN-UX3)", () => {
  it("el botón flotante es accesible y el panel arranca cerrado", () => {
    renderButton();

    expect(
      screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre el panel con rol de diálogo y foco atrapado (foco inicial dentro del panel)", async () => {
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }));

    const dialog = await screen.findByRole("dialog", { name: /Accesibilidad y personalización/i });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("expone los controles de las seis preferencias", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }));
    await screen.findByRole("dialog");

    expect(screen.getByRole("radiogroup", { name: /Tamaño de fuente/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /Densidad de tablas/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /Vista de tablas/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /Espaciado de tarjetas/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Alto contraste/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Reducción de movimiento/i })).toBeInTheDocument();
  });

  it("RN-UX3/RN-UX2: cambiar una preferencia la aplica al root, la persiste y avisa por toast", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("radio", { name: "Expandida" }));

    expect(document.documentElement.classList.contains("table-expanded")).toBe(true);
    expect(JSON.parse(localStorage.getItem("leo:prefs:u1")!).tableViewMode).toBe("expanded");
    expect(toastSuccess).toHaveBeenCalledWith("Preferencias guardadas");
  });

  it("restablecer vuelve los controles a los valores por defecto y avisa por toast", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }));
    await screen.findByRole("dialog");

    const fontSizeGroup = screen.getByRole("radiogroup", { name: /Tamaño de fuente/i });
    await userEvent.click(within(fontSizeGroup).getByRole("radio", { name: "Grande" }));
    await userEvent.click(screen.getByRole("button", { name: /Restablecer valores por defecto/i }));

    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px");
    expect(within(fontSizeGroup).getByRole("radio", { name: "Normal" })).toBeChecked();
    expect(toastSuccess).toHaveBeenCalledWith("Preferencias restablecidas");
  });

  it("se cierra con la tecla Escape", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: /Abrir panel de accesibilidad/i }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
