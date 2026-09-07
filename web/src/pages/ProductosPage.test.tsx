import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProductosPage } from "./ProductosPage.tsx";
import * as productosApi from "../api/comercial/productos.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import { ApiError, type ApiMeta, type Familia, type Producto, type UnidadMedida } from "../types/index.ts";

const MOCK_FAMILIAS: Familia[] = [
  {
    id: "fam-1",
    tenantId: "tenant-1",
    nombre: "Farmacia",
    unidadBaseId: "uni-1",
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "fam-2",
    tenantId: "tenant-1",
    nombre: "Alimentos",
    unidadBaseId: "uni-2",
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const MOCK_UNIDADES: UnidadMedida[] = [
  {
    id: "uni-1",
    codigo: "COMP",
    nombre: "Comprimido",
    abreviatura: "comp",
    admite_decimales: false,
    escala_decimal: 0,
  },
  {
    id: "uni-2",
    codigo: "KG",
    nombre: "Kilogramo",
    abreviatura: "kg",
    admite_decimales: true,
    escala_decimal: 2,
  },
];

const MOCK_PRODUCTOS: Producto[] = [
  {
    id: "prod-1",
    tenantId: "tenant-1",
    codigo: "AMOX-500",
    nombre: "Amoxicilina 500mg",
    descripcion: "Antibiótico bactericida de amplio espectro",
    familiaId: "fam-1",
    unidadMedidaId: "uni-1",
    marca: "Richmond",
    alicuotaIva: 21,
    condicionVenta: "libre",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: 30,
    precioVenta: 1500,
    costoReposicion: 1000,
    margenObjetivo: 50,
    stockMinimo: 10,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: false,
    trazable: false,
    codigoBarras: "7791234567890",
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "prod-2",
    tenantId: "tenant-1",
    codigo: "IVER-GOTAS",
    nombre: "Ivermectina Gotas",
    descripcion: null,
    familiaId: "fam-1",
    unidadMedidaId: "uni-1",
    marca: null,
    alicuotaIva: 10.5,
    condicionVenta: "bajo_receta",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    precioVenta: null, // Sin precio cargado
    costoReposicion: null,
    margenObjetivo: null,
    stockMinimo: null,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: true,
    trazable: true,
    codigoBarras: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "prod-3",
    tenantId: "tenant-1",
    codigo: "ALIM-PREM",
    nombre: "Alimento Perro Adulto 15kg",
    descripcion: null,
    familiaId: "fam-2",
    unidadMedidaId: "uni-2",
    marca: "Royal Canin",
    alicuotaIva: 21,
    condicionVenta: "libre",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    precioVenta: 18000,
    costoReposicion: 10000,
    margenObjetivo: 80,
    stockMinimo: 5,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: false,
    trazable: false,
    codigoBarras: null,
    activo: false, // Dado de baja
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const mockAuth = {
  user: {
    id: "user-1",
    email: "admin@demo.local",
    fullName: "Admin Demo",
    roleName: "admin",
    permissions: ["view_stock", "manage_products", "view_sales"],
  },
};

vi.mock("../auth/AuthContext.tsx", () => ({
  useAuth: () => mockAuth,
}));

describe("ProductosPage (F1·T2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuth.user = {
      id: "user-1",
      email: "admin@demo.local",
      fullName: "Admin Demo",
      roleName: "admin",
      permissions: ["view_stock", "manage_products", "view_sales"],
    };

    vi.spyOn(catalogosComercialApi, "listarUnidadesMedida").mockResolvedValue(MOCK_UNIDADES);
    vi.spyOn(productosApi, "listarFamilias").mockResolvedValue({
      items: MOCK_FAMILIAS,
      meta: { page: 1, limit: 100, total: 2 },
    });
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: MOCK_PRODUCTOS,
      meta: { page: 1, limit: 20, total: 3 },
    });
    vi.spyOn(productosApi, "crearProducto").mockResolvedValue(MOCK_PRODUCTOS[0]!);
    vi.spyOn(productosApi, "actualizarProducto").mockResolvedValue(MOCK_PRODUCTOS[0]!);
    vi.spyOn(productosApi, "cambiarEstadoProducto").mockResolvedValue(MOCK_PRODUCTOS[0]!);
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <ProductosPage />
      </MemoryRouter>,
    );
  }

  it("renderiza el título de la página y el listado de productos", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Catálogo de Productos" })).toBeInTheDocument();
    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();
    expect(screen.getByText("Ivermectina Gotas")).toBeInTheDocument();
    expect(screen.getByText("Alimento Perro Adulto 15kg")).toBeInTheDocument();
  });

  it("estados vacío, cargando y error", async () => {
    // 1. Cargando
    let resolverProductos: (v: { items: Producto[]; meta: ApiMeta }) => void = () => {};
    vi.spyOn(productosApi, "listarProductos").mockReturnValueOnce(
      new Promise((resolve) => {
        resolverProductos = resolve;
      }),
    );
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    // Resolver con lista vacía
    resolverProductos({ items: [], meta: { page: 1, limit: 20, total: 0 } });
    expect(await screen.findByText("No hay productos registrados en el catálogo.")).toBeInTheDocument();

    // 2. Error con botón reintentar
    vi.spyOn(productosApi, "listarProductos").mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", 500, "Error del servidor al listar productos"),
    );
    const user = userEvent.setup();
    renderPage();

    const alertMsg = await screen.findByRole("alert");
    expect(alertMsg).toHaveTextContent("Error del servidor al listar productos");

    const reintentarBtn = screen.getByRole("button", { name: /Reintentar/i });
    expect(reintentarBtn).toBeInTheDocument();

    // Reintentar exitoso
    vi.spyOn(productosApi, "listarProductos").mockResolvedValueOnce({
      items: MOCK_PRODUCTOS,
      meta: { page: 1, limit: 20, total: 3 },
    });
    await user.click(reintentarBtn);
    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();
  });

  it("los filtros arman el query string correcto y el de búsqueda hace debounce", async () => {
    renderPage();
    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Inicia llamando a listarProductos con defaults
    expect(productosApi.listarProductos).toHaveBeenCalledWith({
      search: undefined,
      familiaId: undefined,
      activo: undefined,
      vendible: undefined,
      page: 1,
      limit: 20,
    });

    const user = userEvent.setup();

    // 1. Debounce en búsqueda
    const inputBusqueda = screen.getByLabelText("Buscar productos");
    await user.type(inputBusqueda, "Amoxi");

    // Esperar a que pase el debounce de 300ms
    await waitFor(
      () => {
        expect(productosApi.listarProductos).toHaveBeenCalledWith(
          expect.objectContaining({
            search: "Amoxi",
            page: 1,
          }),
        );
      },
      { timeout: 1000 },
    );

    // 2. Switch "Solo vendibles"
    const switchVendibles = screen.getByLabelText("Solo vendibles");
    await user.click(switchVendibles);

    await waitFor(() => {
      expect(productosApi.listarProductos).toHaveBeenCalledWith(
        expect.objectContaining({
          vendible: true,
          page: 1,
        }),
      );
    });
  });

  it("si hay productos sin precio, avisa cuántos y ofrece la carga en tanda", async () => {
    renderPage();

    const aviso = await screen.findByRole("status", { name: /productos sin precio/i });
    // MOCK_PRODUCTOS trae exactamente uno con precioVenta: null.
    expect(aviso).toHaveTextContent(/1 producto sin precio/i);

    const enlace = within(aviso).getByRole("link", { name: /cargarlos en tanda/i });
    expect(enlace).toHaveAttribute("href", "/stock/productos/precios");
  });

  it("si todos los productos tienen precio, el aviso no se muestra", async () => {
    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: MOCK_PRODUCTOS.map((p) => ({ ...p, precioVenta: p.precioVenta ?? 999 })),
      meta: { page: 1, limit: 20, total: 3 },
    });

    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Catálogo de Productos" });
    expect(screen.queryByRole("status", { name: /productos sin precio/i })).not.toBeInTheDocument();
  });

  it("un producto con precioVenta: null muestra el badge 'Sin precio'", async () => {
    renderPage();
    expect(await screen.findByText("Ivermectina Gotas")).toBeInTheDocument();

    // prod-2 tiene precioVenta: null
    const badgeSinPrecio = screen.getByText("Sin precio");
    expect(badgeSinPrecio).toBeInTheDocument();
    expect(badgeSinPrecio.className).toMatch(/amber/);
  });

  it("muestra badge para condición de venta distinta de 'libre'", async () => {
    renderPage();
    expect(await screen.findByText("Ivermectina Gotas")).toBeInTheDocument();

    // prod-2 es 'bajo_receta'
    expect(screen.getByText("Bajo receta")).toBeInTheDocument();
  });

  it("el nombre de la familia y el de la unidad salen del Map: con 20 filas, la cantidad de fetch es constante", async () => {
    // Creamos 20 productos de prueba que usan fam-1 y uni-1
    const muchosProductos: Producto[] = Array.from({ length: 20 }, (_, i) => ({
      ...MOCK_PRODUCTOS[0]!,
      id: `p-${i}`,
      codigo: `COD-${i}`,
      nombre: `Producto ${i}`,
    }));

    vi.spyOn(productosApi, "listarProductos").mockResolvedValueOnce({
      items: muchosProductos,
      meta: { page: 1, limit: 20, total: 20 },
    });

    renderPage();
    expect(await screen.findByText("Producto 0")).toBeInTheDocument();

    // Todos resolvieron el nombre de familia y abreviatura de unidad mediante el Map
    expect(screen.getAllByText("Farmacia").length).toBe(20);
    expect(screen.getAllByText("comp").length).toBe(20);

    // La cantidad de llamadas a listarFamilias y listarUnidadesMedida es exactamente 1 en total
    expect(productosApi.listarFamilias).toHaveBeenCalledTimes(1);
    expect(catalogosComercialApi.listarUnidadesMedida).toHaveBeenCalledTimes(1);
  });

  it("Alta: manda exactamente los campos del schema, ninguno de más, y ningún tenantId", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Abrir formulario
    const btnNuevo = screen.getByRole("button", { name: /Nuevo producto/i });
    await user.click(btnNuevo);

    expect(await screen.findByRole("heading", { name: "Nuevo producto" })).toBeInTheDocument();

    // Completar campos obligatorios
    await user.type(screen.getByLabelText(/Código \*/i), "AMOX-CLAV");
    await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina + Clavulánico");
    await user.type(screen.getByLabelText(/Precio final \(IVA incluido\)/i), "2500");
    await user.type(screen.getByLabelText(/Costo de reposición/i), "1800");
    await user.type(screen.getByLabelText(/Margen objetivo \(%\)/i), "38.8");
    await user.type(screen.getByLabelText(/Stock mínimo/i), "10");

    // Guardar
    const btnGuardar = screen.getByRole("button", { name: /Crear producto/i });
    await user.click(btnGuardar);

    await waitFor(() => {
      expect(productosApi.crearProducto).toHaveBeenCalledTimes(1);
    });

    const callArg = (productosApi.crearProducto as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Record<string, unknown>;

    // Verificamos que ningún tenantId fue enviado
    expect(callArg).not.toHaveProperty("tenantId");

    // Verificamos que los valores coinciden exactamente con los 20 campos de CrearProductoSchema
    expect(callArg).toEqual({
      codigo: "AMOX-CLAV",
      nombre: "Amoxicilina + Clavulánico",
      descripcion: null,
      familiaId: null,
      unidadMedidaId: "uni-1", // Primera unidad por default
      marca: null,
      alicuotaIva: 21,
      condicionVenta: "libre",
      controlaLote: true,
      controlaVencimiento: true,
      vidaUtilPostAperturaDias: null,
      precioVenta: 2500,
      costoReposicion: 1800,
      margenObjetivo: 38.8,
      stockMinimo: 10,
      esVendible: true,
      esConsumibleClinico: false,
      requiereFrio: false,
      trazable: false,
      codigoBarras: null,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Validación del formulario de producto — validar() (ProductosPage.tsx:688).
  // Cada caso asserta el mensaje visible y que no se llamó a la API de escritura.
  // ───────────────────────────────────────────────────────────────────────────
  describe("validación del formulario de producto", () => {
    type Usuario = ReturnType<typeof userEvent.setup>;

    async function abrirFormulario(user: Usuario) {
      renderPage();
      expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Nuevo producto/i }));
      expect(
        await screen.findByRole("heading", { name: "Nuevo producto" }),
      ).toBeInTheDocument();
    }

    async function guardar(user: Usuario) {
      await user.click(screen.getByRole("button", { name: /Crear producto/i }));
    }

    function noGuardo() {
      expect(productosApi.crearProducto).not.toHaveBeenCalled();
      expect(productosApi.actualizarProducto).not.toHaveBeenCalled();
    }

    it("código vacío: 'El código es obligatorio' y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina 500mg");
      await guardar(user);

      expect(await screen.findByText("El código es obligatorio")).toBeInTheDocument();
      noGuardo();
    });

    it("código de más de 50 caracteres: muestra el límite y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      fireEvent.change(screen.getByLabelText(/Código \*/i), {
        target: { value: "C".repeat(51) },
      });
      await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina 500mg");
      await guardar(user);

      expect(
        await screen.findByText("El código no puede superar 50 caracteres"),
      ).toBeInTheDocument();
      noGuardo();
    });

    it("nombre de menos de 3 caracteres: muestra el mínimo y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Código \*/i), "AMOX-500");
      await user.type(screen.getByLabelText(/Nombre \*/i), "Am");
      await guardar(user);

      expect(
        await screen.findByText("El nombre debe tener al menos 3 caracteres"),
      ).toBeInTheDocument();
      noGuardo();
    });

    it("nombre de más de 150 caracteres: muestra el límite y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Código \*/i), "AMOX-500");
      fireEvent.change(screen.getByLabelText(/Nombre \*/i), {
        target: { value: "N".repeat(151) },
      });
      await guardar(user);

      expect(
        await screen.findByText("El nombre no puede superar 150 caracteres"),
      ).toBeInTheDocument();
      noGuardo();
    });

    it("descripción de más de 500 caracteres: muestra el límite y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Código \*/i), "AMOX-500");
      await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina 500mg");
      fireEvent.change(screen.getByLabelText(/Descripción/i), {
        target: { value: "D".repeat(501) },
      });
      await guardar(user);

      expect(
        await screen.findByText("La descripción no puede superar 500 caracteres"),
      ).toBeInTheDocument();
      noGuardo();
    });

    it("margen objetivo por encima de 999.99: muestra el rango y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Código \*/i), "AMOX-500");
      await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina 500mg");
      fireEvent.change(screen.getByLabelText(/Margen objetivo \(%\)/i), {
        target: { value: "1000" },
      });
      await guardar(user);

      expect(
        await screen.findByText("El margen objetivo debe estar entre 0 y 999.99%"),
      ).toBeInTheDocument();
      noGuardo();
    });

    it("margen objetivo negativo: muestra el rango y no guarda", async () => {
      const user = userEvent.setup();
      await abrirFormulario(user);

      await user.type(screen.getByLabelText(/Código \*/i), "AMOX-500");
      await user.type(screen.getByLabelText(/Nombre \*/i), "Amoxicilina 500mg");
      fireEvent.change(screen.getByLabelText(/Margen objetivo \(%\)/i), {
        target: { value: "-5" },
      });
      await guardar(user);

      expect(
        await screen.findByText("El margen objetivo debe estar entre 0 y 999.99%"),
      ).toBeInTheDocument();
      noGuardo();
    });
  });

  it("el label del precio dice 'IVA incluido' (regla §2.5)", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    const btnNuevo = screen.getByRole("button", { name: /Nuevo producto/i });
    await user.click(btnNuevo);

    // El label debe tener el texto 'IVA incluido'
    const labelPrecio = await screen.findByText(/Precio final \(IVA incluido\)/i);
    expect(labelPrecio).toBeInTheDocument();
  });

  it("RN §2.4: el margen se muestra si la sesión tiene view_sales", async () => {
    // Sesión CON view_sales
    mockAuth.user.permissions = ["view_stock", "manage_products", "view_sales"];
    renderPage();

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // prod-1: precio 1500, costo 1000 -> margen (1500-1000)/1000 = 50.0%
    expect(screen.getByText(/Margen: 50\.0%/i)).toBeInTheDocument();
  });

  it("RN §2.4: el margen no se renderiza sin view_sales", async () => {
    // Sesión SIN view_sales (ej. recepcionista)
    mockAuth.user.permissions = ["view_stock", "manage_products"];
    renderPage();

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // El margen NO se renderiza
    expect(screen.queryByText(/Margen/i)).not.toBeInTheDocument();
  });

  it("RN §2.1: la baja pide confirmación y el error del backend queda dentro del diálogo", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Click en botón dar de baja de Amoxicilina (primer producto)
    const btnBaja = screen.getByLabelText("Dar de baja Amoxicilina 500mg");
    await user.click(btnBaja);

    // Abre el diálogo de confirmación con el texto normativo
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        /«Amoxicilina 500mg» deja de ofrecerse en ventas nuevas y en el mostrador\. Los lotes y las ventas que ya lo usan lo siguen mostrando\./i,
      ),
    ).toBeInTheDocument();

    // Simulamos fallo del backend
    vi.spyOn(productosApi, "cambiarEstadoProducto").mockRejectedValueOnce(
      new ApiError("PRODUCT_IN_USE", 409, "El producto tiene existencias en lotes activos"),
    );

    // Click en confirmar dentro del diálogo
    const btnConfirmar = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Dar de baja" });
    await user.click(btnConfirmar);

    // El error queda dentro del diálogo (con role="alert") y el diálogo NO se cierra
    const alertError = await screen.findByRole("alert");
    expect(alertError).toHaveTextContent("El producto tiene existencias en lotes activos");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("reactivar producto inactivo llama directamente a cambiarEstadoProducto sin diálogo", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Alimento Perro Adulto 15kg")).toBeInTheDocument();

    // prod-3 está inactivo, su botón dice 'Reactivar'
    const btnReactivar = screen.getByLabelText("Reactivar Alimento Perro Adulto 15kg");
    await user.click(btnReactivar);

    // No abre alertdialog y llama directamente al API con activo: true
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(productosApi.cambiarEstadoProducto).toHaveBeenCalledWith("prod-3", true);
  });

  it("no aparece la palabra 'Comprobante', 'Factura', 'Ticket' ni 'Recibo' en ningún lado", async () => {
    const { container } = renderPage();
    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    const textoCompleto = container.textContent ?? "";
    expect(textoCompleto).not.toMatch(/comprobante|factura|ticket|recibo/i);
  });

  it("camino real contra la capa de transporte: ejercita apiClientList y buildQuery", async () => {
    // Restaurar los mocks del módulo productosApi para que use las funciones reales
    vi.restoreAllMocks();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/familias-producto")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: MOCK_FAMILIAS, meta: { total: 2, page: 1, limit: 100 } }),
        });
      }
      if (url.includes("/rest/v1/unidades_medida")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_UNIDADES,
        });
      }
      if (url.includes("/api/v1/productos")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [
              {
                ...MOCK_PRODUCTOS[0]!,
                nombre: "Producto Real Transporte HTTP",
              },
            ],
            meta: { total: 1, page: 1, limit: 20 },
          }),
        });
      }
      return Promise.reject(new Error("URL no manejada: " + url));
    });

    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sb-token", "jwt-de-prueba");

    renderPage();

    // Comprueba que el componente realizó la llamada real por apiClientList,
    // desempaquetó el envelope success: true y pintó los datos
    expect(await screen.findByText("Producto Real Transporte HTTP")).toBeInTheDocument();

    // Verificamos que fetch se llamó con el path relativo y query construida por la API real
    const llamadaProductos = fetchMock.mock.calls.find((call: unknown[]) => typeof call[0] === "string" && call[0].includes("/productos"));
    expect(llamadaProductos).toBeDefined();
    expect((llamadaProductos as unknown[])[0]).toMatch(/\/api\/v1\/productos\?page=1&limit=20/);

    vi.unstubAllGlobals();
  });
});
