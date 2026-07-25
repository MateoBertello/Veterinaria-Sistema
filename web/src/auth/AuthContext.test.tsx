import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "../types/index.ts";

vi.mock("../api/auth.ts", () => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
  logoutRequest: vi.fn(),
}));

vi.mock("../lib/session.ts", () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { AuthProvider, useAuth } from "./AuthContext.tsx";
import { login, fetchMe, logoutRequest } from "../api/auth.ts";
import { getToken, setToken, clearToken } from "../lib/session.ts";

const mockLogin = vi.mocked(login);
const mockFetchMe = vi.mocked(fetchMe);
const mockLogoutRequest = vi.mocked(logoutRequest);
const mockGetToken = vi.mocked(getToken);
const mockSetToken = vi.mocked(setToken);
const mockClearToken = vi.mocked(clearToken);

const USER: AuthUser = {
  id: "u1",
  username: "admin_demo",
  fullName: "Admin Demo",
  roleName: "Administrador",
  permissions: ["manage_clients"],
};

/** JWT de mentira: el front solo lee claims; la firma la valida el backend. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.firma`;
}

function Consumer() {
  const { status, user, login: doLogin, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.fullName ?? "—"}</p>
      <button onClick={() => void doLogin({ username: "admin_demo", password: "x" })}>
        login
      </button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("sin token al bootear → anónimo", async () => {
    mockGetToken.mockReturnValue(null);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(mockFetchMe).not.toHaveBeenCalled();
  });

  it("con token al bootear → rehidrata con /auth/me y queda autenticado", async () => {
    mockGetToken.mockReturnValue("jwt");
    mockFetchMe.mockResolvedValue(USER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("Admin Demo");
  });

  it("token vencido al bootear (/auth/me falla) → limpia y queda anónimo", async () => {
    mockGetToken.mockReturnValue("jwt-vencido");
    mockFetchMe.mockRejectedValue(new Error("401"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(mockClearToken).toHaveBeenCalled();
  });

  it("token de PLATAFORMA al bootear → anónimo para el tenant, sin /auth/me y sin borrar el token", async () => {
    // El Super Admin no tiene tenant_id: /auth/me lo rechazaría y el handler de
    // 401 borraría un token que sí sirve para /admin/*.
    mockGetToken.mockReturnValue(makeJwt({
      sub: "sa-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { platform_role: "super_admin" },
    }));

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(mockFetchMe).not.toHaveBeenCalled();
    expect(mockClearToken).not.toHaveBeenCalled();
  });

  it("login guarda el token y deja la sesión activa", async () => {
    mockGetToken.mockReturnValue(null);
    mockLogin.mockResolvedValue({ token: "nuevo-jwt", user: USER });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );

    await userEvent.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    expect(mockSetToken).toHaveBeenCalledWith("nuevo-jwt");
    expect(screen.getByTestId("user")).toHaveTextContent("Admin Demo");
  });

  it("logout limpia el token aunque la llamada remota falle", async () => {
    mockGetToken.mockReturnValue("jwt");
    mockFetchMe.mockResolvedValue(USER);
    mockLogoutRequest.mockRejectedValue(new Error("network"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    await userEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(mockClearToken).toHaveBeenCalled();
  });
});
