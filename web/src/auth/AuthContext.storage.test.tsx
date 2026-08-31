import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "../types/index.ts";

/**
 * A diferencia de AuthContext.test.tsx, acá NO se mockea `../lib/session.ts`:
 * el objetivo es probar el mecanismo real (try/catch + respaldo en memoria)
 * contra un `localStorage` que lanza, no una versión simulada que nunca falla.
 */
vi.mock("../api/auth.ts", () => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
  logoutRequest: vi.fn(),
}));

import { AuthProvider, useAuth } from "./AuthContext.tsx";
import { login } from "../api/auth.ts";
import { getToken } from "../lib/session.ts";

const mockLogin = vi.mocked(login);

const USER: AuthUser = {
  id: "u1",
  username: "admin_demo",
  fullName: "Admin Demo",
  roleName: "Administrador",
  permissions: ["manage_clients"],
};

function Consumer() {
  const { status, login: doLogin } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <button onClick={() => void doLogin({ username: "admin_demo", password: "x" })}>
        login
      </button>
    </div>
  );
}

let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  setItemSpy?.mockRestore();
  localStorage.clear();
});

describe("AuthProvider — localStorage no disponible (Causa 2)", () => {
  it("el login completa igual aunque localStorage.setItem lance (Safari privado, storage bloqueado)", async () => {
    setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    mockLogin.mockResolvedValue({ token: "nuevo-jwt", refreshToken: "nuevo-refresh", user: USER });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));

    // Sin el try/catch en session.ts, esta excepción subía sin capturar desde
    // setSession() y el login nunca llegaba a "authenticated".
    await userEvent.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    // La sesión sigue viva en memoria durante la pestaña, aunque no haya
    // quedado persistida en localStorage.
    expect(getToken()).toBe("nuevo-jwt");
    expect(localStorage.getItem("sb-token")).toBeNull();
  });
});
