import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// La provider real se apoya en useAuth: proveemos un usuario fijo.
vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "u1" }, login: vi.fn(), logout: vi.fn() }),
}));

import { PreferenciasPage } from "./PreferenciasPage.tsx";
import { PreferencesProvider } from "../preferences/PreferencesContext.tsx";
import { toast } from "sonner";

function renderPage() {
  return render(
    <PreferencesProvider>
      <PreferenciasPage />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("--font-size");
});

describe("PreferenciasPage (RN-UX3)", () => {
  it("expone los cuatro ejes con controles accesibles (roles/labels)", () => {
    renderPage();

    // Grupos de radios con nombre accesible.
    expect(screen.getByRole("radiogroup", { name: /Tamaño de fuente/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /Densidad de tablas/i })).toBeInTheDocument();
    // Opciones etiquetadas.
    expect(screen.getByRole("radio", { name: "Normal" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Muy grande" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Compacta" })).toBeInTheDocument();
    // Switches etiquetados.
    expect(screen.getByRole("switch", { name: /Alto contraste/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Reducción de movimiento/i })).toBeInTheDocument();
  });

  it("RN-UX3: cambiar el tamaño de fuente lo aplica al root, persiste y avisa (RN-UX2)", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("radio", { name: "Grande" }));

    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("18px");
    expect(JSON.parse(localStorage.getItem("leo:prefs:u1")!).fontSize).toBe("lg");
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Preferencias guardadas");
  });

  it("RN-UX3: cambiar la densidad de tablas activa la clase compacta en el root", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("radio", { name: "Compacta" }));

    expect(document.documentElement.classList.contains("density-compact")).toBe(true);
    expect(JSON.parse(localStorage.getItem("leo:prefs:u1")!).density).toBe("compact");
  });

  it("RN-UX3: activar alto contraste aplica la clase high-contrast", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("switch", { name: /Alto contraste/i }));

    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(JSON.parse(localStorage.getItem("leo:prefs:u1")!).highContrast).toBe(true);
  });

  it("RN-UX3: activar reducción de movimiento aplica la clase reduce-motion", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("switch", { name: /Reducción de movimiento/i }));

    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
    expect(JSON.parse(localStorage.getItem("leo:prefs:u1")!).reducedMotion).toBe(true);
  });

  it("restablecer vuelve los controles a los valores por defecto", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("radio", { name: "Grande" }));
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("18px");

    await userEvent.click(screen.getByRole("button", { name: /Restablecer/i }));

    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px");
    expect(screen.getByRole("radio", { name: "Normal" })).toBeChecked();
  });
});
