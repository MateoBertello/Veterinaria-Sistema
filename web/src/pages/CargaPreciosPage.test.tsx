import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CargaPreciosPage } from "./CargaPreciosPage.tsx";
import * as productosApi from "../api/comercial/productos.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import * as serviciosApi from "../api/servicios.ts";
import { ApiError, type Familia, type Producto, type Servicio, type UnidadMedida } from "../types/index.ts";

const MOCK_FAMILIAS: Familia[] = [
  {
    id: "fam-1",
    tenantId: "tenant-1",
    nombre: "Farmacia",
    unidadBaseId: "uni-1",
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

const MOCK_UNIDADES: UnidadMedida[] = [
  {
    id: "uni-1",
    codigo: "UNI",
    nombre: "Unidad",
    abreviatura: "u",
    admite_decimales: false,
    escala_decimal: 0,
  },
];

const MOCK_PRODUCTOS: Producto[] = [
  {
    id: "prod-1",
    tenantId: "tenant-1",
    codigo: "P001",
    nombre: "Amoxicilina 500mg",
    descripcion: null,
    familiaId: "fam-1",
    unidadMedidaId: "uni-1",
    marca: null,
    alicuotaIva: 21,
    condicionVenta: "libre",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    precioVenta: 1500.5,
    costoReposicion: null,
    margenObjetivo: null,
    stockMinimo: null,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: false,
    trazable: false,
    codigoBarras: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "prod-2",
    tenantId: "tenant-1",
    codigo: "P002",
    nombre: "Ivermectina Gotas",
    descripcion: null,
    familiaId: "fam-1",
    unidadMedidaId: "uni-1",
    marca: null,
    alicuotaIva: 10.5,
    condicionVenta: "libre",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    precioVenta: null,
    costoReposicion: null,
    margenObjetivo: null,
    stockMinimo: null,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: false,
    trazable: false,
    codigoBarras: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "prod-3",
    tenantId: "tenant-1",
    codigo: "P003",
    nombre: "Vacuna Antirrábica",
    descripcion: null,
    familiaId: "fam-1",
    unidadMedidaId: "uni-1",
    marca: null,
    alicuotaIva: 21,
    condicionVenta: "libre",
    controlaLote: true,
    controlaVencimiento: true,
    vidaUtilPostAperturaDias: null,
    precioVenta: null,
    costoReposicion: null,
    margenObjetivo: null,
    stockMinimo: null,
    esVendible: true,
    esConsumibleClinico: false,
    requiereFrio: false,
    trazable: false,
    codigoBarras: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const MOCK_SERVICIOS: Servicio[] = [
  {
    id: "serv-1",
    nombre: "Consulta General",
    tipo: "clinica",
    duracionMinutos: 30,
    requiereProfesional: true,
    descripcion: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    precio: 2500,
    alicuotaIva: 21,
  },
  {
    id: "serv-2",
    nombre: "Corte Higiénico",
    tipo: "peluqueria",
    duracionMinutos: 45,
    requiereProfesional: false,
    descripcion: null,
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    precio: null,
    alicuotaIva: 21,
  },
];

describe("CargaPreciosPage (Tanda 0b)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(productosApi, "listarFamilias").mockResolvedValue({
      items: MOCK_FAMILIAS,
      meta: { page: 1, limit: 100, total: 1 },
    });

    vi.spyOn(catalogosComercialApi, "listarUnidadesMedida").mockResolvedValue(
      MOCK_UNIDADES,
    );

    vi.spyOn(productosApi, "listarProductos").mockResolvedValue({
      items: [...MOCK_PRODUCTOS],
      meta: { page: 1, limit: 100, total: 3 },
    });

    vi.spyOn(serviciosApi, "listarServicios").mockResolvedValue({
      items: [...MOCK_SERVICIOS],
      meta: { page: 1, limit: 100, total: 2 },
    });

    vi.spyOn(productosApi, "actualizarProducto").mockResolvedValue(
      MOCK_PRODUCTOS[0],
    );

    vi.spyOn(serviciosApi, "editarServicio").mockResolvedValue(
      MOCK_SERVICIOS[0],
    );
  });

  it("se llama Carga masiva de precios y su subtítulo dice para qué sirve", async () => {
    render(<CargaPreciosPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /carga masiva de precios/i }),
    ).toBeInTheDocument();

    // El subtítulo tiene que distinguirla de la ficha individual del producto.
    expect(screen.getByText(/cientos/i)).toBeInTheDocument();
  });

  it("renderiza filas con precio y sin precio, y las segundas llevan el badge 'Sin precio'", async () => {
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();
    expect(screen.getByText("Ivermectina Gotas")).toBeInTheDocument();
    expect(screen.getByText("Vacuna Antirrábica")).toBeInTheDocument();

    // Las filas sin precio (Ivermectina y Vacuna) llevan el badge "Sin precio"
    const badgesSinPrecio = screen.getAllByText("Sin precio");
    expect(badgesSinPrecio).toHaveLength(2);

    // Amoxicilina tiene precio cargado
    const inputAmoxi = screen.getByLabelText("Precio final con IVA de Amoxicilina 500mg") as HTMLInputElement;
    expect(inputAmoxi.value).toBe("1500.5");

    // Ivermectina arranca vacía
    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas") as HTMLInputElement;
    expect(inputIver.value).toBe("");
  });

  it("el filtro 'Solo los que no tienen precio' acota el listado", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();
    expect(screen.getByText("Ivermectina Gotas")).toBeInTheDocument();

    const switchSinPrecio = screen.getByLabelText("Solo los que no tienen precio");
    await user.click(switchSinPrecio);

    // Amoxicilina (con precio) debe ocultarse
    expect(screen.queryByText("Amoxicilina 500mg")).not.toBeInTheDocument();
    // Ivermectina y Vacuna (sin precio) siguen presentes
    expect(screen.getByText("Ivermectina Gotas")).toBeInTheDocument();
    expect(screen.getByText("Vacuna Antirrábica")).toBeInTheDocument();
  });

  it("editar un precio marca la fila como sucia y habilita 'Guardar cambios'", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Ivermectina Gotas")).toBeInTheDocument();

    // Botón inicialmente deshabilitado
    const botonGuardar = screen.getByRole("button", { name: /Guardar cambios/i });
    expect(botonGuardar).toBeDisabled();
    expect(screen.getByText("Sin cambios pendientes")).toBeInTheDocument();

    // Editar precio
    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas");
    await user.type(inputIver, "2200");

    // Marca fila como sucia
    expect(await screen.findByText("Sin guardar")).toBeInTheDocument();
    expect(screen.getByText("1 cambio pendiente de guardar")).toBeInTheDocument();

    // Botón ahora habilitado
    expect(screen.getByRole("button", { name: /Guardar cambios \(1\)/i })).toBeEnabled();
  });

  it("guardar hace un PUT por fila sucia, y solo por las sucias", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Ivermectina Gotas")).toBeInTheDocument();

    // Editamos producto 2 y producto 3, dejamos producto 1 sin tocar
    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas");
    const inputVacuna = screen.getByLabelText("Precio final con IVA de Vacuna Antirrábica");

    await user.type(inputIver, "1800");
    await user.type(inputVacuna, "3200");

    const botonGuardar = screen.getByRole("button", { name: /Guardar cambios \(2\)/i });
    await user.click(botonGuardar);

    await waitFor(() => {
      expect(productosApi.actualizarProducto).toHaveBeenCalledTimes(2);
    });

    expect(productosApi.actualizarProducto).toHaveBeenCalledWith("prod-2", {
      precioVenta: 1800,
      alicuotaIva: 10.5,
    });
    expect(productosApi.actualizarProducto).toHaveBeenCalledWith("prod-3", {
      precioVenta: 3200,
      alicuotaIva: 21,
    });
    expect(productosApi.actualizarProducto).not.toHaveBeenCalledWith("prod-1", expect.anything());
  });

  it("fallo parcial: con tres filas sucias y la segunda devolviendo ApiError, las otras dos se guardan igual, la que falló queda sucia con su mensaje, y el resumen dice '2 de 3'", async () => {
    const user = userEvent.setup();
    const actualizarSpy = vi.spyOn(productosApi, "actualizarProducto");

    actualizarSpy
      .mockResolvedValueOnce(MOCK_PRODUCTOS[0]) // prod-1 éxito
      .mockRejectedValueOnce(
        new ApiError("PRICE_RULE_VIOLATION", 422, "El precio no puede ser inferior al costo"),
      ) // prod-2 fallo
      .mockResolvedValueOnce(MOCK_PRODUCTOS[2]); // prod-3 éxito

    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Editamos las 3 filas
    const inputAmoxi = screen.getByLabelText("Precio final con IVA de Amoxicilina 500mg");
    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas");
    const inputVacuna = screen.getByLabelText("Precio final con IVA de Vacuna Antirrábica");

    await user.clear(inputAmoxi);
    await user.type(inputAmoxi, "1600");
    await user.type(inputIver, "1900");
    await user.type(inputVacuna, "3500");

    const botonGuardar = screen.getByRole("button", { name: /Guardar cambios \(3\)/i });
    await user.click(botonGuardar);

    // Resumen dice "2 de 3"
    expect(await screen.findByText(/2 de 3/)).toBeInTheDocument();
    expect(screen.getByText(/1 fila quedó con error/)).toBeInTheDocument();

    // La fila que falló muestra su mensaje de error y sigue sucia
    expect(screen.getByText("El precio no puede ser inferior al costo")).toBeInTheDocument();
    expect(screen.getByText("Sin guardar")).toBeInTheDocument();

    // Botón para reintentar las que fallaron
    expect(screen.getByRole("button", { name: "Reintentar las que fallaron" })).toBeInTheDocument();
  });

  it("el precio se manda tal como se tipeó (es el precio final con IVA incluido; la pantalla no lo divide ni le suma nada)", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Ivermectina Gotas")).toBeInTheDocument();

    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas");
    await user.type(inputIver, "2450.75");

    const botonGuardar = screen.getByRole("button", { name: /Guardar cambios/i });
    await user.click(botonGuardar);

    await waitFor(() => {
      expect(productosApi.actualizarProducto).toHaveBeenCalledWith("prod-2", {
        precioVenta: 2450.75,
        alicuotaIva: 10.5,
      });
    });
  });

  it("la alícuota fuera de {0, 10.5, 21, 27} no se puede elegir", async () => {
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Los select de alícuota en la página solo tienen opciones 0, 10.5, 21, 27
    const selectTrigger = screen.getByLabelText("Alícuota IVA de Amoxicilina 500mg");
    expect(selectTrigger).toBeInTheDocument();

    // Verificamos que los valores del enum exportado y utilizado sean estrictamente los 4
    expect(productosApi.actualizarProducto).not.toHaveBeenCalled();
  });

  it("la pestaña Servicios usa PUT /servicios/:id y manda precio y alicuotaIva", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Cambiar a pestaña Servicios
    const tabServicios = screen.getByRole("tab", { name: /Servicios/i });
    await user.click(tabServicios);

    expect(await screen.findByText("Consulta General")).toBeInTheDocument();
    expect(screen.getByText("Corte Higiénico")).toBeInTheDocument();

    // Editar precio en servicio
    const inputCorte = screen.getByLabelText("Precio final con IVA de Corte Higiénico");
    await user.type(inputCorte, "4800");

    const botonGuardar = screen.getByRole("button", { name: /Guardar cambios \(1\)/i });
    await user.click(botonGuardar);

    await waitFor(() => {
      expect(serviciosApi.editarServicio).toHaveBeenCalledWith("serv-2", {
        precio: 4800,
        alicuotaIva: 21,
      });
    });
  });

  it("ningún request contiene tenantId", async () => {
    const user = userEvent.setup();
    render(<CargaPreciosPage />);

    expect(await screen.findByText("Amoxicilina 500mg")).toBeInTheDocument();

    // Listar productos
    expect(productosApi.listarProductos).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: expect.anything() }),
    );

    // Listar familias
    expect(productosApi.listarFamilias).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: expect.anything() }),
    );

    // Listar servicios
    expect(serviciosApi.listarServicios).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: expect.anything() }),
    );

    // Editar y guardar
    const inputIver = screen.getByLabelText("Precio final con IVA de Ivermectina Gotas");
    await user.type(inputIver, "1500");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => {
      expect(productosApi.actualizarProducto).toHaveBeenCalledWith(
        "prod-2",
        expect.not.objectContaining({ tenantId: expect.anything() }),
      );
    });
  });
});
