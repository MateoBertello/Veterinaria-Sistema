import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type DosisVacunacion, type HistorialItem, type ResumenClinico } from "../types/index.ts";

vi.mock("../api/historial-clinico.ts", () => ({
  listarHistorial:        vi.fn(),
  resumenClinico:         vi.fn(),
  obtenerEvento:          vi.fn(),
  obtenerAdjuntoFirmado:  vi.fn(),
  crearEvento:            vi.fn(),
  subirAdjunto:           vi.fn(),
  registrarEutanasia:     vi.fn(),
  exportarHistorial:      vi.fn(),
}));

vi.mock("../api/vacunacion.ts", () => ({
  listarPlanVacunacion: vi.fn(),
  programarDosis:       vi.fn(),
  marcarDosisAplicada:  vi.fn(),
}));

vi.mock("../api/catalogos.ts", () => ({
  listarTiposVacuna: vi.fn(),
}));

vi.mock("../api/doctores.ts", () => ({
  listarDoctores: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 100, total: 0 } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { HistorialClinicoPage } from "./HistorialClinicoPage.tsx";
import { exportarHistorial, listarHistorial, resumenClinico } from "../api/historial-clinico.ts";
import { listarPlanVacunacion, marcarDosisAplicada, programarDosis } from "../api/vacunacion.ts";
import { listarTiposVacuna } from "../api/catalogos.ts";
import { listarDoctores } from "../api/doctores.ts";

const mockListar = vi.mocked(listarHistorial);
const mockResumen = vi.mocked(resumenClinico);
const mockExportar = vi.mocked(exportarHistorial);
const mockListarDosis = vi.mocked(listarPlanVacunacion);
const mockProgramar = vi.mocked(programarDosis);
const mockMarcarAplicada = vi.mocked(marcarDosisAplicada);
const mockTiposVacuna = vi.mocked(listarTiposVacuna);
const mockDoctores = vi.mocked(listarDoctores);

function makeResumen(over: Partial<ResumenClinico> = {}): ResumenClinico {
  return {
    id: "m1", name: "Firulais", estado: "Activa", ownerName: "Juan Pérez",
    especieName: "Perro", razaName: "Labrador", ultimoPeso: 12.5,
    ...over,
  };
}

function makeEvento(over: Partial<HistorialItem> = {}): HistorialItem {
  return {
    id: "e1", date: "2026-06-01", eventType: "Consulta", professionalName: "Dra. García",
    weightKg: 12.5, temperatureC: 38.2, diagnosis: null,
    clientNameAtTime: "Juan Pérez", isPreviousOwner: false, hasAttachments: false,
    ...over,
  };
}

function makeDosis(over: Partial<DosisVacunacion> = {}): DosisVacunacion {
  return {
    id: "d1", petId: "m1", tipoVacunaId: "t1", tipoVacunaNombre: "Antirrábica",
    eventoOrigenId: null, eventoAplicacionId: null, fechaEstimada: "2026-07-01",
    estado: "Pendiente", estadoVisual: "Proxima", notas: null, createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function renderPage(state?: { from?: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/historial/m1", state }]}>
      <Routes>
        <Route path="/mascotas" element={<div>Página de mascotas</div>} />
        <Route path="/historial" element={<div>Selector de historial</div>} />
        <Route path="/historial/:mascotaId" element={<HistorialClinicoPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTiposVacuna.mockResolvedValue([
    { id: "t1", nombre: "Antirrábica", especie_aplicable: null, meses_refuerzo_sugerido: 12 },
    { id: "t2", nombre: "Triple Felina", especie_aplicable: "Gato", meses_refuerzo_sugerido: null },
  ]);
});

describe("HistorialClinicoPage", () => {
  it("RN-HC1: muestra los eventos en el orden que devuelve el backend (desc)", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({
      items: [
        makeEvento({ id: "e2", date: "2026-06-05", professionalName: "Dra. Reciente" }),
        makeEvento({ id: "e1", date: "2026-06-01", professionalName: "Dra. Antigua" }),
      ],
      meta: { page: 1, limit: 20, total: 2 },
    });

    renderPage();

    await screen.findByText("Dra. Reciente");
    const nombres = screen.getAllByText(/^Dra\./);
    expect(nombres.map((n) => n.textContent)).toEqual(["Dra. Reciente", "Dra. Antigua"]);
  });

  it("RN-HC2: el último peso viene del resumen clínico, no de un campo por evento", async () => {
    mockResumen.mockResolvedValue(makeResumen({ ultimoPeso: 15.3 }));
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    expect(await screen.findByText(/Último peso: 15\.3 kg/)).toBeInTheDocument();
  });

  it("RN-HC3: cada evento muestra el dueño al momento del evento, no el actual", async () => {
    mockResumen.mockResolvedValue(makeResumen({ ownerName: "Dueño Actual" }));
    mockListar.mockResolvedValue({
      items: [makeEvento({ clientNameAtTime: "Dueño Histórico", isPreviousOwner: true })],
      meta: { page: 1, limit: 20, total: 1 },
    });

    renderPage();

    expect(await screen.findByText("Dueño Histórico")).toBeInTheDocument();
    expect(screen.queryByText("Dueño Actual")).not.toBeInTheDocument();
  });

  it("RN-EC3: mascota Fallecida bloquea el registro de eventos con mensaje explicativo", async () => {
    mockResumen.mockResolvedValue(makeResumen({ estado: "Fallecida" }));
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    expect(await screen.findByText(/no se pueden registrar nuevos eventos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar evento/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar eutanasia/i })).not.toBeInTheDocument();
  });

  it("RN-EC10: el botón de eutanasia solo está disponible con la mascota Activa", async () => {
    mockResumen.mockResolvedValue(makeResumen({ estado: "Activa" }));
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    expect(await screen.findByRole("button", { name: /Registrar eutanasia/i })).toBeInTheDocument();
  });

  it("RN-EX1: los botones de exportar están deshabilitados si el historial está vacío", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByRole("button", { name: /Exportar PDF/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exportar Excel/i })).toBeDisabled();
  });

  it("RN-EX2: exportar dispara la descarga del archivo devuelto por el backend", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
    mockExportar.mockResolvedValue({ blob: new Blob(["pdf"]), filename: "historial-m1.pdf" });

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      renderPage();

      const { default: userEvent } = await import("@testing-library/user-event");
      await userEvent.click(await screen.findByRole("button", { name: /Exportar PDF/i }));

      await waitFor(() => expect(mockExportar).toHaveBeenCalledWith("m1", "pdf"));
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("RN-EX1: EMPTY_HISTORY del backend se muestra como error, no descarga nada", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
    mockExportar.mockRejectedValue(new ApiError("EMPTY_HISTORY", 400, "El historial está vacío; no hay nada para exportar"));

    const { toast } = await import("sonner");

    renderPage();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(await screen.findByRole("button", { name: /Exportar PDF/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("El historial está vacío; no hay nada para exportar"));
  });

  it("muestra el estado vacío cuando la mascota no tiene eventos", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

    renderPage();

    expect(await screen.findByText(/Todavía no hay eventos clínicos/i)).toBeInTheDocument();
  });

  it("por defecto (acceso directo o desde Mascotas), 'Volver' navega a /mascotas", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(await screen.findByRole("button", { name: /Volver a mascotas/i }));

    expect(await screen.findByText("Página de mascotas")).toBeInTheDocument();
  });

  it("al llegar desde el selector de Historial Clínico, 'Volver' navega a /historial", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

    renderPage({ from: "historial" });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(await screen.findByRole("button", { name: /Volver a Historial Clínico/i }));

    expect(await screen.findByText("Selector de historial")).toBeInTheDocument();
  });

  it("muestra el estado de error con opción de reintentar", async () => {
    mockResumen.mockResolvedValue(makeResumen());
    mockListar.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga"));

    renderPage();

    expect(await screen.findByText("Falló la carga")).toBeInTheDocument();

    mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    await waitFor(() => expect(screen.queryByText("Falló la carga")).not.toBeInTheDocument());
  });

  describe("pestaña Plan de Vacunación", () => {
    async function abrirPestanaVacunacion() {
      const { default: userEvent } = await import("@testing-library/user-event");
      await userEvent.click(await screen.findByRole("tab", { name: /Plan de Vacunación/i }));
    }

    it("no llama a listarPlanVacunacion hasta que se activa la pestaña (lazy load)", async () => {
      mockResumen.mockResolvedValue(makeResumen());
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });

      renderPage();

      await screen.findByText("Firulais");
      expect(mockListarDosis).not.toHaveBeenCalled();
    });

    it("al activar la pestaña, lista las dosis con su badge de estadoVisual", async () => {
      mockResumen.mockResolvedValue(makeResumen());
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockResolvedValue({
        items: [makeDosis({ tipoVacunaNombre: "Antirrábica", estadoVisual: "Vencida" })],
        meta: { page: 1, limit: 20, total: 1 },
      });

      renderPage();
      await abrirPestanaVacunacion();

      expect(mockListarDosis).toHaveBeenCalledWith("m1", { page: 1, limit: 20 });
      expect(await screen.findByText("Antirrábica")).toBeInTheDocument();
      expect(screen.getByText("Vencida")).toBeInTheDocument();
    });

    it("muestra el estado vacío cuando no hay dosis en el plan", async () => {
      mockResumen.mockResolvedValue(makeResumen());
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0 } });

      renderPage();
      await abrirPestanaVacunacion();

      expect(await screen.findByText(/Todavía no hay dosis registradas/i)).toBeInTheDocument();
    });

    it("muestra el estado de error del plan con opción de reintentar", async () => {
      mockResumen.mockResolvedValue(makeResumen());
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500, "Falló la carga del plan"));

      renderPage();
      await abrirPestanaVacunacion();

      expect(await screen.findByText("Falló la carga del plan")).toBeInTheDocument();

      mockListarDosis.mockResolvedValue({ items: [makeDosis()], meta: { page: 1, limit: 20, total: 1 } });
      const { default: userEvent } = await import("@testing-library/user-event");
      await userEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

      await waitFor(() => expect(screen.queryByText("Falló la carga del plan")).not.toBeInTheDocument());
    });

    it("no muestra botones de acción de historial (exportar/registrar/eutanasia) en la pestaña de vacunación, pero sí 'Programar dosis'", async () => {
      mockResumen.mockResolvedValue(makeResumen({ estado: "Activa" }));
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockResolvedValue({ items: [makeDosis()], meta: { page: 1, limit: 20, total: 1 } });

      renderPage();
      await abrirPestanaVacunacion();
      await screen.findByText("Antirrábica");

      expect(screen.queryByRole("button", { name: /Registrar evento/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Registrar eutanasia/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Exportar/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Programar dosis" })).toBeInTheDocument();
    });

    it("RN-PV4: el banner de mascota fallecida sigue visible y oculta 'Programar dosis'", async () => {
      mockResumen.mockResolvedValue(makeResumen({ estado: "Fallecida" }));
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockResolvedValue({ items: [makeDosis()], meta: { page: 1, limit: 20, total: 1 } });

      renderPage();
      await abrirPestanaVacunacion();
      await screen.findByText("Antirrábica");

      expect(screen.getByText(/Mascota fallecida/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Programar dosis" })).not.toBeInTheDocument();
    });

    it("una dosis Pendiente ofrece 'Marcar aplicada'; una dosis Aplicada no", async () => {
      mockResumen.mockResolvedValue(makeResumen({ estado: "Activa" }));
      mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
      mockListarDosis.mockResolvedValue({
        items: [
          makeDosis({ id: "d1", tipoVacunaNombre: "Antirrábica", estado: "Pendiente", estadoVisual: "Proxima" }),
          makeDosis({ id: "d2", tipoVacunaNombre: "Triple Felina", estado: "Aplicada", estadoVisual: "Aplicada" }),
        ],
        meta: { page: 1, limit: 20, total: 2 },
      });

      renderPage();
      await abrirPestanaVacunacion();
      await screen.findByText("Antirrábica");

      expect(screen.getAllByRole("button", { name: "Marcar aplicada" })).toHaveLength(1);
    });

    describe("RN-PV10: refuerzo sugerido al aplicar una dosis", () => {
      const HOY = new Date().toISOString().slice(0, 10);

      // Radix deja el body con pointer-events mientras se encadenan dos diálogos
      // (se cierra el de aplicación y se abre el de sugerencia en el mismo commit).
      async function user() {
        const { default: userEvent } = await import("@testing-library/user-event");
        return userEvent.setup({ pointerEventsCheck: 0 });
      }

      /** Aplica la única dosis pendiente del plan con la fecha indicada. */
      async function aplicarDosis(fechaAplicacion: string) {
        const u = await user();
        await u.click(await screen.findByRole("button", { name: "Marcar aplicada" }));

        await u.click(await screen.findByLabelText(/Profesional \*/i));
        await u.click(await screen.findByRole("option", { name: "Dra. García" }));

        const fecha = screen.getByLabelText(/^Fecha$/i);
        await u.clear(fecha);
        await u.type(fecha, fechaAplicacion);

        await u.click(screen.getByRole("button", { name: "Confirmar aplicación" }));
      }

      async function prepararPlan(tipoVacunaId = "t1", tipoVacunaNombre = "Antirrábica") {
        mockResumen.mockResolvedValue(makeResumen({ estado: "Activa" }));
        mockListar.mockResolvedValue({ items: [makeEvento()], meta: { page: 1, limit: 20, total: 1 } });
        mockListarDosis.mockResolvedValue({
          items: [makeDosis({ id: "d1", tipoVacunaId, tipoVacunaNombre, estado: "Pendiente", estadoVisual: "Proxima" })],
          meta: { page: 1, limit: 20, total: 1 },
        });
        mockDoctores.mockResolvedValue({
          items: [{
            id: "doc1", userId: "u1", name: "Dra. García", specialty: null,
            licenseNumber: null, available: true, createdAt: "2026-01-01T00:00:00Z", usuario: null,
          }],
          meta: { page: 1, limit: 100, total: 1 },
        });
        mockMarcarAplicada.mockResolvedValue(makeDosis({ id: "d1", tipoVacunaId, estado: "Aplicada", estadoVisual: "Aplicada" }));

        renderPage();
        await abrirPestanaVacunacion();
        await screen.findByText(tipoVacunaNombre);
      }

      it("RN-PV10: tras aplicar, propone el refuerzo a fechaAplicada + meses_refuerzo_sugerido", async () => {
        await prepararPlan();

        await aplicarDosis("2026-03-10");

        expect(await screen.findByRole("heading", { name: "Programar refuerzo sugerido" })).toBeInTheDocument();
        expect(screen.getByLabelText(/Fecha estimada \*/i)).toHaveValue("2027-03-10");
        expect(screen.getByLabelText(/Tipo de vacuna \*/i)).toHaveTextContent("Antirrábica");
        expect(screen.getByText(/Refuerzo de Antirrábica sugerido según el catálogo \(cada 12 meses\)/)).toBeInTheDocument();
      });

      it("RN-PV10: un tipo de vacuna sin meses_refuerzo_sugerido no dispara ninguna sugerencia", async () => {
        await prepararPlan("t2", "Triple Felina");

        await aplicarDosis("2026-03-10");

        await waitFor(() => expect(mockMarcarAplicada).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.queryByRole("heading", { name: "Programar refuerzo sugerido" })).not.toBeInTheDocument();
        expect(mockProgramar).not.toHaveBeenCalled();
      });

      it("RN-PV10: confirmar la sugerencia con la fecha editada programa esa fecha", async () => {
        await prepararPlan();
        mockProgramar.mockResolvedValue(makeDosis({ id: "d2", fechaEstimada: "2027-05-02" }));

        await aplicarDosis("2026-03-10");
        await screen.findByRole("heading", { name: "Programar refuerzo sugerido" });

        const u = await user();
        const fechaEstimada = screen.getByLabelText(/Fecha estimada \*/i);
        await u.clear(fechaEstimada);
        await u.type(fechaEstimada, "2027-05-02");
        await u.click(screen.getByRole("button", { name: "Programar" }));

        await waitFor(() => expect(mockProgramar).toHaveBeenCalledTimes(1));
        expect(mockProgramar).toHaveBeenCalledWith("m1", expect.objectContaining({
          tipoVacunaId:  "t1",
          fechaEstimada: "2027-05-02",
        }));
      });

      it("RN-PV10: cancelar la sugerencia no crea nada y cierra el diálogo", async () => {
        await prepararPlan();

        await aplicarDosis("2026-03-10");
        await screen.findByRole("heading", { name: "Programar refuerzo sugerido" });

        const u = await user();
        await u.click(screen.getByRole("button", { name: "Cancelar" }));

        await waitFor(() =>
          expect(screen.queryByRole("heading", { name: "Programar refuerzo sugerido" })).not.toBeInTheDocument(),
        );
        expect(mockProgramar).not.toHaveBeenCalled();
      });

      it("RN-PV10: programar el refuerzo sugerido no encadena otra sugerencia", async () => {
        await prepararPlan();
        mockProgramar.mockResolvedValue(makeDosis({ id: "d2", fechaEstimada: "2027-03-10" }));

        await aplicarDosis("2026-03-10");
        await screen.findByRole("heading", { name: "Programar refuerzo sugerido" });

        const u = await user();
        await u.click(screen.getByRole("button", { name: "Programar" }));

        await waitFor(() => expect(mockProgramar).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("RN-PV2/RN-PV10: si el refuerzo cae en el pasado, pre-carga hoy y lo explica", async () => {
        await prepararPlan();

        // Aplicación registrada con fecha vieja: 2024-01-10 + 12 meses ya pasó.
        await aplicarDosis("2024-01-10");

        expect(await screen.findByRole("heading", { name: "Programar refuerzo sugerido" })).toBeInTheDocument();
        expect(screen.getByLabelText(/Fecha estimada \*/i)).toHaveValue(HOY);
        expect(screen.getByText(/una fecha ya pasada, así que se propone hoy/)).toBeInTheDocument();
      });
    });
  });
});
