import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthUser, ModuloContratado } from "./types/index.ts";

// El shell consume auth y módulos habilitados vía hooks/fetch; se mockean para
// controlar qué ítems debería listar la navegación (RN-G2 + permisos).
const mockAuth = {
  status: "authenticated" as const,
  user: null as AuthUser | null,
  login: () => Promise.resolve(),
  logout: vi.fn(() => Promise.resolve()),
};

vi.mock("./auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

// Ajena a la navegación: se stubea para no requerir PreferencesProvider en el árbol.
vi.mock("./components/accesibilidad/AccessibilityButton.tsx", () => ({
  AccessibilityButton: () => null,
}));

const fetchModulosHabilitadosMock = vi.fn<() => Promise<ModuloContratado[]>>();
vi.mock("./api/modulos.ts", () => ({
  fetchModulosHabilitados: () => fetchModulosHabilitadosMock(),
}));

import { Shell } from "./App.tsx";

function makeUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1", username: "ana", fullName: "Ana Pérez", roleName: "Administrador",
    permissions: [], ...over,
  };
}

function renderShell(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<p>Contenido de inicio</p>} />
          <Route path="/clientes" element={<p>Contenido de clientes</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.user = makeUser();
  fetchModulosHabilitadosMock.mockReset();
  fetchModulosHabilitadosMock.mockResolvedValue([]);
});

describe("navegación mobile del Shell (Etapa 10E)", () => {
  it("el botón hamburguesa tiene aria-label 'Abrir menú' y el Sheet arranca cerrado", async () => {
    renderShell();
    await waitFor(() => expect(fetchModulosHabilitadosMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("al hacer click en el hamburguesa, abre el Sheet con el menú de navegación", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Clientes" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Mascotas" })).toBeInTheDocument();
  });

  it("al navegar a un ítem del Sheet, cierra el menú y renderiza la ruta destino", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: "Clientes" }));

    expect(await screen.findByText("Contenido de clientes")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lista los ítems según los módulos habilitados y los permisos del usuario", async () => {
    mockAuth.user = makeUser({ permissions: ["manage_users"] });
    fetchModulosHabilitadosMock.mockResolvedValue([
      { modulo: "turnos", habilitado: true, fechaAlta: "2026-01-01" },
      { modulo: "guarderia", habilitado: false, fechaAlta: null },
    ]);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByRole("link", { name: "Turnos" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Doctores" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Guardería" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Auditoría" })).not.toBeInTheDocument();
  });
});
