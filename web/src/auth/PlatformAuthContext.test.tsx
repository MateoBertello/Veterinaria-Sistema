/**
 * PlatformAuthContext — la sesión del Super Admin, separada de la del tenant.
 *
 * Antes de que existiera este login, la consola se abría pegando un access_token
 * a mano en `localStorage` (lo imprimía `scripts/crear-super-admin.mjs`). Eso
 * traía dos problemas que estos tests fijan: nunca había refresh token —la
 * sesión moría a la hora exacta— y cualquier 401 de la API del tenant borraba el
 * token compartido y echaba al Super Admin de la consola.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api/platformAuth.ts", () => ({
  platformLogin:         vi.fn(),
  platformLogoutRequest: vi.fn(),
  platformRefresh:       vi.fn(),
}));

// Se captura el handler de 401 que registra el provider para dispararlo a mano.
let handler401: (() => void) | null = null;
vi.mock("../api/client.ts", () => ({
  setPlatformUnauthorizedHandler: vi.fn((h: (() => void) | null) => {
    handler401 = h;
  }),
}));

import { platformLogin, platformLogoutRequest, platformRefresh } from "../api/platformAuth.ts";
import { PlatformAuthProvider, usePlatformAuth } from "./PlatformAuthContext.tsx";

const mockLogin   = vi.mocked(platformLogin);
const mockLogout  = vi.mocked(platformLogoutRequest);
const mockRefresh = vi.mocked(platformRefresh);

const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;

/** JWT de mentira: el front solo lee claims; la firma la valida el backend. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.firma`;
}

const TOKEN_VENCIDO = makeJwt({
  sub:          "sa-1",
  email:        "super@leo.local",
  exp:          Math.floor(Date.now() / 1000) - 60,
  app_metadata: { platform_role: "super_admin" },
});

const TOKEN_SUPER_ADMIN = makeJwt({
  sub:          "sa-1",
  email:        "super@leo.local",
  exp:          EXP_FUTURO,
  app_metadata: { platform_role: "super_admin" },
});

function Consumer() {
  const { status, session, login, logout } = usePlatformAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="sesion">{session?.superAdminId ?? "—"}</p>
      {/* El error se traga acá igual que en la pantalla real (`PlatformLoginPage`
          lo captura para mostrar el mensaje): sin esto queda una promesa
          rechazada suelta y vitest la reporta como error del archivo. */}
      <button onClick={() => { login({ email: "super@leo.local", password: "x" }).catch(() => {}); }}>
        entrar
      </button>
      <button onClick={() => void logout()}>salir</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <PlatformAuthProvider>
      <Consumer />
    </PlatformAuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  handler401 = null;
});

afterEach(() => {
  localStorage.clear();
});

describe("PlatformAuthProvider", () => {
  it("sin token guardado arranca sin sesión", () => {
    renderProvider();
    expect(screen.getByTestId("sesion")).toHaveTextContent("—");
  });

  it("rehidrata la sesión del token guardado sin pedirle nada al backend", () => {
    // El claim ES la sesión: no hay /me que consultar (GET /auth/me exige un
    // tenant_id que el Super Admin no tiene, y por eso lo rechazaba con 401).
    localStorage.setItem("sb-platform-token", TOKEN_SUPER_ADMIN);

    renderProvider();

    expect(screen.getByTestId("sesion")).toHaveTextContent("sa-1");
  });

  it("el login guarda el PAR de tokens en las claves de plataforma", async () => {
    mockLogin.mockResolvedValue({
      token:        TOKEN_SUPER_ADMIN,
      refreshToken: "refresh-plataforma",
      superAdmin:   { id: "sa-1", email: "super@leo.local" },
    });

    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "entrar" }));

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("sa-1"));
    expect(localStorage.getItem("sb-platform-token")).toBe(TOKEN_SUPER_ADMIN);
    // Sin esto la consola volvía a morirse a la hora.
    expect(localStorage.getItem("sb-platform-refresh-token")).toBe("refresh-plataforma");
    // Y la sesión de la clínica no se toca.
    expect(localStorage.getItem("sb-token")).toBeNull();
  });

  it("un login fallido propaga el ApiError y no deja sesión a medias", async () => {
    mockLogin.mockRejectedValue(new Error("401"));

    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "entrar" }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalled());
    expect(screen.getByTestId("sesion")).toHaveTextContent("—");
    expect(localStorage.getItem("sb-platform-token")).toBeNull();
  });

  it("el logout invalida la sesión en el backend y limpia el par local", async () => {
    localStorage.setItem("sb-platform-token", TOKEN_SUPER_ADMIN);
    localStorage.setItem("sb-platform-refresh-token", "refresh-plataforma");
    mockLogout.mockResolvedValue({ message: "ok" });

    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "salir" }));

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("—"));
    expect(mockLogout).toHaveBeenCalled();
    expect(localStorage.getItem("sb-platform-token")).toBeNull();
    expect(localStorage.getItem("sb-platform-refresh-token")).toBeNull();
  });

  it("si el logout remoto falla, igual se limpia la sesión local", async () => {
    localStorage.setItem("sb-platform-token", TOKEN_SUPER_ADMIN);
    mockLogout.mockRejectedValue(new Error("500"));

    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "salir" }));

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("—"));
    expect(localStorage.getItem("sb-platform-token")).toBeNull();
  });

  it("con el access token vencido pero refresh vivo, recupera la sesión sin volver a loguearse", async () => {
    // Volver a la consola al otro día: el access token ya venció (dura una hora)
    // pero el refresh sigue siendo bueno. Antes esto era el final de la sesión y
    // había que volver a correr un script para entrar.
    localStorage.setItem("sb-platform-token", TOKEN_VENCIDO);
    localStorage.setItem("sb-platform-refresh-token", "refresh-plataforma");
    mockRefresh.mockResolvedValue({ token: TOKEN_SUPER_ADMIN, refreshToken: "refresh-2" });

    renderProvider();

    // No se da por anónimo mientras renueva: eso mandaría al login a alguien que
    // sí tiene sesión.
    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("sa-1"));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    // GoTrue rota el refresh token: queda guardado el par nuevo.
    expect(localStorage.getItem("sb-platform-token")).toBe(TOKEN_SUPER_ADMIN);
    expect(localStorage.getItem("sb-platform-refresh-token")).toBe("refresh-2");
  });

  it("si el refresh de arranque falla, queda anónimo y limpia el par vencido", async () => {
    localStorage.setItem("sb-platform-token", TOKEN_VENCIDO);
    localStorage.setItem("sb-platform-refresh-token", "refresh-revocado");
    mockRefresh.mockRejectedValue(new Error("401"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(localStorage.getItem("sb-platform-token")).toBeNull();
    expect(localStorage.getItem("sb-platform-refresh-token")).toBeNull();
  });

  it("token vencido y sin refresh token: anónimo directo, sin pedir nada", () => {
    localStorage.setItem("sb-platform-token", TOKEN_VENCIDO);

    renderProvider();

    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("el 401 irrecuperable de /admin/* vacía la sesión (y solo lo dispara ese scope)", async () => {
    localStorage.setItem("sb-platform-token", TOKEN_SUPER_ADMIN);

    renderProvider();
    expect(screen.getByTestId("sesion")).toHaveTextContent("sa-1");

    act(() => handler401?.());

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("—"));
  });
});
