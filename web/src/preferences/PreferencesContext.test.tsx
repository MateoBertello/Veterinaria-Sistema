import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// La provider lee el usuario actual: mockeamos useAuth con un usuario mutable
// para poder simular cambios de sesión (prefs keyeadas por id de usuario).
let mockUser: { id: string } | null = { id: "u1" };
vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => ({ status: "authenticated", user: mockUser, login: vi.fn(), logout: vi.fn() }),
}));

import { PreferencesProvider, usePreferences } from "./PreferencesContext.tsx";

function Consumer() {
  const { prefs, setPref, reset } = usePreferences();
  return (
    <div>
      <span data-testid="prefs">{JSON.stringify(prefs)}</span>
      <button onClick={() => setPref("fontSize", "lg")}>fuente-grande</button>
      <button onClick={() => setPref("density", "compact")}>densidad-compacta</button>
      <button onClick={() => setPref("tableViewMode", "expanded")}>tabla-expandida</button>
      <button onClick={() => setPref("cardSpacing", "relaxed")}>tarjetas-relajadas</button>
      <button onClick={() => setPref("highContrast", true)}>alto-contraste</button>
      <button onClick={() => setPref("reducedMotion", true)}>reducir-movimiento</button>
      <button onClick={reset}>restablecer</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <PreferencesProvider>
      <Consumer />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  mockUser = { id: "u1" };
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("--font-size");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreferencesContext", () => {
  it("RN-UX3: aplica una preferencia al <html> raíz y la persiste por usuario", async () => {
    renderProvider();

    await userEvent.click(screen.getByText("fuente-grande"));
    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("18px");

    await userEvent.click(screen.getByText("densidad-compacta"));
    expect(document.documentElement.classList.contains("density-compact")).toBe(true);

    await userEvent.click(screen.getByText("tabla-expandida"));
    expect(document.documentElement.classList.contains("table-expanded")).toBe(true);
    expect(document.documentElement.classList.contains("table-comfortable")).toBe(false);

    await userEvent.click(screen.getByText("tarjetas-relajadas"));
    expect(document.documentElement.classList.contains("card-relaxed")).toBe(true);
    expect(document.documentElement.classList.contains("card-normal")).toBe(false);

    await userEvent.click(screen.getByText("alto-contraste"));
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);

    await userEvent.click(screen.getByText("reducir-movimiento"));
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);

    // Persistencia por usuario: la clave incluye el id.
    const stored = JSON.parse(localStorage.getItem("leo:prefs:u1")!);
    expect(stored).toMatchObject({
      fontSize: "lg", density: "compact", tableViewMode: "expanded", cardSpacing: "relaxed",
      highContrast: true, reducedMotion: true,
    });
  });

  it("RN-UX3: rehidrata las preferencias guardadas del usuario al montar", async () => {
    localStorage.setItem(
      "leo:prefs:u1",
      JSON.stringify({
        fontSize: "xl", density: "compact", tableViewMode: "compact", cardSpacing: "tight",
        highContrast: true, reducedMotion: false,
      }),
    );
    renderProvider();

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("20px"),
    );
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.classList.contains("density-compact")).toBe(true);
    expect(document.documentElement.classList.contains("table-compact")).toBe(true);
    expect(document.documentElement.classList.contains("card-tight")).toBe(true);
  });

  it("RN-UX3: sanea tableViewMode y cardSpacing inválidos cayendo a los valores por defecto", async () => {
    localStorage.setItem(
      "leo:prefs:u1",
      JSON.stringify({ tableViewMode: "gigante", cardSpacing: 42 }),
    );
    renderProvider();

    await waitFor(() =>
      expect(document.documentElement.classList.contains("table-comfortable")).toBe(true),
    );
    expect(document.documentElement.classList.contains("card-normal")).toBe(true);
    const prefs = JSON.parse(screen.getByTestId("prefs").textContent!);
    expect(prefs.tableViewMode).toBe("comfortable");
    expect(prefs.cardSpacing).toBe("normal");
  });

  it("RN-UX3: cada usuario tiene su propio set (recarga al cambiar de sesión)", async () => {
    localStorage.setItem("leo:prefs:u1", JSON.stringify({ fontSize: "sm" }));
    localStorage.setItem("leo:prefs:u2", JSON.stringify({ fontSize: "xl" }));

    const { rerender } = renderProvider();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("14px"),
    );

    // Cambia el usuario logueado → se recargan sus preferencias.
    mockUser = { id: "u2" };
    rerender(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("20px"),
    );
  });

  it("RN-UX3: por defecto respeta la reducción de movimiento del sistema operativo", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    renderProvider();

    await waitFor(() =>
      expect(document.documentElement.classList.contains("reduce-motion")).toBe(true),
    );
  });

  it("restablecer vuelve a los valores por defecto", async () => {
    renderProvider();
    await userEvent.click(screen.getByText("fuente-grande"));
    await userEvent.click(screen.getByText("tabla-expandida"));
    await userEvent.click(screen.getByText("tarjetas-relajadas"));
    await userEvent.click(screen.getByText("restablecer"));

    expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px");
    expect(document.documentElement.classList.contains("table-comfortable")).toBe(true);
    expect(document.documentElement.classList.contains("card-normal")).toBe(true);
    const prefs = JSON.parse(screen.getByTestId("prefs").textContent!);
    expect(prefs.fontSize).toBe("md");
    expect(prefs.tableViewMode).toBe("comfortable");
    expect(prefs.cardSpacing).toBe("normal");
  });

  it("tolera JSON corrupto en localStorage y cae a los valores por defecto", async () => {
    localStorage.setItem("leo:prefs:u1", "{ no-es-json");
    renderProvider();

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--font-size")).toBe("16px"),
    );
  });
});
