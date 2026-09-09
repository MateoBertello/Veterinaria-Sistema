import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReportesStockPage } from "./ReportesStockPage.tsx";
import {
  valorizacionAFecha,
  rotacion,
  fraccionamiento,
  consumoProfesional,
  consumoEspecie,
} from "../api/comercial/reportes.ts";
import { listarFamilias, listarProductos } from "../api/comercial/productos.ts";
import { listarDoctores } from "../api/doctores.ts";
import { listarEspecies } from "../api/catalogos.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: {
    id: "user-1",
    email: "vet@leo.com",
    role: "veterinario",
    permissions: ["view_stock"],
  },
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../api/comercial/reportes.ts", () => ({
  valorizacionAFecha: vi.fn(),
  rotacion: vi.fn(),
  fraccionamiento: vi.fn(),
  reporteFraccionamiento: vi.fn(),
  consumoProfesional: vi.fn(),
  consumoEspecie: vi.fn(),
}));

vi.mock("../api/comercial/productos.ts", () => ({
  listarFamilias: vi.fn(),
  listarProductos: vi.fn(),
}));

vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn(),
}));

vi.mock("../api/catalogos.ts", () => ({
  listarEspecies: vi.fn(),
}));

const mockValorizacion = vi.mocked(valorizacionAFecha);
const mockRotacion = vi.mocked(rotacion);
const mockFraccionamiento = vi.mocked(fraccionamiento);
const mockConsumoProfesional = vi.mocked(consumoProfesional);
const mockConsumoEspecie = vi.mocked(consumoEspecie);

const mockListarFamilias = vi.mocked(listarFamilias);
const mockListarProductos = vi.mocked(listarProductos);
const mockListarDoctores = vi.mocked(listarDoctores);
const mockListarEspecies = vi.mocked(listarEspecies);

