import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { ApiError, type Rol, type Usuario } from "../types/index.ts";

vi.mock("../api/usuarios.ts", () => ({
  listarUsuarios: vi.fn(),
  crearUsuario: vi.fn(),
  editarUsuario: vi.fn(),
  listarRoles: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsuariosPage } from "./UsuariosPage.tsx";
import { listarUsuarios, listarRoles } from "../api/usuarios.ts";

const mockListar = vi.mocked(listarUsuarios);
const mockRoles = vi.mocked(listarRoles);

const roles: Rol[] = [
  { id: "r-admin", name: "admin", displayName: "Administrador", description: null },
];

function makeUsuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: "u1",
    username: "ana",
    email: "ana@x.com",
    fullName: "Ana Pérez",
    phone: null,
    active: true,
    rolId: "r-admin",
    rolName: "Administrador",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <TooltipProvider>
      <UsuariosPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoles.mockResolvedValue(roles);
});

describe("UsuariosPage", () => {
  it("muestra el listado de usuarios (con badge de rol y estado) tras cargar", async () => {
    mockListar.mockResolvedValue({
      items: [makeUsuario()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("ana")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay usuarios", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay usuarios/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeUsuario()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita la página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeUsuario()],
      meta: { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByText("Ana Pérez");

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({ page: 2, limit: 20 }),
    );
  });

  it("abre el formulario de alta al pulsar 'Nuevo usuario'", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay usuarios/i);

    await userEvent.click(screen.getByRole("button", { name: /Nuevo usuario/i }));

    expect(await screen.findByRole("heading", { name: /Nuevo usuario/i })).toBeInTheDocument();
  });

  it("un usuario inactivo muestra badge 'Inactivo' y acción 'Activar'", async () => {
    mockListar.mockResolvedValue({
      items: [makeUsuario({ active: false })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activar ana/i })).toBeInTheDocument();
  });
});
