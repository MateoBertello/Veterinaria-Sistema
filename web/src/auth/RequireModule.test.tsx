import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RequireModule } from "./RequireModule.tsx";
import * as ModulosContext from "./ModulosContext.tsx";

describe("RequireModule (RN-G2)", () => {
  it("renderiza el contenido protegido si el módulo está habilitado", () => {
    vi.spyOn(ModulosContext, "useModulos").mockReturnValue({
      modulos: [{ modulo: "stock", habilitado: true, fechaAlta: null }],
      cargando: false,
      estaHabilitado: (m) => m === "stock",
      recargar: async () => {},
    });

    render(
      <MemoryRouter>
        <RequireModule modulo="stock">
          <p>Contenido protegido de stock</p>
        </RequireModule>
      </MemoryRouter>,
    );

    expect(screen.getByText("Contenido protegido de stock")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Módulo no contratado" })).not.toBeInTheDocument();
  });

  it("renderiza ModuloNoContratado si el módulo no está habilitado para el tenant", () => {
    vi.spyOn(ModulosContext, "useModulos").mockReturnValue({
      modulos: [{ modulo: "turnos", habilitado: true, fechaAlta: null }],
      cargando: false,
      estaHabilitado: (m) => m === "turnos",
      recargar: async () => {},
    });

    render(
      <MemoryRouter>
        <RequireModule modulo="stock">
          <p>Contenido protegido de stock</p>
        </RequireModule>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Contenido protegido de stock")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Módulo no contratado" })).toBeInTheDocument();
    expect(screen.getByText(/no forma parte del plan contratado/)).toBeInTheDocument();
  });

  it("muestra el estado de carga mientras resuelve los módulos habilitados", () => {
    vi.spyOn(ModulosContext, "useModulos").mockReturnValue({
      modulos: [],
      cargando: true,
      estaHabilitado: () => false,
      recargar: async () => {},
    });

    render(
      <MemoryRouter>
        <RequireModule modulo="ventas">
          <p>Contenido protegido de ventas</p>
        </RequireModule>
      </MemoryRouter>,
    );

    expect(screen.getByText("Verificando suscripción...")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido de ventas")).not.toBeInTheDocument();
  });
});
