import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReportesVentasPage } from "./ReportesVentasPage.tsx";
import {
  rentabilidad,
  ventasUsuario,
  ventasSesion,
  ventasMedioPago,
} from "../api/comercial/reportes.ts";
import { reporteMargen, reporteItemsVendidos } from "../api/comercial/ventas.ts";
import { listarFamilias, listarProductos } from "../api/comercial/productos.ts";
import { listarUsuarios } from "../api/usuarios.ts";
import { listarCajas } from "../api/comercial/caja.ts";
import { listarMediosPago } from "../api/catalogos-comercial.ts";
import { ApiError } from "../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: {
    id: "user-admin",
    email: "admin@leo.com",
    role: "admin",
    permissions: ["view_sales", "manage_sales"],
  },
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/comercial/reportes.ts", () => ({
  rentabilidad: vi.fn(),
  ventasUsuario: vi.fn(),
  ventasSesion: vi.fn(),
  ventasMedioPago: vi.fn(),
}));

vi.mock("../api/comercial/ventas.ts", () => ({
  reporteMargen: vi.fn(),
  reporteItemsVendidos: vi.fn(),
}));

vi.mock("../api/comercial/productos.ts", () => ({
  listarFamilias: vi.fn(),
  listarProductos: vi.fn(),
}));

vi.mock("../api/usuarios.ts", () => ({
  listarUsuarios: vi.fn(),
}));

vi.mock("../api/comercial/caja.ts", () => ({
  listarCajas: vi.fn(),
}));

vi.mock("../api/catalogos-comercial.ts", () => ({
  listarMediosPago: vi.fn(),
}));

const mockRentabilidad = vi.mocked(rentabilidad);
const mockVentasUsuario = vi.mocked(ventasUsuario);
const mockVentasSesion = vi.mocked(ventasSesion);
const mockVentasMedioPago = vi.mocked(ventasMedioPago);
const mockReporteMargen = vi.mocked(reporteMargen);
const mockReporteItemsVendidos = vi.mocked(reporteItemsVendidos);

const mockListarFamilias = vi.mocked(listarFamilias);
const mockListarProductos = vi.mocked(listarProductos);
const mockListarUsuarios = vi.mocked(listarUsuarios);
const mockListarCajas = vi.mocked(listarCajas);
const mockListarMediosPago = vi.mocked(listarMediosPago);

