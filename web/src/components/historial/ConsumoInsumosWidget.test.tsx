import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsumoInsumosWidget } from "./ConsumoInsumosWidget.tsx";
import {
  disponibilidad,
  porEvento,
  registrar,
} from "../../api/comercial/consumo.ts";
import { listarProductos } from "../../api/comercial/productos.ts";
import { candidatosFefo } from "../../api/comercial/stock.ts";
import { listarDoctores } from "../../api/doctores.ts";
import { ApiError, type Producto, type LoteCandidato } from "../../types/index.ts";

const mockAuth = {
  status: "authenticated" as const,
  user: {
    id: "user-vet",
    email: "vet@leo.com",
    role: "veterinario",
    permissions: ["view_stock", "consume_stock"],
  },
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("../../api/comercial/consumo.ts", () => ({
  porEvento: vi.fn(),
  registrar: vi.fn(),
  disponibilidad: vi.fn(),
}));

vi.mock("../../api/comercial/productos.ts", () => ({
  listarProductos: vi.fn(),
}));

vi.mock("../../api/comercial/stock.ts", () => ({
  candidatosFefo: vi.fn(),
}));

vi.mock("../../api/doctores.ts", () => ({
  listarDoctores: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0 } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockPorEvento = vi.mocked(porEvento);
const mockRegistrar = vi.mocked(registrar);
const mockDisponibilidad = vi.mocked(disponibilidad);
const mockListarProductos = vi.mocked(listarProductos);
const mockCandidatosFefo = vi.mocked(candidatosFefo);

const PROD_SUERO: Producto = {
  id: "prod-suero",
  tenantId: "tenant-1",
  codigo: "SUE-500",
  nombre: "Suero Fisiológico 500ml",
  descripcion: "Solución fisiológica",
  familiaId: "fam-1",
  unidadMedidaId: "u-1",
  marca: "B.Braun",
  alicuotaIva: 21,
  condicionVenta: "libre",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: null,
  precioVenta: 1500,
  costoReposicion: 800,
  margenObjetivo: 50,
  stockMinimo: 5,
  esVendible: true,
  esConsumibleClinico: true,
  requiereFrio: false,
  trazable: false,
  codigoBarras: null,
  activo: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const LOTES_SUERO: LoteCandidato[] = [
  {
    loteId: "lote-1",
    codigoLote: "LOT-001",
    fechaVencimiento: "2027-01-01",
    fechaIngreso: "2026-01-01",
    estado: "disponible",
    costoUnitarioEfectivo: 800,
    cantidadDisponible: 10,
  },
  {
    loteId: "lote-2",
    codigoLote: "LOT-002",
    fechaVencimiento: "2027-06-01",
    fechaIngreso: "2026-01-01",
    estado: "disponible",
    costoUnitarioEfectivo: 850,
    cantidadDisponible: 10,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user.permissions = ["view_stock", "consume_stock"];
  mockPorEvento.mockResolvedValue([]);
  mockListarProductos.mockResolvedValue({
    items: [PROD_SUERO],
    meta: { page: 1, limit: 50, total: 1 },
  });
  mockDisponibilidad.mockResolvedValue([
    {
      cantidad: 20,
      lotes: {
        id: "lote-1",
        codigo_lote: "LOT-001",
        fecha_vencimiento: "2027-01-01",
        estado: "disponible",
      },
    },
  ]);
  mockCandidatosFefo.mockResolvedValue(LOTES_SUERO);
  mockRegistrar.mockResolvedValue({ operacionId: "op-1", movimientosGenerados: 1 });
});

describe("ConsumoInsumosWidget", () => {
  it("Sin view_stock, el widget no se renderiza", async () => {
    mockAuth.user.permissions = ["manage_pets", "view_medical_history"];
    const { container } = render(<ConsumoInsumosWidget historialId="hist-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(mockPorEvento).not.toHaveBeenCalled();
  });

  it("Con view_stock y sin consume_stock, se renderiza en modo lectura sin botón de registrar", async () => {
    mockAuth.user.permissions = ["view_stock", "view_medical_history"];
    mockPorEvento.mockResolvedValue([]);

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await screen.findByText(/Insumos clínicos utilizados/i);
    expect(screen.getByText(/No se registraron insumos en esta atención/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar insumos/i })).not.toBeInTheDocument();
  });

  it("Modo lectura muestra los consumos y el motivoFefo cuando lo hay", async () => {
    mockPorEvento.mockResolvedValue([
      {
        id: "mov-1",
        operacionId: "op-1",
        tipo: "consumo_clinico",
        cantidad: 2,
        cantidadConSigno: -2,
        costoUnitario: 800,
        costoTotal: 1600,
        motivo: null,
        createdAt: "2026-06-01T00:00:00Z",
        producto: { id: "prod-suero", codigo: "SUE-500", nombre: "Suero Fisiológico 500ml" },
        lote: { id: "lote-1", codigoLote: "LOT-001" },
      },
      {
        id: "mov-2",
        operacionId: "op-2",
        tipo: "consumo_clinico",
        cantidad: 1,
        cantidadConSigno: -1,
        costoUnitario: 850,
        costoTotal: 850,
        motivo: "Se seleccionó lote con vencimiento más lejano por protocolo quirúrgico",
        createdAt: "2026-06-01T00:00:00Z",
        producto: { id: "p-2", codigo: "AMX", nombre: "Amoxicilina Inyectable" },
        lote: { id: "lote-2", codigoLote: "LOT-002" },
      },
    ]);

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await screen.findByText("Suero Fisiológico 500ml");
    expect(screen.getByText("LOT-001")).toBeInTheDocument();
    expect(screen.getByText("Amoxicilina Inyectable")).toBeInTheDocument();
    expect(screen.getByText("LOT-002")).toBeInTheDocument();
    expect(
      screen.getByText(/Se seleccionó lote con vencimiento más lejano por protocolo quirúrgico/i),
    ).toBeInTheDocument();
  });

  it("RN §2.2: el primer lote candidato viene preseleccionado y marcado como sugerido", async () => {
    const user = userEvent.setup();

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await screen.findByText(/Insumos clínicos utilizados/i);
    const btnAbrir = screen.getByRole("button", { name: /Registrar insumos/i });
    await user.click(btnAbrir);

    // Esperar a que cargue el buscador y agregar producto
    const btnAgregar = await screen.findByRole("button", { name: /Agregar/i });
    await user.click(btnAgregar);

    // Esperar a que se consulten los lotes candidatos FEFO
    await waitFor(() => {
      expect(mockCandidatosFefo).toHaveBeenCalledWith({
        productoId: "prod-suero",
        cantidad: 1,
      });
    });

    // Combo muestra el primer lote preseleccionado (LOT-001)
    const loteTrigger = await screen.findByRole("combobox", {
      name: /Lote para Suero Fisiológico 500ml/i,
    });
    expect(loteTrigger).toBeInTheDocument();
    expect(within(loteTrigger).getByText("LOT-001")).toBeInTheDocument();

    // No debe haber motivo visible porque está en el sugerido
    expect(screen.queryByLabelText(/Motivo FEFO/i)).not.toBeInTheDocument();

    // Abrir combo para verificar el badge de sugerido
    await user.click(loteTrigger);
    const optionSugerido = await screen.findByRole("option", {
      name: /Sugerido \(vence antes\)/i,
    });
    expect(optionSugerido).toBeInTheDocument();
  });

  it("RN §2.2: elegir otro lote muestra motivoFefo EN EL MISMO ÍTEM y lo vuelve requerido", async () => {
    const user = userEvent.setup();

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    await user.click(await screen.findByRole("button", { name: /Agregar/i }));

    const loteTrigger = await screen.findByRole("combobox", {
      name: /Lote para Suero Fisiológico 500ml/i,
    });
    await user.click(loteTrigger);

    // Seleccionar lote 2 (no sugerido)
    const optionLot2 = await screen.findByRole("option", { name: /LOT-002/i });
    await user.click(optionLot2);

    // En el mismo ítem aparece el campo motivo requerido
    const motivoInput = await screen.findByLabelText(/Motivo FEFO para Suero Fisiológico 500ml/i);
    expect(motivoInput).toBeInTheDocument();
    expect(motivoInput).toBeRequired();
  });

  it("RN §2.2: sin motivo, el botón de registrar queda deshabilitado", async () => {
    const user = userEvent.setup();

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    await user.click(await screen.findByRole("button", { name: /Agregar/i }));

    const btnRegistrar = await screen.findByRole("button", { name: /Registrar consumo/i });
    expect(btnRegistrar).toBeEnabled();

    // Cambiar al lote 2 (no sugerido)
    const loteTrigger = await screen.findByRole("combobox", {
      name: /Lote para Suero Fisiológico 500ml/i,
    });
    await user.click(loteTrigger);
    const optionLot2 = await screen.findByRole("option", { name: /LOT-002/i });
    await user.click(optionLot2);

    // El botón queda deshabilitado sin motivo
    expect(btnRegistrar).toBeDisabled();

    // Escribir motivo
    const motivoInput = screen.getByLabelText(/Motivo FEFO para Suero Fisiológico 500ml/i);
    await user.type(motivoInput, "Lote reservado para consulta ambulatoria");

    // Vuelve a habilitarse
    expect(btnRegistrar).toBeEnabled();
  });

  it("RN §2.2: cambiar la cantidad vuelve a pedir candidatos", async () => {
    const user = userEvent.setup();

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    await user.click(await screen.findByRole("button", { name: /Agregar/i }));

    await waitFor(() => {
      expect(mockCandidatosFefo).toHaveBeenCalledWith({ productoId: "prod-suero", cantidad: 1 });
    });

    // Modificar cantidad a 4
    const cantInput = await screen.findByRole("spinbutton", {
      name: /Cantidad para Suero Fisiológico 500ml/i,
    });
    await user.clear(cantInput);
    await user.type(cantInput, "4");

    await waitFor(() => {
      expect(mockCandidatosFefo).toHaveBeenCalledWith({ productoId: "prod-suero", cantidad: 4 });
    });
  });

  it("El buscador acota a esConsumibleClinico en el cliente, sin mandar un filtro inventado", async () => {
    const user = userEvent.setup();

    mockListarProductos.mockResolvedValue({
      items: [
        PROD_SUERO,
        {
          id: "prod-shampoo",
          tenantId: "tenant-1",
          codigo: "SHA-100",
          nombre: "Shampoo Pulguicida Canino",
          descripcion: "Shampoo cosmético",
          familiaId: "fam-2",
          unidadMedidaId: "u-1",
          marca: "Canilimp",
          alicuotaIva: 21,
          condicionVenta: "libre",
          controlaLote: false,
          controlaVencimiento: false,
          vidaUtilPostAperturaDias: null,
          precioVenta: 2000,
          costoReposicion: 1000,
          margenObjetivo: 50,
          stockMinimo: 2,
          esVendible: true,
          esConsumibleClinico: false, // NO es consumible clínico
          requiereFrio: false,
          trazable: false,
          codigoBarras: null,
          activo: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      meta: { page: 1, limit: 50, total: 2 },
    });

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));

    const searchInput = await screen.findByLabelText("Buscar producto consumible");
    await user.type(searchInput, "Suero");

    await waitFor(() => {
      // La API NO recibe esConsumibleClinico
      expect(mockListarProductos).toHaveBeenCalledWith(
        expect.not.objectContaining({ esConsumibleClinico: expect.anything() }),
      );
    });

    // Muestra el consumible clínico y descarta el producto no consumible
    expect(await screen.findByText("Suero Fisiológico 500ml")).toBeInTheDocument();
    expect(screen.queryByText("Shampoo Pulguicida Canino")).not.toBeInTheDocument();
  });

  it("La disponibilidad en 0 marca el producto sin stock", async () => {
    const user = userEvent.setup();

    // Disponibilidad en 0
    mockDisponibilidad.mockResolvedValue([]);

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    const btnAgregar = await screen.findByRole("button", { name: /Agregar/i });
    await user.click(btnAgregar);

    // Debe mostrar advertencia de producto sin stock
    expect(
      await screen.findByText(/no tiene stock disponible|sin stock disponible/i),
    ).toBeInTheDocument();
  });

  it("El body NO lleva tenantId", async () => {
    const user = userEvent.setup();

    render(
      <ConsumoInsumosWidget
        historialId="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        profesionalPrescriptorId="user-vet"
      />,
    );

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    await user.click(await screen.findByRole("button", { name: /Agregar/i }));

    const btnRegistrar = await screen.findByRole("button", { name: /Registrar consumo/i });
    await user.click(btnRegistrar);

    // Verificar texto de confirmación (§1.5)
    expect(
      screen.getByText(/Se descuentan 1 unidades de 1 lotes y quedan registradas en esta atención/i),
    ).toBeInTheDocument();

    const btnConfirmar = screen.getByRole("button", { name: "Confirmar consumo" });
    await user.click(btnConfirmar);

    await waitFor(() => {
      expect(mockRegistrar).toHaveBeenCalledTimes(1);
    });

    const callPayload = mockRegistrar.mock.calls[0][0];
    expect(callPayload).not.toHaveProperty("tenantId");
    expect(callPayload.historialId).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(callPayload.items).toEqual([
      {
        productoId: "prod-suero",
        cantidad: 1,
        loteId: "lote-1",
        motivoFefo: null,
      },
    ]);
  });

  it("§2.4: el widget no muestra costo en ninguna parte", async () => {
    const user = userEvent.setup();

    mockPorEvento.mockResolvedValue([
      {
        id: "mov-1",
        operacionId: "op-1",
        tipo: "consumo_clinico",
        cantidad: 2,
        cantidadConSigno: -2,
        costoUnitario: 800,
        costoTotal: 1600,
        motivo: null,
        createdAt: "2026-06-01T00:00:00Z",
        producto: { id: "prod-suero", codigo: "SUE-500", nombre: "Suero Fisiológico 500ml" },
        lote: { id: "lote-1", codigoLote: "LOT-001" },
      },
    ]);

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await screen.findByText("Suero Fisiológico 500ml");
    expect(screen.queryByText(/costo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/precio/i)).not.toBeInTheDocument();

    // Abrir formulario de registro
    await user.click(screen.getByRole("button", { name: /Registrar insumos/i }));
    await screen.findByText(/Registrar consumo de insumos/i);

    expect(screen.queryByText(/costo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/precio/i)).not.toBeInTheDocument();
  });

  it("Cada code de error produce su mensaje y el formulario no se limpia", async () => {
    const user = userEvent.setup();

    render(<ConsumoInsumosWidget historialId="hist-1" />);

    await user.click(await screen.findByRole("button", { name: /Registrar insumos/i }));
    await user.click(await screen.findByRole("button", { name: /Agregar/i }));

    const cantInput = await screen.findByRole("spinbutton", {
      name: /Cantidad para Suero Fisiológico 500ml/i,
    });
    await user.clear(cantInput);
    await user.type(cantInput, "5");

    // 1. INSUFFICIENT_STOCK
    mockRegistrar.mockRejectedValueOnce(
      new ApiError("INSUFFICIENT_STOCK" as any, 422, "INSUFFICIENT_STOCK"),
    );
    await user.click(screen.getByRole("button", { name: /Registrar consumo/i }));
    await user.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    expect(await screen.findByText(/Stock insuficiente para realizar el consumo clínico/i)).toBeInTheDocument();
    // Formulario no se limpió: el producto y la cantidad siguen en pantalla
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();

    // 2. PRODUCT_NOT_FOUND
    mockRegistrar.mockRejectedValueOnce(
      new ApiError("PRODUCT_NOT_FOUND" as any, 404, "PRODUCT_NOT_FOUND"),
    );
    await user.click(screen.getByRole("button", { name: /Registrar consumo/i }));
    await user.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    expect(await screen.findByText(/Producto no encontrado/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();

    // 3. PRODUCT_INACTIVE
    mockRegistrar.mockRejectedValueOnce(
      new ApiError("PRODUCT_INACTIVE" as any, 422, "PRODUCT_INACTIVE"),
    );
    await user.click(screen.getByRole("button", { name: /Registrar consumo/i }));
    await user.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    expect(await screen.findByText(/El producto se encuentra inactivo/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });
});
