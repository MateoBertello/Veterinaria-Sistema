import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "../../components/ui/tooltip.tsx";
import { ApiError, type Tenant } from "../../types/index.ts";

vi.mock("../../api/admin.ts", () => ({
  listarTenants: vi.fn(),
  crearTenant: vi.fn(),
  editarTenant: vi.fn(),
  cambiarEstadoTenant: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TenantsPage } from "./TenantsPage.tsx";
import { listarTenants, cambiarEstadoTenant } from "../../api/admin.ts";

const mockListar = vi.mocked(listarTenants);
const mockCambiarEstado = vi.mocked(cambiarEstadoTenant);

function makeTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: "t-1",
    nombre: "Veterinaria San Roque",
    cuitRut: "30-71234567-8",
    emailContacto: "contacto@sanroque.vet",
    plan: "profesional",
    activo: true,
    adminInvitado: true,
    createdAt: "2026-06-09T12:00:00Z",
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <TenantsPage />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TenantsPage", () => {
  it("lista las clínicas con badges de plan y estado", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByRole("link", { name: "Veterinaria San Roque" })).toBeInTheDocument();
    expect(screen.getByText("30-71234567-8")).toBeInTheDocument();
    expect(screen.getByText("Profesional")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay clínicas", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay clínicas/i)).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeTenant()], meta: { page: 1, limit: 20, total: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByRole("link", { name: "Veterinaria San Roque" })).toBeInTheDocument();
  });

  it("filtra por texto (con debounce) reiniciando a la página 1", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    await screen.findByRole("link", { name: "Veterinaria San Roque" });

    await userEvent.type(screen.getByLabelText("Buscar"), "roque");

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({ page: 1, limit: 20, q: "roque" }),
    );
  });

  it("filtra por plan y por estado", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant()],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();
    await screen.findByRole("link", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByLabelText("Plan"));
    await userEvent.click(await screen.findByRole("option", { name: "Premium" }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({ page: 1, limit: 20, plan: "premium" }),
    );

    await userEvent.click(screen.getByLabelText("Estado"));
    await userEvent.click(await screen.findByRole("option", { name: "Suspendido" }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        plan: "premium",
        estado: "suspendido",
      }),
    );
  });

  it("sin resultados para los filtros, el vacío lo explica", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay clínicas/i);

    await userEvent.type(screen.getByLabelText("Buscar"), "zzz");

    expect(await screen.findByText(/Ninguna clínica coincide con los filtros/i)).toBeInTheDocument();
  });

  it("pagina: 'Siguiente' solicita la página 2", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant()],
      meta: { page: 1, limit: 20, total: 40 },
    });

    renderPage();
    await screen.findByRole("link", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/i }));

    await waitFor(() =>
      expect(mockListar).toHaveBeenLastCalledWith({ page: 2, limit: 20 }),
    );
  });

  it("suspender pide confirmación y recarga con el nuevo estado", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant()],
      meta: { page: 1, limit: 20, total: 1 },
    });
    mockCambiarEstado.mockResolvedValue(makeTenant({ activo: false }));

    renderPage();
    await screen.findByRole("link", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /Suspender Veterinaria San Roque/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/perderán el acceso a todos los módulos/i)).toBeInTheDocument();

    mockListar.mockResolvedValue({
      items: [makeTenant({ activo: false })],
      meta: { page: 1, limit: 20, total: 1 },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspender" }));

    await waitFor(() => expect(mockCambiarEstado).toHaveBeenCalledWith("t-1", false));
    expect(await screen.findByText("Suspendido")).toBeInTheDocument();
  });

  it("una clínica suspendida ofrece 'Reactivar'", async () => {
    mockListar.mockResolvedValue({
      items: [makeTenant({ activo: false })],
      meta: { page: 1, limit: 20, total: 1 },
    });
    mockCambiarEstado.mockResolvedValue(makeTenant({ activo: true }));

    renderPage();
    await screen.findByRole("link", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /Reactivar Veterinaria San Roque/i }));

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reactivar" }));

    await waitFor(() => expect(mockCambiarEstado).toHaveBeenCalledWith("t-1", true));
  });

  it("abre el formulario de alta al pulsar 'Nuevo tenant'", async () => {
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();
    await screen.findByText(/Todavía no hay clínicas/i);

    await userEvent.click(screen.getByRole("button", { name: /Nuevo tenant/i }));

    expect(await screen.findByRole("heading", { name: /Nuevo tenant/i })).toBeInTheDocument();
  });
});