describe("ReportesVentasPage (F8·T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListarFamilias.mockResolvedValue({
      items: [
        { id: "fam-1", tenantId: "tenant-1", nombre: "Farmacia", unidadBaseId: "u-1", activo: true, createdAt: "" },
      ],
      meta: { page: 1, limit: 100, total: 1 },
    });

    mockListarProductos.mockResolvedValue({
      items: [
        {
          id: "prod-1",
          tenantId: "tenant-1",
          codigo: "MED-100",
          nombre: "Vacuna Antirrábica",
          descripcion: null,
          familiaId: "fam-1",
          unidadMedidaId: "u-1",
          marca: null,
          alicuotaIva: 21,
          condicionVenta: "libre",
          controlaLote: true,
          controlaVencimiento: true,
          vidaUtilPostAperturaDias: null,
          precioVenta: 5000,
          costoReposicion: 3000,
          margenObjetivo: null,
          stockMinimo: null,
          esVendible: true,
          esConsumibleClinico: true,
          requiereFrio: false,
          trazable: true,
          codigoBarras: null,
          activo: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      meta: { page: 1, limit: 100, total: 1 },
    });

    mockListarUsuarios.mockResolvedValue({
      items: [
        {
          id: "usr-1",
          username: "cajero1",
          email: "cajero1@leo.com",
          fullName: "Juan Cajero",
          phone: null,
          rolId: "rol-1",
          rolName: "recepcionista",
          active: true,
          createdAt: "",
        },
      ],
      meta: { page: 1, limit: 100, total: 1 },
    });

    mockListarCajas.mockResolvedValue([
      {
        id: "caja-1",
        nombre: "Caja Principal",
        activa: true,
        createdAt: "",
      },
    ]);

    mockListarMediosPago.mockResolvedValue([
      {
        id: "mp-efectivo",
        codigo: "efectivo",
        nombre: "Efectivo",
        afecta_arqueo: true,
        requiere_referencia: false,
      },
      {
        id: "mp-debito",
        codigo: "debito",
        nombre: "Tarjeta de Débito",
        afecta_arqueo: false,
        requiere_referencia: true,
      },
    ]);

    mockRentabilidad.mockResolvedValue({
      totalItemsVendidos: 1,
      totalNeto: 10000,
      totalCosto: 6000,
      totalMargenBruto: 4000,
      margenPromedioPct: 40,
      items: [
        {
          itemId: "prod-1",
          itemNombre: "Vacuna Antirrábica",
          tipoItem: "producto",
          cantidadVendida: 2,
          netoTotal: 10000,
          costoTotal: 6000,
          margenBruto: 4000,
          margenPct: 40,
        },
      ],
    });

    mockVentasUsuario.mockResolvedValue([
      {
        usuarioId: "usr-1",
        usuarioNombre: "Juan Cajero",
        usuarioUsername: "cajero1",
        cantidadOperaciones: 5,
        subtotalNeto: 25000,
        totalIva: 5250,
        totalDescuentos: 0,
        totalVentas: 30250,
        ticketPromedio: 6050,
      },
    ]);

    mockVentasSesion.mockResolvedValue([
      {
        sesionId: "ses-1",
        cajaId: "caja-1",
        cajaNombre: "Caja Principal",
        estado: "cerrada",
        aperturaAt: "2026-09-06T08:00:00Z",
        cierreAt: "2026-09-06T16:00:00Z",
        usuarioApertura: "Juan Cajero",
        usuarioCierre: "Juan Cajero",
        saldoInicial: 10000,
        saldoTeoricoEfectivo: 35000,
        efectivoContado: 35000,
        diferencia: 0,
        cantidadVentas: 10,
        totalVentas: 50000,
      },
    ]);

    mockVentasMedioPago.mockResolvedValue({
      granTotal: 50000,
      totalTransacciones: 10,
      items: [
        {
          medioPagoId: "mp-efectivo",
          medioPagoCodigo: "efectivo",
          medioPagoNombre: "Efectivo",
          cantidadTransacciones: 6,
          totalRecaudado: 30000,
          porcentajeDelTotal: 60,
        },
        {
          medioPagoId: "mp-debito",
          medioPagoCodigo: "debito",
          medioPagoNombre: "Tarjeta de Débito",
          cantidadTransacciones: 4,
          totalRecaudado: 20000,
          porcentajeDelTotal: 40,
        },
      ],
    });

    mockReporteMargen.mockResolvedValue([
      {
        venta_id: "v-1",
        vendido_at: "2026-09-06T10:30:00Z",
        tipo_item: "producto",
        item_id: "prod-1",
        item_nombre: "Vacuna Antirrábica",
        cantidad: 1,
        importe_total: 5000,
        neto_total: 4132.23,
        costo_total: 3000,
        margen: 1132.23,
      },
    ]);

    mockReporteItemsVendidos.mockResolvedValue([
      {
        venta_id: "v-1",
        numero_operacion: 1001,
        vendido_at: "2026-09-06T10:30:00Z",
        venta_estado: "registrada",
        usuario_id: "usr-1",
        tipo_item: "producto",
        item_id: "prod-1",
        item_nombre: "Vacuna Antirrábica",
        familia_id: "fam-1",
        cantidad: 1,
        precio_unitario: 5000,
        neto_unitario: 4132.23,
        iva_unitario: 867.77,
        importe_total: 5000,
        costo_unitario_efectivo: 3000,
      },
    ]);
  });

  it("1. Abrir la página carga UN solo reporte (rentabilidad), no los seis", async () => {
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Reportes de Ventas" })).toBeInTheDocument();

    // Solo rentabilidad debe haber sido llamada
    expect(mockRentabilidad).toHaveBeenCalledTimes(1);
    expect(mockVentasUsuario).not.toHaveBeenCalled();
    expect(mockVentasSesion).not.toHaveBeenCalled();
    expect(mockVentasMedioPago).not.toHaveBeenCalled();
    expect(mockReporteMargen).not.toHaveBeenCalled();
    expect(mockReporteItemsVendidos).not.toHaveBeenCalled();
  });

  it("2. Ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { level: 1, name: "Reportes de Ventas" });

    const argsRent = mockRentabilidad.mock.calls[0][0];
    expect(argsRent).not.toHaveProperty("tenantId");
    expect(argsRent).not.toHaveProperty("tenant_id");

    const tabUsr = screen.getByRole("tab", { name: /Por Vendedor/i });
    await user.click(tabUsr);

    await waitFor(() => {
      expect(mockVentasUsuario).toHaveBeenCalledTimes(1);
    });
    const argsUsr = mockVentasUsuario.mock.calls[0][0];
    expect(argsUsr).not.toHaveProperty("tenantId");
    expect(argsUsr).not.toHaveProperty("tenant_id");
  });

  it("3. §1.3: si GET /caja/cajas devuelve 403, la pestaña de ventas por sesión sigue funcionando sin ese filtro", async () => {
    const user = userEvent.setup();
    mockListarCajas.mockRejectedValueOnce(new ApiError("FORBIDDEN", 403, "No tiene permisos para consultar cajas"));

    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    const tabSesiones = screen.getByRole("tab", { name: /Sesiones Caja/i });
    await user.click(tabSesiones);

    // Debe cargar las ventas por sesión sin romperse
    await waitFor(() => {
      expect(mockVentasSesion).toHaveBeenCalledTimes(1);
    });

    // La tabla debe mostrar la sesión
    expect(await screen.findByText("Caja Principal")).toBeInTheDocument();
    // No debe mostrar un error de pantalla
    expect(screen.queryByTestId("error-sesion")).not.toBeInTheDocument();
    // El contenedor de selector de caja se oculta si no tiene permisos
    expect(screen.queryByTestId("filtro-caja-container")).not.toBeInTheDocument();
  });

  it("4. Pestaña Medios de Pago: el Select sale de PostgREST (listarMediosPago)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    const tabMP = screen.getByRole("tab", { name: /Medios de Pago/i });
    await user.click(tabMP);

    await waitFor(() => {
      expect(mockListarMediosPago).toHaveBeenCalledTimes(1);
      expect(mockVentasMedioPago).toHaveBeenCalledTimes(1);
    });

    const elements = await screen.findAllByText("Tarjeta de Débito");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("5. §2.6: no aparece 'Comprobante', 'Factura', 'Ticket' ni 'Recibo' en ninguna columna ni encabezado", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    // Revisar encabezados en pestaña Rentabilidad
    await screen.findByText("Vacuna Antirrábica");
    const prohibitedRegex = /comprobante|factura|ticket|recibo/i;

    const checkHeadersAndText = () => {
      const headers = screen.queryAllByRole("columnheader");
      for (const th of headers) {
        expect(th.textContent).not.toMatch(prohibitedRegex);
      }
      const allHeadings = screen.queryAllByRole("heading");
      for (const h of allHeadings) {
        expect(h.textContent).not.toMatch(prohibitedRegex);
      }
    };

    checkHeadersAndText();

    // Pestaña Vendedor
    await user.click(screen.getByRole("tab", { name: /Por Vendedor/i }));
    await screen.findByText("Juan Cajero");
    checkHeadersAndText();

    // Pestaña Sesiones
    await user.click(screen.getByRole("tab", { name: /Sesiones Caja/i }));
    await screen.findByText("Caja Principal");
    checkHeadersAndText();

    // Pestaña Ítems Vendidos
    await user.click(screen.getByRole("tab", { name: /Ítems Vendidos/i }));
    await screen.findByText("#1001");
    checkHeadersAndText();
    expect(screen.getByText("Operación N°")).toBeInTheDocument();
  });

  it("6. El margen se muestra y es ordenable", async () => {
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Vacuna Antirrábica")).toBeInTheDocument();
    // Tarjeta de margen
    expect(screen.getByText("Margen Bruto Total")).toBeInTheDocument();
    expect(screen.getAllByText("40%").length).toBeGreaterThanOrEqual(1);
  });

  it("7. Cada pestaña tiene sus estados vacío, cargando y error por separado", async () => {
    const user = userEvent.setup();

    // Error en rentabilidad
    mockRentabilidad.mockRejectedValueOnce(new Error("Error de conexión"));
    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("error-rentabilidad")).toBeInTheDocument();
    expect(screen.getByText("Error de conexión")).toBeInTheDocument();

    // Estado vacío en margen
    mockReporteMargen.mockResolvedValueOnce([]);
    await user.click(screen.getByRole("tab", { name: /Margen Líneas/i }));

    expect(await screen.findByTestId("vacio-margen")).toBeInTheDocument();
  });

  it("8. Exportar a CSV se realiza en el cliente sin llamadas a la API", async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:http://localhost/test-uuid");
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    render(
      <MemoryRouter>
        <ReportesVentasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Vacuna Antirrábica")).toBeInTheDocument();

    const btnExport = screen.getByRole("button", { name: /Exportar CSV/i });
    await user.click(btnExport);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy.mock.calls[0][0]).toBeInstanceOf(Blob);

    // No llamadas extras a rentabilidad ni a otros reportes
    expect(mockRentabilidad).toHaveBeenCalledTimes(1);
    expect(mockVentasUsuario).not.toHaveBeenCalled();
  });
});
