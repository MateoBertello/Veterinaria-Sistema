import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProveedoresPage } from "./ProveedoresPage.tsx";
import * as proveedoresApi from "../api/comercial/proveedores.ts";
import * as clientesApi from "../api/clientes.ts";
import { ApiError, type ApiMeta, type Proveedor } from "../types/index.ts";

const MOCK_PROVEEDORES: Proveedor[] = [
  {
    id: "prov-1",
    tenantId: "tenant-1",
    razonSocial: "Distribuidora Veterinaria Sur S.A.",
    nombreFantasia: "VetSur",
    cuit: "30-71234567-8",
    condicionFiscal: "responsable_inscripto",
    telefono: "011 4444-5555",
    email: "contacto@vetsur.com",
    direccion: "Av. Corrientes 1234, CABA",
    contactoNombre: "Juan Pérez",
    observaciones: "Entrega los martes",
    clienteId: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "prov-2",
    tenantId: "tenant-1",
    razonSocial: "Laboratorios Richmond S.A.",
    nombreFantasia: null,
    cuit: "30-55556666-4",
    condicionFiscal: "responsable_inscripto",
    telefono: null,
    email: null,
    direccion: null,
    contactoNombre: null,
    observaciones: null,
    clienteId: null,
    activo: false, // Dado de baja
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("ProveedoresPage (F1·T3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(proveedoresApi, "listarProveedores").mockResolvedValue({
      items: MOCK_PROVEEDORES,
      meta: { page: 1, limit: 20, total: 2 },
    });
    vi.spyOn(clientesApi, "listarClientes").mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 15, total: 0 },
    });
  });

  it("renderiza la lista de proveedores con sus datos fiscales y de contacto", async () => {
    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Proveedores")).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Veterinaria Sur S.A.")).toBeInTheDocument();
    expect(screen.getByText("VetSur")).toBeInTheDocument();
    expect(screen.getByText("30-71234567-8")).toBeInTheDocument();
    expect(screen.getByText("contacto@vetsur.com")).toBeInTheDocument();
    expect(screen.getByText("Laboratorios Richmond S.A.")).toBeInTheDocument();
  });

  it("muestra estado vacío cuando no hay proveedores registrados", async () => {
    vi.spyOn(proveedoresApi, "listarProveedores").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("No hay proveedores registrados."),
    ).toBeInTheDocument();
  });

  it("muestra estado de error general con alerta y botón de reintento", async () => {
    vi.spyOn(proveedoresApi, "listarProveedores")
      .mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Error del servidor"))
      .mockResolvedValueOnce({
        items: MOCK_PROVEEDORES,
        meta: { page: 1, limit: 20, total: 2 },
      });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Error del servidor");

    const btnReintentar = screen.getByRole("button", { name: "Reintentar" });
    await userEvent.click(btnReintentar);

    expect(await screen.findByText("Distribuidora Veterinaria Sur S.A.")).toBeInTheDocument();
  });

  it("caso 403: un rol sin manage_suppliers ve el mensaje del backend, no una tabla vacía", async () => {
    vi.spyOn(proveedoresApi, "listarProveedores").mockRejectedValueOnce(
      new ApiError("FORBIDDEN", 403, "No tenés permiso para gestionar proveedores"),
    );

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    // Debe mostrar la alerta con el error del backend
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar proveedores");

    // NO debe mostrar mensaje de tabla vacía engañosa
    expect(screen.queryByText("No hay proveedores registrados.")).not.toBeInTheDocument();
  });

  it("el alta manda exactamente los campos del schema; los vacíos van como null, no como \"\"", async () => {
    const mockCrear = vi.spyOn(proveedoresApi, "crearProveedor").mockResolvedValue({
      id: "prov-new",
      tenantId: "tenant-1",
      razonSocial: "Droguería Central",
      nombreFantasia: null,
      cuit: null,
      condicionFiscal: null,
      telefono: null,
      email: null,
      direccion: null,
      contactoNombre: null,
      observaciones: null,
      clienteId: null,
      activo: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    await screen.findByText("Distribuidora Veterinaria Sur S.A.");

    // Abrir Sheet de nuevo proveedor
    const btnNuevo = screen.getByRole("button", { name: /Nuevo proveedor/i });
    await userEvent.click(btnNuevo);

    expect(await screen.findByRole("heading", { name: "Nuevo proveedor" })).toBeInTheDocument();

    // Solo llenamos razón social, dejando el resto vacío o con espacios
    const inputRS = screen.getByLabelText(/Razón social/i);
    await userEvent.type(inputRS, "Droguería Central");

    const btnGuardar = screen.getByRole("button", { name: "Crear proveedor" });
    await userEvent.click(btnGuardar);

    await waitFor(() => {
      expect(mockCrear).toHaveBeenCalledTimes(1);
    });

    const payload = mockCrear.mock.calls[0]![0];

    // Comprobar que los vacíos son null, no ""
    expect(payload).toEqual({
      razonSocial: "Droguería Central",
      nombreFantasia: null,
      cuit: null,
      condicionFiscal: null,
      telefono: null,
      email: null,
      direccion: null,
      contactoNombre: null,
      observaciones: null,
      clienteId: null,
    });
  });

  it("un CUIT con formato raro pero dentro de 20 caracteres se manda (no lo bloquea el cliente)", async () => {
    const mockCrear = vi.spyOn(proveedoresApi, "crearProveedor").mockResolvedValue({
      id: "prov-new2",
      tenantId: "tenant-1",
      razonSocial: "Proveedor Extranjero",
      nombreFantasia: null,
      cuit: "EXT-9988776655",
      condicionFiscal: null,
      telefono: null,
      email: null,
      direccion: null,
      contactoNombre: null,
      observaciones: null,
      clienteId: null,
      activo: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    await screen.findByText("Distribuidora Veterinaria Sur S.A.");

    const btnNuevo = screen.getByRole("button", { name: /Nuevo proveedor/i });
    await userEvent.click(btnNuevo);

    await screen.findByRole("heading", { name: "Nuevo proveedor" });

    await userEvent.type(screen.getByLabelText(/Razón social/i), "Proveedor Extranjero");
    await userEvent.type(screen.getByLabelText(/CUIT/i), "EXT-9988776655");

    const btnGuardar = screen.getByRole("button", { name: "Crear proveedor" });
    await userEvent.click(btnGuardar);

    await waitFor(() => {
      expect(mockCrear).toHaveBeenCalledTimes(1);
    });

    expect(mockCrear.mock.calls[0]![0].cuit).toBe("EXT-9988776655");
  });

  it("ningún request lleva tenantId", async () => {
    const mockCrear = vi.spyOn(proveedoresApi, "crearProveedor").mockResolvedValue({
      id: "prov-new3",
      tenantId: "tenant-1",
      razonSocial: "Test Sin Tenant",
      nombreFantasia: null,
      cuit: null,
      condicionFiscal: null,
      telefono: null,
      email: null,
      direccion: null,
      contactoNombre: null,
      observaciones: null,
      clienteId: null,
      activo: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    await screen.findByText("Distribuidora Veterinaria Sur S.A.");

    const btnNuevo = screen.getByRole("button", { name: /Nuevo proveedor/i });
    await userEvent.click(btnNuevo);

    await screen.findByRole("heading", { name: "Nuevo proveedor" });
    await userEvent.type(screen.getByLabelText(/Razón social/i), "Test Sin Tenant");

    const btnGuardar = screen.getByRole("button", { name: "Crear proveedor" });
    await userEvent.click(btnGuardar);

    await waitFor(() => {
      expect(mockCrear).toHaveBeenCalledTimes(1);
    });

    const payload = mockCrear.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty("tenantId");
    expect(payload).not.toHaveProperty("tenant_id");
  });

  it("la baja pide confirmación y el error queda dentro del diálogo", async () => {
    const mockCambiarEstado = vi.spyOn(proveedoresApi, "cambiarEstadoProveedor").mockRejectedValueOnce(
      new ApiError("SUPPLIER_HAS_PURCHASES", 409, "El proveedor tiene compras pendientes"),
    );

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    await screen.findByText("Distribuidora Veterinaria Sur S.A.");

    const btnBaja = screen.getByRole("button", {
      name: "Dar de baja Distribuidora Veterinaria Sur S.A.",
    });
    await userEvent.click(btnBaja);

    expect(await screen.findByRole("heading", { name: "Dar de baja proveedor" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /«Distribuidora Veterinaria Sur S.A.» deja de ofrecerse al cargar compras nuevas. Las compras ya registradas lo siguen mostrando./,
      ),
    ).toBeInTheDocument();

    const btnConfirmar = screen.getByRole("button", { name: "Dar de baja" });
    await userEvent.click(btnConfirmar);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El proveedor tiene compras pendientes");
    expect(screen.getByRole("heading", { name: "Dar de baja proveedor" })).toBeInTheDocument();
  });

  it("permite reactivar un proveedor dado de baja", async () => {
    const mockCambiarEstado = vi.spyOn(proveedoresApi, "cambiarEstadoProveedor").mockResolvedValueOnce({
      ...MOCK_PROVEEDORES[1]!,
      activo: true,
    });

    render(
      <MemoryRouter>
        <ProveedoresPage />
      </MemoryRouter>,
    );

    await screen.findByText("Laboratorios Richmond S.A.");

    const btnReactivar = screen.getByRole("button", {
      name: "Reactivar Laboratorios Richmond S.A.",
    });
    await userEvent.click(btnReactivar);

    expect(mockCambiarEstado).toHaveBeenCalledWith("prov-2", true);
  });
});
