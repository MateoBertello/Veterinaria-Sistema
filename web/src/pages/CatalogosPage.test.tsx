import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import {
  ApiError,
  type EspecieCatalogo,
  type RazaCatalogo,
  type TipoVacunaCatalogo,
} from "../types/index.ts";

vi.mock("../api/catalogos.ts", () => ({
  listarEspeciesCatalogo:    vi.fn(),
  listarRazasCatalogo:       vi.fn(),
  listarTiposVacunaCatalogo: vi.fn(),
  crearEspecie:              vi.fn(),
  editarEspecie:             vi.fn(),
  cambiarEstadoEspecie:      vi.fn(),
  crearRaza:                 vi.fn(),
  editarRaza:                vi.fn(),
  cambiarEstadoRaza:         vi.fn(),
  crearTipoVacuna:           vi.fn(),
  editarTipoVacuna:          vi.fn(),
  cambiarEstadoTipoVacuna:   vi.fn(),
  asociarEspeciesTipoVacuna: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CatalogosPage } from "./CatalogosPage.tsx";
import {
  asociarEspeciesTipoVacuna,
  cambiarEstadoEspecie,
  listarEspeciesCatalogo,
  listarRazasCatalogo,
  listarTiposVacunaCatalogo,
} from "../api/catalogos.ts";

const mockEspecies = vi.mocked(listarEspeciesCatalogo);
const mockRazas    = vi.mocked(listarRazasCatalogo);
const mockTipos    = vi.mocked(listarTiposVacunaCatalogo);
const mockBaja     = vi.mocked(cambiarEstadoEspecie);
const mockAsociar  = vi.mocked(asociarEspeciesTipoVacuna);

const META = { page: 1, limit: 20, total: 1 };

const especie = (over: Partial<EspecieCatalogo> = {}): EspecieCatalogo => ({
  id: "e1", name: "Perro", description: "Canino doméstico", active: true, ...over,
});
const raza = (over: Partial<RazaCatalogo> = {}): RazaCatalogo => ({
  id: "r1", especieId: "e1", especieName: "Perro", name: "Mestizo",
  description: null, active: true, ...over,
});
const tipo = (over: Partial<TipoVacunaCatalogo> = {}): TipoVacunaCatalogo => ({
  id: "t1", nombre: "Antirrábica",
  // Las especies aplicables llegan embebidas en el propio listado (RN-CAT10).
  especies: [{ id: "e1", name: "Perro" }],
  mesesRefuerzoSugerido: 12, active: true, ...over,
});

function renderPage() {
  return render(
    <TooltipProvider>
      <CatalogosPage />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEspecies.mockResolvedValue({ items: [especie()], meta: META });
  mockRazas.mockResolvedValue({ items: [raza()], meta: META });
  mockTipos.mockResolvedValue({ items: [tipo()], meta: META });
});

describe("CatalogosPage", () => {
  it("muestra las especies de la clínica al entrar", async () => {
    renderPage();

    expect(await screen.findByText("Perro")).toBeInTheDocument();
    expect(screen.getByText("Canino doméstico")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("la tabla es un contenedor con scroll y nombre accesible (WCAG)", async () => {
    renderPage();
    await screen.findByText("Perro");

    expect(
      screen.getByRole("region", { name: "Listado de especies del catálogo" }),
    ).toBeInTheDocument();
  });

  it("estado vacío: invita a crear el primero", async () => {
    mockEspecies.mockResolvedValue({ items: [], meta: { ...META, total: 0 } });
    renderPage();

    expect(await screen.findByText(/Todavía no hay especies/)).toBeInTheDocument();
  });

  it("estado de error: muestra el mensaje y permite reintentar", async () => {
    mockEspecies.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Se cayó la base"));
    renderPage();

    expect(await screen.findByText("Se cayó la base")).toBeInTheDocument();

    mockEspecies.mockResolvedValue({ items: [especie()], meta: META });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Perro")).toBeInTheDocument();
  });

  it("un ítem dado de baja se ve como tal y ofrece reactivarlo", async () => {
    mockEspecies.mockResolvedValue({ items: [especie({ active: false })], meta: META });
    renderPage();

    expect(await screen.findByText("Dado de baja")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivar Perro" })).toBeInTheDocument();
  });

  // RN-CAT5: el rechazo por "en uso" tiene que verse EN el diálogo. Si se
  // cerrara y saliera por un toast, el usuario pierde de vista qué fila falló.
  it("RN-CAT5: si la especie está en uso, el diálogo muestra el motivo y no la da de baja", async () => {
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("button", { name: "Dar de baja Perro" }));

    mockBaja.mockRejectedValueOnce(
      new ApiError("CATALOG_IN_USE", 409, "No se puede dar de baja una especie que tiene mascotas registradas"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Dar de baja" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("No se puede dar de baja una especie que tiene mascotas registradas");
    // El diálogo sigue abierto: el usuario ve el porqué junto a lo que intentó.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("la pestaña de razas muestra la especie que vino embebida en el listado", async () => {
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Razas" }));

    expect(await screen.findByText("Mestizo")).toBeInTheDocument();
    // El nombre de la especie sale del propio listado de razas: una sola llamada.
    expect(mockRazas).toHaveBeenCalledTimes(1);
    const tabla = screen.getByRole("region", { name: "Listado de razas del catálogo" });
    expect(within(tabla).getByText("Perro")).toBeInTheDocument();
  });

  it("la pestaña de tipos de vacuna muestra el refuerzo y las especies aplicables", async () => {
    mockTipos.mockResolvedValue({
      items: [tipo({ especies: [{ id: "e1", name: "Perro" }, { id: "e2", name: "Gato" }] })],
      meta:  META,
    });
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Tipos de vacuna" }));

    const tabla = await screen.findByRole("region", { name: "Listado de tipos de vacuna del catálogo" });
    expect(within(tabla).getByText("Antirrábica")).toBeInTheDocument();
    expect(within(tabla).getByText("12 meses")).toBeInTheDocument();
    // RN-CAT10: las especies vienen embebidas en el mismo listado, una por
    // badge. Antes acá decía "Todas", que era el `especie_aplicable IS NULL`.
    expect(within(tabla).getByText("Perro")).toBeInTheDocument();
    expect(within(tabla).getByText("Gato")).toBeInTheDocument();
  });

  it("RN-CAT10: una vacuna sin especies asociadas se marca como no aplicable a ninguna", async () => {
    mockTipos.mockResolvedValue({ items: [tipo({ especies: [] })], meta: META });
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Tipos de vacuna" }));

    const tabla = await screen.findByRole("region", { name: "Listado de tipos de vacuna del catálogo" });
    expect(within(tabla).getByText("Ninguna")).toBeInTheDocument();
  });

  it("RN-CAT10: cada tipo de vacuna ofrece la pantalla de especies aplicables", async () => {
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Tipos de vacuna" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Especies aplicables a Antirrábica" }),
    );

    // El panel abre pre-marcado con lo que la vacuna ya tiene asociado: se edita
    // el conjunto vigente, no se arranca de cero.
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "Especies aplicables" })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(panel).getByRole("checkbox", { name: "Perro" })).toBeChecked(),
    );
  });

  it("RN-CAT10: guardar el panel manda el conjunto COMPLETO de especies", async () => {
    mockEspecies.mockResolvedValue({
      items: [especie(), especie({ id: "e2", name: "Gato" })],
      meta:  { ...META, total: 2 },
    });
    mockAsociar.mockResolvedValue(tipo());
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Tipos de vacuna" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Especies aplicables a Antirrábica" }),
    );

    const panel = await screen.findByRole("dialog");
    await userEvent.click(await within(panel).findByRole("checkbox", { name: "Gato" }));
    await userEvent.click(within(panel).getByRole("button", { name: /Guardar/i }));

    // Las dos, no solo la agregada: el PUT reemplaza el conjunto.
    await waitFor(() => expect(mockAsociar).toHaveBeenCalledWith("t1", ["e1", "e2"]));
  });

  it("RN-CAT10: no se puede dejar una vacuna sin ninguna especie", async () => {
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("tab", { name: "Tipos de vacuna" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Especies aplicables a Antirrábica" }),
    );

    const panel = await screen.findByRole("dialog");
    await userEvent.click(await within(panel).findByRole("checkbox", { name: "Perro" }));
    await userEvent.click(within(panel).getByRole("button", { name: /Guardar/i }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(/al menos una especie/i);
    expect(mockAsociar).not.toHaveBeenCalled();
  });

  it("filtrar por estado vuelve a pedir el listado con el filtro aplicado", async () => {
    renderPage();
    await screen.findByText("Perro");

    await userEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado" }));
    await userEvent.click(await screen.findByRole("option", { name: "Dado de baja" }));

    await waitFor(() => {
      expect(mockEspecies).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    });
  });
});
