import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockAuth = {
  status: "loading" as "loading" | "authenticated" | "anonymous",
  user: null,
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
};

vi.mock("./AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

import { ProtectedRoute } from "./ProtectedRoute.tsx";

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/clientes"]}>
      <Routes>
        <Route path="/login" element={<p>Pantalla de login</p>} />
        <Route
          path="/clientes"
          element={
            <ProtectedRoute>
              <p>Contenido protegido</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.status = "loading";
});

describe("ProtectedRoute", () => {
  it("muestra estado de carga mientras rehidrata", () => {
    mockAuth.status = "loading";
    renderApp();
    expect(screen.getByText("Cargando sesión…")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
  });

  it("redirige a /login cuando no hay sesión", () => {
    mockAuth.status = "anonymous";
    renderApp();
    expect(screen.getByText("Pantalla de login")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
  });

  it("renderiza el contenido cuando hay sesión válida", () => {
    mockAuth.status = "authenticated";
    renderApp();
    expect(screen.getByText("Contenido protegido")).toBeInTheDocument();
  });
});
