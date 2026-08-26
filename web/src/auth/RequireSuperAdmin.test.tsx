import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// El provider intenta renovar al arrancar si el token venció; acá no hay backend.
vi.mock("../api/platformAuth.ts", () => ({
  platformLogin:         vi.fn(),
  platformLogoutRequest: vi.fn(),
  platformRefresh:       vi.fn(() => new Promise(() => {})),
}));

import { RequireSuperAdmin } from "./RequireSuperAdmin.tsx";
import { PlatformAuthProvider } from "./PlatformAuthContext.tsx";

/** JWT de mentira: el front solo lee claims; la firma la valida el backend. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.firma`;
}

const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;

function renderApp() {
  return render(
    <PlatformAuthProvider>
      <MemoryRouter initialEntries={["/admin/tenants"]}>
        <Routes>
          {/* Sin sesión de plataforma se cae acá: el login propio de la consola. */}
          <Route path="/admin/login" element={<p>Login de plataforma</p>} />
          <Route
            path="/admin/tenants"
            element={
              <RequireSuperAdmin>
                <p>Consola de plataforma</p>
              </RequireSuperAdmin>
            }
          />
        </Routes>
      </MemoryRouter>
    </PlatformAuthProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
});

describe("RequireSuperAdmin", () => {
  it("con el claim platform_role=super_admin renderiza la consola", () => {
    localStorage.setItem(
      "sb-platform-token",
      makeJwt({ sub: "sa-1", exp: EXP_FUTURO, app_metadata: { platform_role: "super_admin" } }),
    );

    renderApp();

    expect(screen.getByText("Consola de plataforma")).toBeInTheDocument();
  });

  it("sin sesión de plataforma manda al login de la consola", () => {
    renderApp();

    expect(screen.getByText("Login de plataforma")).toBeInTheDocument();
    expect(screen.queryByText("Consola de plataforma")).not.toBeInTheDocument();
  });

  it("una sesión de TENANT no abre la consola: es otra identidad", () => {
    // Aunque el usuario de la clínica esté logueado, su token vive en otra clave
    // y no acredita plataforma.
    localStorage.setItem(
      "sb-token",
      makeJwt({ sub: "u-1", exp: EXP_FUTURO, app_metadata: { tenant_id: "t-1" } }),
    );

    renderApp();

    expect(screen.getByText("Login de plataforma")).toBeInTheDocument();
  });

  it("un token de plataforma SIN el claim tampoco entra", () => {
    localStorage.setItem(
      "sb-platform-token",
      makeJwt({ sub: "u-1", exp: EXP_FUTURO, app_metadata: { tenant_id: "t-1" } }),
    );

    renderApp();

    expect(screen.getByText("Login de plataforma")).toBeInTheDocument();
  });

  it("con el token vencido pero un refresh token guardado, espera en vez de expulsar", async () => {
    // La sesión es recuperable: mandar al login acá sería el mismo "se murió a
    // la hora" con otra cara.
    localStorage.setItem(
      "sb-platform-token",
      makeJwt({
        sub: "sa-1",
        exp: Math.floor(Date.now() / 1000) - 60,
        app_metadata: { platform_role: "super_admin" },
      }),
    );
    localStorage.setItem("sb-platform-refresh-token", "refresh-vivo");

    renderApp();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByText("Login de plataforma")).not.toBeInTheDocument();
  });

  it("con el token de plataforma vencido y sin refresh, sale del área de plataforma", () => {
    localStorage.setItem(
      "sb-platform-token",
      makeJwt({
        sub: "sa-1",
        exp: Math.floor(Date.now() / 1000) - 60,
        app_metadata: { platform_role: "super_admin" },
      }),
    );

    renderApp();

    expect(screen.getByText("Login de plataforma")).toBeInTheDocument();
  });
});
