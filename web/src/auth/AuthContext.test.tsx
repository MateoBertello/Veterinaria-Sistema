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
  setSession: vi.fn(),
  clearToken: vi.fn(),
}));

vi.mock("../api/catalogos.ts", () => ({
  invalidarCacheCatalogos: vi.fn(),
}));

vi.mock("../api/catalogos-comercial.ts", () => ({
  invalidarCacheCatalogosComercial: vi.fn(),
}));

vi.mock("../api/comercial/productos.ts", () => ({
  invalidarCacheFamilias: vi.fn(),
}));

import { AuthProvider, useAuth } from "./AuthContext.tsx";
import { login, fetchMe, logoutRequest } from "../api/auth.ts";
import { getToken, setSession, clearToken } from "../lib/session.ts";
import { invalidarCacheCatalogos } from "../api/catalogos.ts";
import { invalidarCacheCatalogosComercial } from "../api/catalogos-comercial.ts";
import { invalidarCacheFamilias } from "../api/comercial/productos.ts";
import * as clientModule from "../api/client.ts";

const mockLogin = vi.mocked(login);
const mockFetchMe = vi.mocked(fetchMe);
const mockLogoutRequest = vi.mocked(logoutRequest);
const mockGetToken = vi.mocked(getToken);
const mockSetSession = vi.mocked(setSession);
const mockClearToken = vi.mocked(clearToken);
const mockInvalidarCacheCatalogos = vi.mocked(invalidarCacheCatalogos);
const mockInvalidarCacheCatalogosComercial = vi.mocked(invalidarCacheCatalogosComercial);
const mockInvalidarCacheFamilias = vi.mocked(invalidarCacheFamilias);

const USER: AuthUser = {
  id: "u1",
  username: "admin_demo",
  fullName: "Admin Demo",
  roleName: "Administrador",
  permissions: ["manage_clients"],
};

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
    expect(mockInvalidarCacheCatalogos).toHaveBeenCalled();
    expect(mockInvalidarCacheCatalogosComercial).toHaveBeenCalled();
    expect(mockInvalidarCacheFamilias).toHaveBeenCalled();
  });

  it("al quedar anónimo limpia SOLO la sesión de tenant, nunca la de plataforma", async () => {
    // `clearToken()` sin scope borra la sesión de la clínica. Si además borrara
    // la de plataforma, un token vencido del tenant expulsaría al Super Admin de
    // la consola —que fue exactamente el bug del token pegado a mano—.
    mockGetToken.mockReturnValue("jwt-vencido");
    mockFetchMe.mockRejectedValue(new Error("401"));

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(mockClearToken).toHaveBeenCalledWith();
    expect(mockClearToken).not.toHaveBeenCalledWith("platform");
  });

  it("login guarda el PAR de tokens y deja la sesión activa", async () => {
    mockGetToken.mockReturnValue(null);
    mockLogin.mockResolvedValue({ token: "nuevo-jwt", refreshToken: "nuevo-refresh", user: USER });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );

    await userEvent.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );
    // El refresh token es lo que permite renovar la sesión al vencer el access token.
    expect(mockSetSession).toHaveBeenCalledWith("nuevo-jwt", "nuevo-refresh");
    expect(screen.getByTestId("user")).toHaveTextContent("Admin Demo");
  });

  it("logout limpia el token aunque la llamada remota falle e invalida catálogos", async () => {
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
    expect(mockInvalidarCacheCatalogos).toHaveBeenCalled();
    expect(mockInvalidarCacheCatalogosComercial).toHaveBeenCalled();
    expect(mockInvalidarCacheFamilias).toHaveBeenCalled();
  });

  it("registra un forbidden handler en el cliente que ante 403 invalida catálogos clínicos, comerciales y familias", async () => {
    let forbiddenCb: (() => void) | null = null;
    const spy = vi.spyOn(clientModule, "setForbiddenHandler").mockImplementation((cb) => {
      forbiddenCb = cb;
    });

    mockGetToken.mockReturnValue("jwt");
    mockFetchMe.mockResolvedValue(USER);

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
    );

    expect(spy).toHaveBeenCalled();
    expect(forbiddenCb).toBeTypeOf("function");

    mockInvalidarCacheCatalogos.mockClear();
    mockInvalidarCacheCatalogosComercial.mockClear();
    mockInvalidarCacheFamilias.mockClear();

    // Simula llegada de 403 desde el cliente HTTP
    forbiddenCb!();

    expect(mockInvalidarCacheCatalogos).toHaveBeenCalledTimes(1);
    expect(mockInvalidarCacheCatalogosComercial).toHaveBeenCalledTimes(1);
    expect(mockInvalidarCacheFamilias).toHaveBeenCalledTimes(1);
  });
});
