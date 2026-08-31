import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthUser } from "../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user:   null as AuthUser | null,
  login:  () => Promise.resolve(),
  logout: () => Promise.resolve(),
};

vi.mock("./AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

import { RequirePermission } from "./RequirePermission.tsx";

function makeUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1", username: "ana", fullName: "Ana Pérez", roleName: "Administrador",
    permissions: [], ...over,
  };
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/auditoria"]}>
      <Routes>
        <Route path="/" element={<p>Inicio</p>} />
        <Route
          path="/auditoria"
          element={
            <RequirePermission permission="view_audit">
              <p>Contenido de auditoría</p>
            </RequirePermission>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.user = null;
});

describe("RequirePermission", () => {
  it("sin el permiso requerido, muestra la pantalla 'Sin acceso' en vez del contenido", () => {
    mockAuth.user = makeUser({ permissions: ["manage_users"] });
    renderApp();
    expect(screen.getByRole("heading", { name: "Sin acceso" })).toBeInTheDocument();
    expect(screen.queryByText("Contenido de auditoría")).not.toBeInTheDocument();
  });

  it("sin el permiso requerido, NO redirige: se queda en la ruta pedida", () => {
    mockAuth.user = makeUser({ permissions: ["manage_users"] });
    renderApp();
    // El redirect silencioso a "/" era indistinguible de un bug: la URL cambiaba
    // sola y nadie explicaba por qué. Ahora la ruta se mantiene y se explica.
    expect(screen.queryByText("Inicio")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toBeInTheDocument();
  });

  it("sin usuario (no debería ocurrir tras ProtectedRoute, pero por defecto no autoriza)", () => {
    mockAuth.user = null;
    renderApp();
    expect(screen.getByRole("heading", { name: "Sin acceso" })).toBeInTheDocument();
    expect(screen.queryByText("Contenido de auditoría")).not.toBeInTheDocument();
  });

  it("con el permiso requerido, renderiza el contenido", () => {
    mockAuth.user = makeUser({ permissions: ["view_audit"] });
    renderApp();
    expect(screen.getByText("Contenido de auditoría")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sin acceso" })).not.toBeInTheDocument();
  });
});
