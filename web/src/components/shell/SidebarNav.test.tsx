import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarNav } from "./SidebarNav.tsx";
import { buildNavItems } from "../../lib/navigation.ts";
import type { AuthUser, ModuloContratado, ModuloVendible } from "../../types/index.ts";

const mod = (modulo: ModuloVendible, habilitado: boolean): ModuloContratado => ({
  modulo, habilitado, fechaAlta: null,
});

const ADMIN: AuthUser = {
  id: "u1", username: "ana", fullName: "Ana Pérez", roleName: "Administrador",
  permissions: [
    "manage_services", "manage_users", "manage_schedules",
    "manage_tenant_settings", "view_audit",
  ],
};

function renderNav(
  { modulos = [] as ModuloContratado[], user = ADMIN as AuthUser | null } = {},
) {
  return render(
    <MemoryRouter>
      <SidebarNav
        items={buildNavItems(modulos, user?.permissions ?? [])}
        user={user}
        onLogout={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("SidebarNav", () => {
  it("rotula cada sección con su encabezado", () => {
    renderNav({ modulos: [mod("turnos", true)] });
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });

    expect(within(nav).getByRole("heading", { name: "Clínica" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { name: "Módulos contratados" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { name: "Operación" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { name: "Administración" })).toBeInTheDocument();
  });

  it("pone los módulos vendibles bajo su propio encabezado, separados del core", () => {
    renderNav({ modulos: [mod("turnos", true), mod("guarderia", true)] });
    const seccion = screen
      .getByRole("heading", { name: "Módulos contratados" })
      .parentElement!;

    const links = within(seccion).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Turnos", "Guardería"]);
  });

  it("RN-G2: sin módulos contratados no dibuja el encabezado de módulos", () => {
    renderNav({ modulos: [mod("turnos", false)] });
    expect(screen.queryByRole("heading", { name: "Módulos contratados" })).not.toBeInTheDocument();
  });

  it("N2: expone Preferencias en el menú de cuenta, no en la navegación de módulos", () => {
    renderNav();

    const cuenta = screen.getByRole("navigation", { name: "Cuenta" });
    expect(within(cuenta).getByRole("link", { name: "Preferencias" })).toHaveAttribute(
      "href", "/preferencias",
    );

    const principal = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(within(principal).queryByRole("link", { name: "Preferencias" })).not.toBeInTheDocument();
  });

  it("sin usuario no dibuja el menú de cuenta (el shell aún no resolvió la sesión)", () => {
    renderNav({ user: null });
    expect(screen.queryByRole("navigation", { name: "Cuenta" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();
  });

  it("un rol sin permisos de administración no ve esa sección", () => {
    const recepcionista: AuthUser = {
      ...ADMIN, roleName: "Recepcionista", permissions: ["manage_schedules"],
    };
    renderNav({ user: recepcionista });

    expect(screen.getByRole("heading", { name: "Operación" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administración" })).not.toBeInTheDocument();
  });
});
