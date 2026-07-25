import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireSuperAdmin } from "./RequireSuperAdmin.tsx";

/** JWT de mentira: el front solo lee claims; la firma la valida el backend. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.firma`;
}

const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/admin/tenants"]}>
      <Routes>
        {/* "/" es el shell del tenant: quien no sea super admin termina acá (y si
            tampoco tiene sesión de tenant, ProtectedRoute lo manda a /login). */}
        <Route path="/" element={<p>Shell del tenant</p>} />
        <Route
          path="/admin/tenants"
          element={
            <RequireSuperAdmin>
              <p>Consola de plataforma</p>
            </RequireSuperAdmin>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
});

describe("RequireSuperAdmin", () => {
  it("con el claim platform_role=super_admin renderiza la consola", () => {
    localStorage.setItem(
      "sb-token",
      makeJwt({ sub: "sa-1", exp: EXP_FUTURO, app_metadata: { platform_role: "super_admin" } }),
    );

    renderApp();

    expect(screen.getByText("Consola de plataforma")).toBeInTheDocument();
  });

  it("un usuario de tenant (sin el claim) es rechazado y vuelve a su shell", () => {
    localStorage.setItem(
      "sb-token",
      makeJwt({ sub: "u-1", exp: EXP_FUTURO, app_metadata: { tenant_id: "t-1" } }),
    );

    renderApp();

    expect(screen.getByText("Shell del tenant")).toBeInTheDocument();
    expect(screen.queryByText("Consola de plataforma")).not.toBeInTheDocument();
  });

  it("sin sesión alguna, sale del área de plataforma", () => {
    renderApp();

    expect(screen.getByText("Shell del tenant")).toBeInTheDocument();
  });

  it("con el token de plataforma vencido, sale del área de plataforma", () => {
    localStorage.setItem(
      "sb-token",
      makeJwt({
        sub: "sa-1",
        exp: Math.floor(Date.now() / 1000) - 60,
        app_metadata: { platform_role: "super_admin" },
      }),
    );

    renderApp();

    expect(screen.getByText("Shell del tenant")).toBeInTheDocument();
  });
});
