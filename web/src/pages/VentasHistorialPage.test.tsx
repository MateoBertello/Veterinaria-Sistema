import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import VentasHistorialPage from "./VentasHistorialPage.tsx";
import * as ventasApi from "../api/comercial/ventas.ts";
import * as usuariosApi from "../api/usuarios.ts";
import type { AuthUser, Venta } from "../types/index.ts";

const mockAuth = {
  user: {
    id: "user-cajero",
    username: "cajero",
    fullName: "Cajero Test",
    roleName: "Recepcionista",
    permissions: ["manage_sales"],
  } as AuthUser | null,
  hasPermission: (p: string) => Boolean(mockAuth.user?.permissions?.includes(p)),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

const VENTAS_MOCK: Venta[] = [
  {
    id: "v-1",
    tenantId: "t-1",
    sesionCajaId: "ses-1",
    clienteId: "cli-1",
    usuarioId: "user-1",
    numeroOperacion: "0001-00000042",
    condicionPago: "contado",
    subtotalNeto: 1000,
    totalIva: 210,
    total: 1210,
    saldoPendiente: 0,
    estado: "registrada",
    observaciones: null,
    createdAt: "2026-09-05T14:30:00.000Z",
    anuladaAt: null,
    anuladaMotivo: null,
    cliente: { full_name: "Juan Pérez", dni_cuit: "20123456789" },
    usuario: { full_name: "Vendedora Laura" },
    items: [],
    pagos: [],
  },
  {
    id: "v-2",
    tenantId: "t-1",
    sesionCajaId: "ses-1",
    clienteId: null,
    usuarioId: "user-cajero",
    numeroOperacion: "0001-00000043",
    condicionPago: "cuenta_corriente",
    subtotalNeto: 5000,
    totalIva: 1050,
    total: 6050,
    saldoPendiente: 2000,
    estado: "anulada",
    observaciones: null,
    createdAt: "2026-09-05T15:45:00.000Z",
    anuladaAt: "2026-09-05T16:00:00.000Z",
    anuladaMotivo: "Error de carga",
    cliente: null,
    usuario: { full_name: "Cajero Test" },
    items: [],
    pagos: [],
  },
];

describe("VentasHistorialPage (F4·T3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = {
      id: "user-cajero",
      username: "cajero",
      fullName: "Cajero Test",
      roleName: "Recepcionista",
      permissions: ["manage_sales"],
    };

    vi.spyOn(ventasApi, "listarVentas").mockResolvedValue({
      items: VENTAS_MOCK,
      meta: { total: 2, page: 1, limit: 20 },
    });

    vi.spyOn(usuariosApi, "listarUsuarios").mockResolvedValue({
      items: [
        {
          id: "user-1",
          username: "laura",
          fullName: "Vendedora Laura",
          email: "laura@vet.com",
          rolId: "r-1",
          rolName: "Recepcionista",
          active: true,
          phone: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      meta: { total: 1, page: 1, limit: 100 },
    });
  });

  const renderPage = () => {
    return render(
      <MemoryRouter>
        <VentasHistorialPage />
      </MemoryRouter>,
    );
  };

  it("Renderiza listado de ventas con columna 'Operación N°' y datos correctos", async () => {
    renderPage();

    // Título de la pantalla
    expect(await screen.findByRole("heading", { level: 1, name: "Historial de Ventas" })).toBeInTheDocument();

    // Encabezado de columna con "Operación N°"
    expect(screen.getByRole("columnheader", { name: "Operación N°" })).toBeInTheDocument();

    // Filas renderizadas
    expect(screen.getByText("Operación N° 0001-00000042")).toBeInTheDocument();
    expect(screen.getByText("Operación N° 0001-00000043")).toBeInTheDocument();

    // Cliente
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("Mostrador")).toBeInTheDocument();

    // Estados
    expect(screen.getByText("registrada")).toBeInTheDocument();
    expect(screen.getByText("anulada")).toBeInTheDocument();

    // Totales y saldos
    expect(screen.getByText("$ 1.210,00")).toBeInTheDocument();
    expect(screen.getByText("$ 2.000,00")).toBeInTheDocument();
  });

  it("§2.6: la pantalla NO contiene 'Comprobante', 'Factura', 'Ticket' ni 'Recibo'", async () => {
    renderPage();

    await screen.findByText("Operación N° 0001-00000042");

    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toMatch(/comprobante/i);
    expect(bodyText).not.toMatch(/factura/i);
    expect(bodyText).not.toMatch(/ticket/i);
    expect(bodyText).not.toMatch(/recibo/i);
  });

  it("§8.2: sin view_sales, el filtro por vendedor no se renderiza y el copy vacío dice 'No registraste ventas con estos filtros.'", async () => {
    mockAuth.user = {
      id: "user-cajero",
      username: "cajero",
      fullName: "Cajero Test",
      roleName: "Recepcionista",
      permissions: ["manage_sales"], // NO tiene view_sales
    };

    vi.spyOn(ventasApi, "listarVentas").mockResolvedValue({
      items: [],
      meta: { total: 0, page: 1, limit: 20 },
    });

    renderPage();

    // El filtro de vendedor NO se renderiza
    await waitFor(() => {
      expect(screen.queryByLabelText(/Vendedor/i)).not.toBeInTheDocument();
    });

    // Copy exacto del estado vacío (§8.2)
    expect(
      await screen.findByText("No registraste ventas con estos filtros."),
    ).toBeInTheDocument();
  });

  it("Con view_sales, el filtro por vendedor se renderiza y el copy vacío dice 'No hay ventas con estos filtros.'", async () => {
    mockAuth.user = {
      id: "admin-1",
      username: "admin",
      fullName: "Admin",
      roleName: "Administrador",
      permissions: ["manage_sales", "view_sales"], // TIENE view_sales
    };

    vi.spyOn(ventasApi, "listarVentas").mockResolvedValue({
      items: [],
      meta: { total: 0, page: 1, limit: 20 },
    });

    renderPage();

    // El filtro de vendedor SÍ se renderiza
    expect(await screen.findByLabelText(/Vendedor/i)).toBeInTheDocument();

    // Copy exacto del estado vacío
    expect(
      await screen.findByText("No hay ventas con estos filtros."),
    ).toBeInTheDocument();
  });

  it("Muestra estado de error con botón de reintentar", async () => {
    vi.spyOn(ventasApi, "listarVentas").mockRejectedValue(
      new Error("Fallo de conexión al cargar ventas"),
    );

    renderPage();

    expect(
      await screen.findByText("Fallo de conexión al cargar ventas"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeInTheDocument();
  });

  it("Ningún request manda tenantId", async () => {
    const spy = vi.spyOn(ventasApi, "listarVentas");

    renderPage();

    await screen.findByText("Operación N° 0001-00000042");

    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls;
    for (const [arg] of calls) {
      expect((arg as Record<string, unknown>)?.tenantId).toBeUndefined();
      expect((arg as Record<string, unknown>)?.tenant_id).toBeUndefined();
    }
  });
});
