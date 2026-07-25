import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type ModuloContratado, type Tenant } from "../../types/index.ts";

vi.mock("../../api/admin.ts", () => ({
  obtenerTenant: vi.fn(),
  editarTenant: vi.fn(),
  crearTenant: vi.fn(),
  cambiarEstadoTenant: vi.fn(),
  invitarAdminTenant: vi.fn(),
  listarModulosTenant: vi.fn(),
  setModuloTenant: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TenantDetallePage } from "./TenantDetallePage.tsx";
import {
  obtenerTenant,
  editarTenant,
  cambiarEstadoTenant,
  invitarAdminTenant,
  listarModulosTenant,
  setModuloTenant,
} from "../../api/admin.ts";
import { toast } from "sonner";

const mockObtener = vi.mocked(obtenerTenant);
const mockEditar = vi.mocked(editarTenant);
const mockCambiarEstado = vi.mocked(cambiarEstadoTenant);
const mockInvitar = vi.mocked(invitarAdminTenant);
const mockListarModulos = vi.mocked(listarModulosTenant);
const mockSetModulo = vi.mocked(setModuloTenant);

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

const MODULOS: ModuloContratado[] = [
  { modulo: "historial_clinico", habilitado: true,  fechaAlta: "2026-06-09" },
  { modulo: "turnos",            habilitado: false, fechaAlta: null },
  { modulo: "guarderia",         habilitado: false, fechaAlta: null },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/tenants/t-1"]}>
      <Routes>
        <Route path="/admin/tenants" element={<p>Listado de tenants</p>} />
        <Route path="/admin/tenants/:id" element={<TenantDetallePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListarModulos.mockResolvedValue(MODULOS);
});

describe("TenantDetallePage", () => {
  it("muestra los metadatos comerciales del tenant (RN-SA4)", async () => {
    mockObtener.mockResolvedValue(makeTenant());

    renderPage();

    expect(await screen.findByRole("heading", { name: "Veterinaria San Roque" })).toBeInTheDocument();
    expect(mockObtener).toHaveBeenCalledWith("t-1");
    expect(screen.getByText("30-71234567-8")).toBeInTheDocument();
    expect(screen.getAllByText("contacto@sanroque.vet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Profesional").length).toBeGreaterThan(0);
  });

  it("estado de error con reintento cuando el tenant no existe", async () => {
    mockObtener.mockRejectedValueOnce(new ApiError("TENANT_NOT_FOUND", 404, "Tenant no encontrado"));

    renderPage();

    expect(await screen.findByText("Tenant no encontrado")).toBeInTheDocument();

    mockObtener.mockResolvedValue(makeTenant());
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    expect(await screen.findByRole("heading", { name: "Veterinaria San Roque" })).toBeInTheDocument();
  });

  it("editar guarda por PUT y refresca la ficha", async () => {
    mockObtener.mockResolvedValue(makeTenant());
    mockEditar.mockResolvedValue(makeTenant({ plan: "premium" }));

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /^Editar$/ }));

    const nombre = await screen.findByLabelText(/Nombre de la clínica/);
    await userEvent.clear(nombre);
    await userEvent.type(nombre, "Veterinaria San Roque");
    await userEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(mockEditar).toHaveBeenCalledWith("t-1", {
      nombre: "Veterinaria San Roque",
      emailContacto: "contacto@sanroque.vet",
      plan: "profesional",
    }));
    expect(await screen.findAllByText("Premium")).not.toHaveLength(0);
  });

  it("invitar admin: con invitación pendiente informa el envío (RN-SA2)", async () => {
    mockObtener.mockResolvedValue(makeTenant({ adminInvitado: false }));
    mockInvitar.mockResolvedValue(makeTenant({ adminInvitado: true }));

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });
    expect(screen.getAllByText("Pendiente de invitar").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /Invitar admin/i }));

    await waitFor(() => expect(mockInvitar).toHaveBeenCalledWith("t-1"));
    expect(toast.success).toHaveBeenCalledWith("Invitación enviada a contacto@sanroque.vet");
    expect(await screen.findByText("Invitado")).toBeInTheDocument();
  });

  it("invitar admin: reintento idempotente avisa que no se reenvió (RN-SA2)", async () => {
    mockObtener.mockResolvedValue(makeTenant({ adminInvitado: true }));
    mockInvitar.mockResolvedValue(makeTenant({ adminInvitado: true }));

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /Reintentar invitación/i }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "El administrador ya había sido invitado; no se reenvió la invitación.",
      ),
    );
  });

  it("invitar admin: un error del envelope se informa sin romper la pantalla", async () => {
    mockObtener.mockResolvedValue(makeTenant({ adminInvitado: false }));
    mockInvitar.mockRejectedValue(
      new ApiError("INTERNAL_ERROR", 500, "No se pudo invitar al administrador: SMTP caído"),
    );

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /Invitar admin/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo invitar al administrador: SMTP caído"),
    );
    expect(screen.getAllByText("Pendiente de invitar").length).toBeGreaterThan(0);
  });

  it("suspender desde el detalle confirma y refleja el nuevo estado (RN-SA3)", async () => {
    mockObtener.mockResolvedValue(makeTenant());
    mockCambiarEstado.mockResolvedValue(makeTenant({ activo: false }));

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });

    await userEvent.click(screen.getByRole("button", { name: /^Suspender$/ }));

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspender" }));

    await waitFor(() => expect(mockCambiarEstado).toHaveBeenCalledWith("t-1", false));
    // El estado aparece en el badge del encabezado y en la ficha de datos.
    expect(await screen.findAllByText("Suspendido")).toHaveLength(2);
  });

  it("el panel de módulos hace el toggle contra el endpoint del módulo", async () => {
    mockObtener.mockResolvedValue(makeTenant());
    mockSetModulo.mockResolvedValue({ modulo: "turnos", habilitado: true, fechaAlta: "2026-07-25" });

    renderPage();
    await screen.findByRole("heading", { name: "Veterinaria San Roque" });
    await screen.findByText(/TU · Turnos/);

    await userEvent.click(screen.getByRole("switch", { name: /Turnos: deshabilitado/i }));

    await waitFor(() => expect(mockSetModulo).toHaveBeenCalledWith("t-1", "turnos", true));
    expect(mockListarModulos).toHaveBeenCalledWith("t-1");
  });
});
