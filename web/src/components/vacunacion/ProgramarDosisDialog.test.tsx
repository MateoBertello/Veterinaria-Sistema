import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, ErrorCode, type DosisVacunacion } from "../../types/index.ts";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock("../../api/vacunacion.ts", () => ({
  listarTiposVacunaAplicables: vi.fn(),
  programarDosis: vi.fn(),
}));

import { ProgramarDosisDialog } from "./ProgramarDosisDialog.tsx";
import { listarTiposVacunaAplicables, programarDosis } from "../../api/vacunacion.ts";

const mockTipos = vi.mocked(listarTiposVacunaAplicables);
const mockProgramar = vi.mocked(programarDosis);

function makeDosis(over: Partial<DosisVacunacion> = {}): DosisVacunacion {
  return {
    id: "d1", petId: "pet1", tipoVacunaId: "t1", tipoVacunaNombre: "Antirrábica",
    eventoOrigenId: null, eventoAplicacionId: null, fechaEstimada: "2026-08-01",
    estado: "Pendiente", estadoVisual: "Proxima", notas: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function setup() {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ProgramarDosisDialog open petId="pet1" onOpenChange={onOpenChange} onSaved={onSaved} />,
  );
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTipos.mockResolvedValue([
    { id: "t1", nombre: "Antirrábica",      mesesRefuerzoSugerido: 12 },
    { id: "t2", nombre: "Quíntuple Canina", mesesRefuerzoSugerido: 12 },
  ]);
});

async function elegirTipoVacuna(nombre: string) {
  await userEvent.click(screen.getByLabelText(/Tipo de vacuna \*/i));
  await userEvent.click(await screen.findByRole("option", { name: nombre }));
}

