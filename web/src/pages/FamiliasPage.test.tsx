import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FamiliasPage } from "./FamiliasPage.tsx";
import * as productosApi from "../api/comercial/productos.ts";
import * as catalogosComercialApi from "../api/catalogos-comercial.ts";
import { ApiError, type ApiMeta, type Familia, type UnidadMedida } from "../types/index.ts";

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
  {
    id: "uni-3",
    codigo: "ML",
    nombre: "Mililitro",
    abreviatura: "ml",
    admite_decimales: true,
    escala_decimal: 2,
  },
];

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
  {
    id: "fam-3",
    tenantId: "tenant-1",
    nombre: "Vacunas",
    unidadBaseId: "uni-3",
    activo: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

describe("FamiliasPage (F1·T3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(catalogosComercialApi, "listarUnidadesMedida").mockResolvedValue(MOCK_UNIDADES);
    vi.spyOn(productosApi, "listarFamilias").mockResolvedValue({
      items: MOCK_FAMILIAS,
      meta: { page: 1, limit: 20, total: 3 },
    });
  });

  it("renderiza correctamente la lista de familias y sus unidades base", async () => {
    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Familias de Productos")).toBeInTheDocument();
    expect(screen.getByText("Farmacia")).toBeInTheDocument();
    expect(screen.getByText("Alimentos")).toBeInTheDocument();
    expect(screen.getByText("Vacunas")).toBeInTheDocument();

    // Las unidades base se resuelven del mapa de unidades
    expect(screen.getByText("Comprimido (comp)")).toBeInTheDocument();
    expect(screen.getByText("Kilogramo (kg)")).toBeInTheDocument();
    expect(screen.getByText("Mililitro (ml)")).toBeInTheDocument();
  });

  it("muestra estado vacío cuando no hay familias", async () => {
    vi.spyOn(productosApi, "listarFamilias").mockResolvedValueOnce({
      items: [],
      meta: { page: 1, limit: 20, total: 0 },
    });

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("No hay familias de productos registradas."),
    ).toBeInTheDocument();
  });

  it("muestra estado de error con alerta y botón de reintento", async () => {
    vi.spyOn(productosApi, "listarFamilias")
      .mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Error del servidor"))
      .mockResolvedValueOnce({
        items: MOCK_FAMILIAS,
        meta: { page: 1, limit: 20, total: 3 },
      });

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Error del servidor");

    const btnReintentar = screen.getByRole("button", { name: "Reintentar" });
    await userEvent.click(btnReintentar);

    expect(await screen.findByText("Farmacia")).toBeInTheDocument();
  });

  it("la unidad base sale del Map: cantidad de fetch constante con N filas", async () => {
    const mockUnidades = vi.spyOn(catalogosComercialApi, "listarUnidadesMedida");

    // 10 familias simuladas
    const diezFamilias: Familia[] = Array.from({ length: 10 }, (_, i) => ({
      id: `fam-${i}`,
      tenantId: "tenant-1",
      nombre: `Familia ${i}`,
      unidadBaseId: "uni-1",
      activo: true,
      createdAt: "2026-01-01T00:00:00Z",
    }));

    vi.spyOn(productosApi, "listarFamilias").mockResolvedValueOnce({
      items: diezFamilias,
      meta: { page: 1, limit: 20, total: 10 },
    });

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    await screen.findByText("Familia 0");
    await screen.findByText("Familia 9");

    // Exactamente 1 fetch a unidades, sin N+1
    expect(mockUnidades).toHaveBeenCalledTimes(1);
  });

  it("RN-PR8: el alta no manda la familia sin unidadBaseId (obligatorio y sin default)", async () => {
    const mockCrear = vi.spyOn(productosApi, "crearFamilia").mockResolvedValue({
      id: "fam-new",
      tenantId: "tenant-1",
      nombre: "Analgésicos",
      unidadBaseId: "uni-1",
      activo: true,
      createdAt: "2026-01-01T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    await screen.findByText("Farmacia");

    // Abrir diálogo de nueva familia
    const btnNueva = screen.getByRole("button", { name: /Nueva familia/i });
    await userEvent.click(btnNueva);

    expect(await screen.findByRole("heading", { name: "Nueva familia" })).toBeInTheDocument();

    // Completar solo el nombre, dejando unidadBaseId sin seleccionar
    const inputNombre = screen.getByLabelText(/Nombre/i);
    await userEvent.type(inputNombre, "Analgésicos");

    const btnSubmit = screen.getByRole("button", { name: "Crear familia" });
    await userEvent.click(btnSubmit);

    // Debe mostrar error de validación y NO invocar la API
    expect(await screen.findByText("Debe seleccionar una unidad base")).toBeInTheDocument();
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("RN §2.1: la baja pide confirmación y el error queda dentro del diálogo", async () => {
    const mockCambiarEstado = vi.spyOn(productosApi, "cambiarEstadoFamilia").mockRejectedValueOnce(
      new ApiError("FAMILY_HAS_PRODUCTS", 409, "La familia tiene productos asociados activos"),
    );

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    await screen.findByText("Farmacia");

    // Botón de dar de baja para Farmacia (es activa)
    const btnBaja = screen.getByRole("button", { name: "Dar de baja Farmacia" });
    await userEvent.click(btnBaja);

    // AlertDialog se abre con el texto descriptivo obligatorio
    expect(await screen.findByRole("heading", { name: "Dar de baja familia" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /«Farmacia» deja de ofrecerse al clasificar productos nuevos. Los productos que ya la usan la siguen mostrando./,
      ),
    ).toBeInTheDocument();

    // Confirmar la baja
    const btnConfirmar = screen.getByRole("button", { name: "Dar de baja" });
    await userEvent.click(btnConfirmar);

    // El error del backend se muestra DENTRO del diálogo con role="alert"
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("La familia tiene productos asociados activos");

    // El diálogo NO se cerró
    expect(screen.getByRole("heading", { name: "Dar de baja familia" })).toBeInTheDocument();
    expect(mockCambiarEstado).toHaveBeenCalledWith("fam-1", false);
  });

  it("permite reactivar una familia dada de baja", async () => {
    const mockCambiarEstado = vi.spyOn(productosApi, "cambiarEstadoFamilia").mockResolvedValueOnce({
      ...MOCK_FAMILIAS[2]!,
      activo: true,
    });

    render(
      <MemoryRouter>
        <FamiliasPage />
      </MemoryRouter>,
    );

    await screen.findByText("Vacunas");

    // Botón de reactivar para Vacunas (activo: false)
    const btnReactivar = screen.getByRole("button", { name: "Reactivar Vacunas" });
    await userEvent.click(btnReactivar);

    expect(mockCambiarEstado).toHaveBeenCalledWith("fam-3", true);
  });
});