describe("ReportesStockPage (F8·T1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListarFamilias.mockResolvedValue({
      items: [
        { id: "fam-1", tenantId: "tenant-1", nombre: "Antibióticos", unidadBaseId: "u-1", activo: true, createdAt: "" },
      ],
      meta: { page: 1, limit: 100, total: 1 },
    });

    mockListarProductos.mockResolvedValue({
      items: [
        {
          id: "prod-1",
          tenantId: "tenant-1",
          codigo: "MED-001",
          nombre: "Amoxicilina 500mg",
          descripcion: null,
          familiaId: "fam-1",
          unidadMedidaId: "u-1",
          marca: null,
          alicuotaIva: 21,
          condicionVenta: "libre",
          controlaLote: true,
          controlaVencimiento: true,
          vidaUtilPostAperturaDias: null,
          precioVenta: 2500,
          costoReposicion: 1500,
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

    mockListarDoctores.mockResolvedValue({
      items: [
        {
          id: "doc-1",
          userId: "usr-doc-1",
          name: "Dra. Laura Vet",
          specialty: "Cirugía",
          licenseNumber: "MP-1234",
          available: true,
          createdAt: "",
          usuario: null,
        },
      ],
      meta: { page: 1, limit: 100, total: 1 },
    });

    mockListarEspecies.mockResolvedValue([
      { id: "esp-1", name: "Canino" },
      { id: "esp-2", name: "Felino" },
    ]);

    mockValorizacion.mockResolvedValue({
      fechaCorte: "2026-09-06T00:00:00Z",
      totalLineas: 1,
      totalUnidades: 50,
      valorizacionTotal: 75000,
      items: [
        {
          loteId: "lote-1",
          codigoLote: "LOT-A1",
          fechaVencimiento: "2027-01-01",
          productoId: "prod-1",
          productoCodigo: "MED-001",
          productoNombre: "Amoxicilina 500mg",
          familiaId: "fam-1",
          familiaNombre: "Antibióticos",
          unidadMedida: "comp",
          cantidadAFecha: 50,
          costoUnitarioEfectivo: 1500,
          valorTotal: 75000,
        },
      ],
    });

    mockRotacion.mockResolvedValue({
      diasLimite: 30,
      totalProductos: 1,
      totalSinMovimiento: 1,
      capitalInmovilizadoTotal: 75000,
      items: [
        {
          productoId: "prod-1",
          codigo: "MED-001",
          nombre: "Amoxicilina 500mg",
          familiaId: "fam-1",
          familiaNombre: "Antibióticos",
          stockActual: 50,
          costoReposicion: 1500,
          valorInmovilizado: 75000,
          ultimoMovimientoAt: null,
          diasSinMovimiento: 999,
          sinMovimiento: true,
          totalSalidasPeriodo: 0,
        },
      ],
    });

    mockFraccionamiento.mockResolvedValue([
      {
        operacion_id: "op-1",
        producto_origen_id: "prod-orig",
        producto_destino_id: "prod-dest",
        producto_origen_nombre: "Frasco Gotas 100ml",
        producto_destino_nombre: "Jeringa 10ml",
        cantidad_origen: 1,
        factor_teorico: 10,
        cantidad_teorica: 10,
        cantidad_obtenida: 9,
        merma: 1,
        costo_consumido: 5000,
        costo_unitario_hijo: 555.55,
        sobrecosto: 555.55,
        fraccionado_at: "2026-09-01T10:00:00Z",
      },
    ]);

    mockConsumoProfesional.mockResolvedValue([
      {
        profesionalId: "usr-doc-1",
        profesionalNombre: "Dra. Laura Vet",
        cantidadConsumos: 4,
        unidadesConsumidas: 12,
        costoTotalInsumos: 18000,
      },
    ]);

    mockConsumoEspecie.mockResolvedValue([
      {
        especieId: "esp-1",
        especieNombre: "Canino",
        cantidadConsumos: 8,
        unidadesConsumidas: 24,
        costoTotalInsumos: 36000,
      },
    ]);
  });

  it("1. Abrir la página carga UN solo reporte (valorización), no los cinco", async () => {
    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Reportes de Stock" })).toBeInTheDocument();

    // Solo valorización debe haber sido llamada
    expect(mockValorizacion).toHaveBeenCalledTimes(1);
    expect(mockRotacion).not.toHaveBeenCalled();
    expect(mockFraccionamiento).not.toHaveBeenCalled();
    expect(mockConsumoProfesional).not.toHaveBeenCalled();
    expect(mockConsumoEspecie).not.toHaveBeenCalled();
  });

  it("2. Ningún request lleva tenantId", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { level: 1, name: "Reportes de Stock" });

    // Verificar llamada de valorización
    const argsVal = mockValorizacion.mock.calls[0][0];
    expect(argsVal).not.toHaveProperty("tenantId");
    expect(argsVal).not.toHaveProperty("tenant_id");

    // Pasar a rotación
    const tabRotacion = screen.getByRole("tab", { name: /Rotación/i });
    await user.click(tabRotacion);

    await waitFor(() => {
      expect(mockRotacion).toHaveBeenCalledTimes(1);
    });
    const argsRot = mockRotacion.mock.calls[0][0];
    expect(argsRot).not.toHaveProperty("tenantId");
    expect(argsRot).not.toHaveProperty("tenant_id");
  });

  it("3. Pestaña Rotación: diasSinMovimiento arranca en 30", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    const tabRotacion = screen.getByRole("tab", { name: /Rotación/i });
    await user.click(tabRotacion);

    await waitFor(() => {
      expect(mockRotacion).toHaveBeenCalledWith(
        expect.objectContaining({ diasSinMovimiento: 30 }),
      );
    });

    const inputDias = screen.getByLabelText(/Días sin movimiento/i);
    expect(inputDias).toHaveValue(30);
  });

  it("4. Pestaña Consumo por Especie: el Select de especies sale de PostgREST (listarEspecies)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    const tabEspecie = screen.getByRole("tab", { name: /Por Especie/i });
    await user.click(tabEspecie);

    await waitFor(() => {
      expect(mockListarEspecies).toHaveBeenCalledTimes(1);
      expect(mockConsumoEspecie).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Canino")).toBeInTheDocument();
  });

  it("5. Pestaña Consumo por Profesional: lista profesionales desde listarDoctores", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    const tabProf = screen.getByRole("tab", { name: /Por Profesional/i });
    await user.click(tabProf);

    await waitFor(() => {
      expect(mockListarDoctores).toHaveBeenCalledTimes(1);
      expect(mockConsumoProfesional).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Dra. Laura Vet")).toBeInTheDocument();
  });

  it("6. Cada pestaña maneja sus estados cargando, vacío y error por separado", async () => {
    const user = userEvent.setup();

    // 6a. Valorización: Error
    mockValorizacion.mockRejectedValueOnce(new Error("Fallo de red en valorización"));
    const { rerender } = render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("error-valorizacion")).toBeInTheDocument();
    expect(screen.getByText("Fallo de red en valorización")).toBeInTheDocument();

    // 6b. Valorización: Vacío
    mockValorizacion.mockResolvedValueOnce({
      fechaCorte: "2026-09-06T00:00:00Z",
      totalLineas: 0,
      totalUnidades: 0,
      valorizacionTotal: 0,
      items: [],
    });

    const btnReintentar = screen.getByRole("button", { name: /Reintentar/i });
    await user.click(btnReintentar);

    expect(await screen.findByTestId("vacio-valorizacion")).toBeInTheDocument();

    // 6c. Rotación: Vacío
    mockRotacion.mockResolvedValueOnce({
      diasLimite: 30,
      totalProductos: 0,
      totalSinMovimiento: 0,
      capitalInmovilizadoTotal: 0,
      items: [],
    });

    const tabRotacion = screen.getByRole("tab", { name: /Rotación/i });
    await user.click(tabRotacion);

    expect(await screen.findByTestId("vacio-rotacion")).toBeInTheDocument();

    // 6d. Fraccionamiento: Error
    mockFraccionamiento.mockRejectedValueOnce(new Error("Error al obtener fraccionamientos"));
    const tabFracc = screen.getByRole("tab", { name: /Mermas Fracc/i });
    await user.click(tabFracc);

    expect(await screen.findByTestId("error-fraccionamiento")).toBeInTheDocument();
  });

  it("7. Exportar a CSV se realiza en el cliente sin llamar a endpoints binarios", async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:http://localhost/test-uuid");
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    render(
      <MemoryRouter>
        <ReportesStockPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    const btnExport = screen.getByRole("button", { name: /Exportar CSV/i });
    await user.click(btnExport);

    // Debe haber invocado createObjectURL con un blob
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);

    // No debe haber llamado a ningún endpoint adicional
    expect(mockValorizacion).toHaveBeenCalledTimes(1);
    expect(mockRotacion).not.toHaveBeenCalled();
  });
});