describe("ProgramarDosisDialog", () => {
  // ── BUG 1: el combo ofrecía TODAS las vacunas de la clínica ─────────────
  //
  // El diálogo llamaba a `listarTiposVacuna()` sin argumento, así que al
  // programar una dosis para un perro se ofrecían también las de gato. Ahora se
  // le pregunta al backend por ESTA mascota (RN-PV11) y él resuelve la especie.

  it("RN-PV11: pide las vacunas aplicables A ESTA MASCOTA, no el catálogo entero", async () => {
    setup();

    await waitFor(() => expect(mockTipos).toHaveBeenCalledWith("pet1"));
    // Una sola llamada, y siempre con el id de la mascota: no existe la forma
    // sin argumento que traía el catálogo completo.
    expect(mockTipos).toHaveBeenCalledTimes(1);
  });

  it("RN-PV11: el combo ofrece exactamente lo que devolvió el backend", async () => {
    mockTipos.mockResolvedValue([{ id: "t1", nombre: "Antirrábica", mesesRefuerzoSugerido: 12 }]);
    setup();

    await userEvent.click(await screen.findByLabelText(/Tipo de vacuna \*/i));

    expect(await screen.findByRole("option", { name: "Antirrábica" })).toBeInTheDocument();
    // "Triple Felina" no está en la respuesta, así que no puede aparecer: el
    // frontend no filtra ni completa la lista por su cuenta.
    expect(screen.queryByRole("option", { name: /Triple Felina/i })).not.toBeInTheDocument();
  });

  it("RN-PV11: si la especie no tiene vacunas asociadas, lo dice en vez de mostrar un combo vacío", async () => {
    mockTipos.mockResolvedValue([]);
    setup();

    expect(
      await screen.findByText(/No hay vacunas asociadas a la especie de esta mascota/i),
    ).toBeInTheDocument();
  });

  it("RN-PV11: un rechazo del server por especie aterriza en el campo del tipo de vacuna", async () => {
    // El combo ya viene filtrado, pero alguien pudo desasociar la especie
    // mientras el diálogo estaba abierto: el error tiene que ser accionable.
    mockProgramar.mockRejectedValue(
      new ApiError(
        ErrorCode.VACCINE_NOT_APPLICABLE_TO_SPECIES,
        422,
        'La vacuna "Triple Felina" no está asociada a Perro.',
      ),
    );
    setup();

    await elegirTipoVacuna("Antirrábica");
    await userEvent.click(screen.getByRole("button", { name: /Programar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no está asociada a Perro/i);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("RN-PV3: tipo de vacuna vacío bloquea el envío", async () => {
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("El tipo de vacuna es requerido")).toBeInTheDocument();
    expect(mockProgramar).not.toHaveBeenCalled();
  });

  it("RN-PV2: una fecha anterior a hoy bloquea el envío en el cliente", async () => {
    setup();
    await elegirTipoVacuna("Antirrábica");

    const fechaInput = screen.getByLabelText(/Fecha estimada \*/i);
    await userEvent.clear(fechaInput);
    await userEvent.type(fechaInput, "2020-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("La fecha estimada no puede ser anterior a hoy")).toBeInTheDocument();
    expect(mockProgramar).not.toHaveBeenCalled();
  });

  it("RN-PV2: refleja el PAST_DATE del server como error de campo en fechaEstimada", async () => {
    setup();
    await elegirTipoVacuna("Antirrábica");
    mockProgramar.mockRejectedValue(new ApiError(ErrorCode.PAST_DATE, 422, "La fecha estimada no puede ser anterior a hoy"));

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText("La fecha estimada no puede ser anterior a hoy")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("programa la dosis con los campos mínimos y cierra el diálogo", async () => {
    const { onSaved, onOpenChange } = setup();
    await elegirTipoVacuna("Antirrábica");
    mockProgramar.mockResolvedValue(makeDosis());

    await userEvent.click(screen.getByRole("button", { name: "Programar" }));

    await waitFor(() => expect(mockProgramar).toHaveBeenCalledTimes(1));
    expect(mockProgramar).toHaveBeenCalledWith(
      "pet1",
      expect.objectContaining({ tipoVacunaId: "t1" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Dosis programada");
    expect(onSaved).toHaveBeenCalledWith(makeDosis());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  describe("modo refuerzo sugerido (RN-PV10)", () => {
    function setupSugerido(fechaEstimada = "2027-07-25") {
      const onSaved = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <ProgramarDosisDialog
          open
          petId="pet1"
          onOpenChange={onOpenChange}
          onSaved={onSaved}
          tiposVacuna={[
            { id: "t1", nombre: "Antirrábica", mesesRefuerzoSugerido: 12 },
          ]}
          sugerencia="Refuerzo de Antirrábica sugerido según el catálogo (cada 12 meses). Podés ajustar la fecha antes de confirmar."
          initialValues={{ tipoVacunaId: "t1", fechaEstimada }}
        />,
      );
      return { onSaved, onOpenChange };
    }

    it("abre pre-cargado con el tipo y la fecha sugeridos y explica de dónde salen", async () => {
      setupSugerido();

      expect(screen.getByRole("heading", { name: "Programar refuerzo sugerido" })).toBeInTheDocument();
      expect(screen.getByText(/Refuerzo de Antirrábica sugerido según el catálogo/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Fecha estimada \*/i)).toHaveValue("2027-07-25");
      expect(screen.getByLabelText(/Tipo de vacuna \*/i)).toHaveTextContent("Antirrábica");
    });

    it("el texto de la sugerencia es la descripción accesible del diálogo", async () => {
      setupSugerido();

      const dialogo = screen.getByRole("dialog");
      const descId = dialogo.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId as string)).toHaveTextContent(
        /Refuerzo de Antirrábica sugerido según el catálogo/,
      );
    });

    it("con el catálogo pre-cargado no vuelve a pedirlo al backend", async () => {
      setupSugerido();

      await waitFor(() => expect(screen.getByLabelText(/Fecha estimada \*/i)).toHaveValue("2027-07-25"));
      expect(mockTipos).not.toHaveBeenCalled();
    });

    it("el veterinario puede editar la fecha sugerida antes de confirmar", async () => {
      const { onSaved } = setupSugerido();
      mockProgramar.mockResolvedValue(makeDosis({ fechaEstimada: "2027-09-01" }));

      const fechaInput = screen.getByLabelText(/Fecha estimada \*/i);
      await userEvent.clear(fechaInput);
      await userEvent.type(fechaInput, "2027-09-01");
      await userEvent.click(screen.getByRole("button", { name: "Programar" }));

      await waitFor(() => expect(mockProgramar).toHaveBeenCalledTimes(1));
      expect(mockProgramar).toHaveBeenCalledWith("pet1", expect.objectContaining({
        tipoVacunaId:  "t1",
        fechaEstimada: "2027-09-01",
      }));
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
